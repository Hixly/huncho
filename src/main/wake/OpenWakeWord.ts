/**
 * Pure, Electron-free port of openWakeWord's streaming inference pipeline
 * (https://github.com/dscripka/openWakeWord, Apache-2.0). Fully local, no keys.
 *
 * Three ONNX models chained per openWakeWord's design:
 *   melspectrogram.onnx  raw 16kHz PCM      -> mel frames (32 bins, ~10ms/frame)
 *   embedding_model.onnx 76 mel frames      -> 96-dim speech embedding
 *   <wake>.onnx          16 rolling embeds  -> 0..1 wake score
 *
 * Streaming contract (matches openWakeWord AudioFeatures._streaming_features):
 *   - audio is processed in 1280-sample (80ms) frames; features are only
 *     computed when the accumulated sample count is a multiple of 1280
 *   - each 1280-sample chunk yields exactly 8 new mel frames and 1 new embedding
 *   - a wake score is produced per new embedding using the trailing 16 embeddings
 *
 * No Electron imports — unit-testable with mocked ORT sessions.
 */

// Minimal structural types so this file needs no onnxruntime-node type import
// (and so tests can inject fakes).
export interface OrtTensorLike {
  data: Float32Array | Uint8Array | Int32Array | number[];
  dims: readonly number[];
}
export interface OrtSessionLike {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
}
export type TensorFactory = (data: Float32Array, dims: number[]) => OrtTensorLike;

export interface OpenWakeWordDeps {
  melSession: OrtSessionLike;
  embeddingSession: OrtSessionLike;
  wakeSession: OrtSessionLike;
  tensorFactory: TensorFactory;
  threshold?: number;
}

export interface OpenWakeWordCreateOptions {
  wakeModelPath: string;
  melModelPath: string;
  embeddingModelPath: string;
  threshold?: number;
  /** Injectable onnxruntime-node module (defaults to require('onnxruntime-node')). */
  ort?: any;
}

const FRAME_SAMPLES = 1280;      // 80ms @ 16kHz
const MEL_BINS = 32;
const MEL_CONTEXT_SAMPLES = 160 * 3; // extra 480 samples fed to melspec for frame alignment
const EMBED_WINDOW = 76;         // mel frames per embedding window
const EMBED_STEP = 8;            // mel frames advanced per 1280-sample chunk
const EMBED_DIM = 96;
const WAKE_WINDOW = 16;          // embeddings the wake model consumes
const MEL_MAX_FRAMES = 10 * 97;  // ~10s of mel history (openWakeWord melspectrogram_max_len)
const FEATURE_MAX = 120;         // ~10s of embedding history
const RAW_MAX_SAMPLES = 16000 * 10;

export class OpenWakeWord {
  private readonly mel: OrtSessionLike;
  private readonly emb: OrtSessionLike;
  private readonly wake: OrtSessionLike;
  private readonly tensor: TensorFactory;
  readonly threshold: number;

  // Rolling buffers (mirror openWakeWord AudioFeatures state).
  private rawBuffer: number[] = [];               // int16 samples awaiting melspec
  private melBuffer: Float32Array[] = [];         // each row = 32 mel bins
  private featureBuffer: Float32Array[] = [];     // each row = 96-dim embedding
  private accumulatedSamples = 0;
  private rawRemainder: Int16Array = new Int16Array(0);

  constructor(deps: OpenWakeWordDeps) {
    this.mel = deps.melSession;
    this.emb = deps.embeddingSession;
    this.wake = deps.wakeSession;
    this.tensor = deps.tensorFactory;
    this.threshold = deps.threshold ?? 0.5;

    // openWakeWord seeds the mel buffer with 76 frames of ones and the feature
    // buffer with real embeddings of random audio. We seed the mel buffer the
    // same way and the feature buffer with 16 zero rows — enough for the first
    // get_features(16) call to succeed. Zero features score ~0, so no spurious
    // early wake. (Minor, warmup-only deviation from upstream random-audio seed.)
    for (let i = 0; i < EMBED_WINDOW; i++) this.melBuffer.push(new Float32Array(MEL_BINS).fill(1));
    for (let i = 0; i < WAKE_WINDOW; i++) this.featureBuffer.push(new Float32Array(EMBED_DIM));
  }

  static async create(opts: OpenWakeWordCreateOptions): Promise<OpenWakeWord> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ort = opts.ort ?? require('onnxruntime-node');
    const [melSession, embeddingSession, wakeSession] = await Promise.all([
      ort.InferenceSession.create(opts.melModelPath),
      ort.InferenceSession.create(opts.embeddingModelPath),
      ort.InferenceSession.create(opts.wakeModelPath),
    ]);
    const tensorFactory: TensorFactory = (data, dims) => new ort.Tensor('float32', data, dims);
    return new OpenWakeWord({
      melSession,
      embeddingSession,
      wakeSession,
      tensorFactory,
      threshold: opts.threshold,
    });
  }

  /**
   * Feed arbitrary-length 16kHz Int16 PCM. Returns the wake scores (0..1) for
   * every new 80ms feature frame produced by this call (usually 0 or 1 entry).
   */
  async ingest(pcm: Int16Array): Promise<number[]> {
    // Prepend any samples left over from the previous odd-sized chunk.
    let x = pcm;
    if (this.rawRemainder.length > 0) {
      const merged = new Int16Array(this.rawRemainder.length + pcm.length);
      merged.set(this.rawRemainder);
      merged.set(pcm, this.rawRemainder.length);
      x = merged;
      this.rawRemainder = new Int16Array(0);
    }

    // Buffer only whole 1280-sample chunks; stash the remainder for next time.
    if (this.accumulatedSamples + x.length >= FRAME_SAMPLES) {
      const remainder = (this.accumulatedSamples + x.length) % FRAME_SAMPLES;
      if (remainder !== 0) {
        this.bufferRaw(x.subarray(0, x.length - remainder));
        this.accumulatedSamples += x.length - remainder;
        this.rawRemainder = x.slice(x.length - remainder);
      } else {
        this.bufferRaw(x);
        this.accumulatedSamples += x.length;
      }
    } else {
      this.accumulatedSamples += x.length;
      this.bufferRaw(x);
    }

    const scores: number[] = [];
    if (this.accumulatedSamples >= FRAME_SAMPLES && this.accumulatedSamples % FRAME_SAMPLES === 0) {
      const numChunks = this.accumulatedSamples / FRAME_SAMPLES;
      await this.updateMelspectrogram(this.accumulatedSamples);

      // One embedding per newly buffered chunk, oldest first, each stepping the
      // 76-frame mel window back by 8 frames (openWakeWord's feature loop).
      for (let i = numChunks - 1; i >= 0; i--) {
        const end = i === 0 ? this.melBuffer.length : this.melBuffer.length - EMBED_STEP * i;
        const start = end - EMBED_WINDOW;
        if (start < 0) continue;
        const window = this.melBuffer.slice(start, end);
        const embedding = await this.embed(window);
        this.featureBuffer.push(embedding);
        if (this.featureBuffer.length > FEATURE_MAX) this.featureBuffer.shift();
        scores.push(await this.score());
      }
      this.accumulatedSamples = 0;
    }
    return scores;
  }

  private bufferRaw(x: Int16Array): void {
    for (let i = 0; i < x.length; i++) this.rawBuffer.push(x[i]);
    if (this.rawBuffer.length > RAW_MAX_SAMPLES) {
      this.rawBuffer.splice(0, this.rawBuffer.length - RAW_MAX_SAMPLES);
    }
  }

  /** Compute melspec over the last (nSamples + 480) raw samples and append. */
  private async updateMelspectrogram(nSamples: number): Promise<void> {
    const take = nSamples + MEL_CONTEXT_SAMPLES;
    const slice = this.rawBuffer.slice(Math.max(0, this.rawBuffer.length - take));
    const input = new Float32Array(slice.length);
    for (let i = 0; i < slice.length; i++) input[i] = slice[i];

    const feeds: Record<string, OrtTensorLike> = {};
    feeds[this.mel.inputNames[0]] = this.tensor(input, [1, input.length]);
    const out = await this.mel.run(feeds);
    const t = out[this.mel.outputNames[0]];
    const data = t.data as Float32Array;
    const frames = data.length / MEL_BINS;
    for (let f = 0; f < frames; f++) {
      const row = new Float32Array(MEL_BINS);
      for (let b = 0; b < MEL_BINS; b++) {
        // openWakeWord's "arbitrary transform": x/10 + 2.
        row[b] = data[f * MEL_BINS + b] / 10 + 2;
      }
      this.melBuffer.push(row);
    }
    if (this.melBuffer.length > MEL_MAX_FRAMES) {
      this.melBuffer.splice(0, this.melBuffer.length - MEL_MAX_FRAMES);
    }
  }

  /** 76×32 mel window -> 96-dim embedding. */
  private async embed(window: Float32Array[]): Promise<Float32Array> {
    const flat = new Float32Array(EMBED_WINDOW * MEL_BINS);
    for (let f = 0; f < EMBED_WINDOW; f++) flat.set(window[f], f * MEL_BINS);
    const feeds: Record<string, OrtTensorLike> = {};
    feeds[this.emb.inputNames[0]] = this.tensor(flat, [1, EMBED_WINDOW, MEL_BINS, 1]);
    const out = await this.emb.run(feeds);
    return Float32Array.from(out[this.emb.outputNames[0]].data as Float32Array);
  }

  /** Trailing 16 embeddings -> wake score (already 0..1, no sigmoid needed). */
  private async score(): Promise<number> {
    const frames = this.featureBuffer.slice(-WAKE_WINDOW);
    const flat = new Float32Array(WAKE_WINDOW * EMBED_DIM);
    for (let f = 0; f < WAKE_WINDOW; f++) flat.set(frames[f], f * EMBED_DIM);
    const feeds: Record<string, OrtTensorLike> = {};
    feeds[this.wake.inputNames[0]] = this.tensor(flat, [1, WAKE_WINDOW, EMBED_DIM]);
    const out = await this.wake.run(feeds);
    return (out[this.wake.outputNames[0]].data as Float32Array)[0];
  }
}
