import { int16ToFloat32, resampleLinear } from './audio-utils';

/**
 * Local, keyless speech-to-text via transformers.js + Moonshine ONNX. Replaces
 * the mic → Cloudflare Worker → Whisper round-trip with on-device transcription
 * (~100ms class) once the model is cached. The AssemblyAI/Whisper cloud path
 * stays available as a config-selected fallback.
 *
 * Electron-optional by design: the model cache directory is injected, so this
 * class can be constructed and unit-tested without an Electron app instance.
 */

export type MoonshineModelSize = 'base' | 'tiny';

const MODEL_IDS: Record<MoonshineModelSize, string> = {
  base: 'onnx-community/moonshine-base-ONNX',
  tiny: 'onnx-community/moonshine-tiny-ONNX',
};

const TARGET_SAMPLE_RATE = 16000;

// Quantized weights keep the first-run download small and CPU inference quick;
// accuracy is fine for short voice commands.
const DEFAULT_DTYPE = 'q8';

// Minimal shape of the transformers.js ASR pipeline we depend on. Kept local so
// tests can inject a fake without importing the heavy real module.
type AsrPipeline = (input: Float32Array) => Promise<{ text?: string } | Array<{ text?: string }>>;
type PipelineFactory = (
  task: 'automatic-speech-recognition',
  model: string,
  options: { cache_dir?: string; dtype?: string; progress_callback?: (p: unknown) => void }
) => Promise<AsrPipeline>;

export interface MoonshineOptions {
  /** Directory to cache downloaded ONNX weights (e.g. userData/models). */
  cacheDir?: string;
  /** 'base' (default, more accurate) or 'tiny' (low-VRAM fallback). */
  model?: MoonshineModelSize;
  dtype?: string;
  /**
   * Inject a transformers.js-compatible `pipeline` factory. Omitted in
   * production (the real module is lazy-loaded); supplied by unit tests.
   */
  pipelineFactory?: PipelineFactory;
}

export class MoonshineTranscriber {
  private readonly cacheDir?: string;
  private readonly modelId: string;
  private readonly dtype: string;
  private readonly pipelineFactory?: PipelineFactory;
  private pipelinePromise: Promise<AsrPipeline> | null = null;

  constructor(opts: MoonshineOptions = {}) {
    this.cacheDir = opts.cacheDir;
    this.modelId = MODEL_IDS[opts.model ?? 'base'];
    this.dtype = opts.dtype ?? DEFAULT_DTYPE;
    this.pipelineFactory = opts.pipelineFactory;
  }

  /** Resolve the pipeline factory: injected one for tests, else lazy-load the real module. */
  private async getPipelineFactory(): Promise<PipelineFactory> {
    if (this.pipelineFactory) return this.pipelineFactory;
    // Lazy import so app startup isn't blocked and tests never touch the real dep.
    const mod = await import('@huggingface/transformers');
    if (this.cacheDir) {
      // Point transformers.js' cache at our injected dir (userData/models).
      mod.env.cacheDir = this.cacheDir;
    }
    return mod.pipeline as unknown as PipelineFactory;
  }

  /** Lazily construct (and cache) the ASR pipeline. Downloads weights on first run. */
  private loadPipeline(): Promise<AsrPipeline> {
    if (this.pipelinePromise) return this.pipelinePromise;
    this.pipelinePromise = (async () => {
      const factory = await this.getPipelineFactory();
      console.log(`[Moonshine] Loading ASR pipeline "${this.modelId}" (dtype=${this.dtype})…`);
      const pipe = await factory('automatic-speech-recognition', this.modelId, {
        cache_dir: this.cacheDir,
        dtype: this.dtype,
        progress_callback: (p: unknown) => {
          const info = p as { status?: string; file?: string; progress?: number };
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            console.log(`[Moonshine] downloading ${info.file ?? ''} ${info.progress.toFixed(0)}%`);
          } else if (info?.status === 'done' && info.file) {
            console.log(`[Moonshine] cached ${info.file}`);
          }
        },
      });
      console.log('[Moonshine] Pipeline ready');
      return pipe;
    })();
    // Reset on failure so a later call can retry (e.g. transient download error).
    this.pipelinePromise.catch(() => {
      this.pipelinePromise = null;
    });
    return this.pipelinePromise;
  }

  /**
   * Warm up the pipeline in the background at app start so the first real
   * utterance doesn't pay the load/download cost. Never throws.
   */
  async warmup(): Promise<void> {
    try {
      await this.loadPipeline();
    } catch (err) {
      console.warn('[Moonshine] warmup failed (will retry on first utterance):', err);
    }
  }

  /**
   * Transcribe a mono Int16 PCM utterance. Converts to Float32, resamples to
   * 16kHz if needed, runs Moonshine, and returns the trimmed text. Throws on
   * pipeline failure so callers can fall back to the cloud path.
   */
  async transcribe(pcm: Int16Array, sampleRate: number): Promise<string> {
    if (!pcm || pcm.length === 0) return '';
    const float = int16ToFloat32(pcm);
    const resampled = resampleLinear(float, sampleRate, TARGET_SAMPLE_RATE);
    const pipe = await this.loadPipeline();
    const result = await pipe(resampled);
    const text = Array.isArray(result) ? result[0]?.text : result?.text;
    return (text ?? '').trim();
  }
}
