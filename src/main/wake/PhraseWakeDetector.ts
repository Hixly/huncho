import { frameRms } from '../stt/Endpointer';

/**
 * Speech segmenter for the phrase-based wake engine.
 *
 * Turns the always-on 16kHz Int16 PCM stream into short candidate *utterance
 * segments* that are cheap enough to hand to a local ASR model. It answers only
 * one question — "did someone just say a short thing?" — and never looks at
 * words; matching is `wake-phrase.ts`'s job.
 *
 * Pure and dependency-free (no Electron, no ONNX) so it can be unit-tested with
 * synthesized PCM. Threshold strategy is deliberately identical to
 * {@link ../stt/Endpointer}: a rolling ambient noise floor (EMA of sub-speech
 * frame RMS, seeded at `absoluteFloor`) with a frame counting as speech when its
 * RMS exceeds `max(absoluteFloor, noiseFloor * speechFactor)`.
 *
 * Pre-roll matters: by the time the RMS threshold trips, the first phoneme of
 * "Huncho" is already in the past. The detector keeps a small ring buffer of
 * recent frames and prepends `preRollMs` of audio to every segment, otherwise
 * the transcriber reliably hears "uncho".
 */

export interface PhraseWakeDetectorOptions {
  /** PCM sample rate of the incoming stream. */
  sampleRate?: number;
  /** Analysis frame duration. 80ms @16kHz = 1280 samples (matches the mic tap). */
  frameMs?: number;
  /** Absolute Int16 RMS below which audio is always treated as silence. */
  absoluteFloor?: number;
  /** A frame is speech when RMS > noiseFloor * this factor (and > absoluteFloor). */
  speechFactor?: number;
  /** Minimum cumulative speech in a segment; shorter blips are discarded. */
  minSpeechMs?: number;
  /** Silence after speech that closes the segment. */
  trailingSilenceMs?: number;
  /** Hard cap on segment length (excluding pre-roll) while still speaking. */
  maxSegmentMs?: number;
  /** Audio retained from BEFORE speech was detected, prepended to the segment. */
  preRollMs?: number;
}

const DEFAULTS: Required<PhraseWakeDetectorOptions> = {
  sampleRate: 16000,
  frameMs: 80,
  absoluteFloor: 500,
  speechFactor: 3,
  minSpeechMs: 250,
  trailingSilenceMs: 400,
  maxSegmentMs: 2500,
  preRollMs: 300,
};

export class PhraseWakeDetector {
  private readonly opts: Required<PhraseWakeDetectorOptions>;
  private readonly frameSamples: number;
  private readonly preRollFrames: number;

  /** Samples left over from the previous feed() that didn't fill a frame. */
  private pending: Int16Array = new Int16Array(0);
  /** Rolling pre-speech ring buffer (at most preRollFrames entries). */
  private ring: Int16Array[] = [];
  /** Frames accumulated for the in-progress segment (includes pre-roll). */
  private segment: Int16Array[] = [];

  private speaking = false;
  private speechMs = 0;   // cumulative speech within the current segment
  private silenceMs = 0;  // current trailing-silence run
  private activeMs = 0;   // segment length since speech started (excl. pre-roll)
  private noiseFloor: number;

  constructor(options: PhraseWakeDetectorOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.frameSamples = Math.max(1, Math.round((this.opts.sampleRate * this.opts.frameMs) / 1000));
    this.preRollFrames = Math.max(0, Math.ceil(this.opts.preRollMs / this.opts.frameMs));
    this.noiseFloor = this.opts.absoluteFloor;
  }

  reset(): void {
    this.pending = new Int16Array(0);
    this.ring = [];
    this.segment = [];
    this.speaking = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.activeMs = 0;
    this.noiseFloor = this.opts.absoluteFloor;
  }

  /**
   * Feed an arbitrary-length PCM chunk. Chunks are buffered internally into
   * fixed frames, so callers need not align to frame boundaries.
   *
   * Returns a completed segment (pre-roll + speech + trailing silence) when
   * speech ran for >= `minSpeechMs` and was then followed by
   * `trailingSilenceMs` of silence, or when `maxSegmentMs` is reached mid-
   * speech. Returns null otherwise. Segments with too little speech are
   * discarded rather than returned.
   *
   * At most one segment is returned per call; any audio after the segment
   * boundary is carried over to the next call.
   */
  feed(pcm: Int16Array): Int16Array | null {
    if (!pcm || pcm.length === 0) return null;

    const buf = new Int16Array(this.pending.length + pcm.length);
    buf.set(this.pending, 0);
    buf.set(pcm, this.pending.length);

    let off = 0;
    let out: Int16Array | null = null;
    while (buf.length - off >= this.frameSamples) {
      // Copy: the caller's buffer (and ours) must not be aliased by retained frames.
      const frame = buf.slice(off, off + this.frameSamples);
      off += this.frameSamples;
      const seg = this.pushFrame(frame);
      if (seg) {
        out = seg;
        break;
      }
    }

    this.pending = buf.slice(off);
    return out;
  }

  /** Advance the state machine by exactly one frame. */
  private pushFrame(frame: Int16Array): Int16Array | null {
    const rms = frameRms(frame);
    const speechLine = Math.max(this.opts.absoluteFloor, this.noiseFloor * this.opts.speechFactor);
    const isSpeech = rms > speechLine;

    // Adapt the ambient floor only while below the speech line, so a steady hum
    // lifts the bar instead of registering as an utterance.
    if (!isSpeech) {
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    }

    if (!this.speaking) {
      if (!isSpeech) {
        this.ring.push(frame);
        if (this.ring.length > this.preRollFrames) this.ring.shift();
        return null;
      }
      // Speech onset — open a segment that starts with the buffered pre-roll.
      this.segment = [...this.ring, frame];
      this.ring = [];
      this.speaking = true;
      this.speechMs = this.opts.frameMs;
      this.silenceMs = 0;
      this.activeMs = this.opts.frameMs;
      return this.opts.maxSegmentMs <= this.opts.frameMs ? this.close() : null;
    }

    this.segment.push(frame);
    this.activeMs += this.opts.frameMs;
    if (isSpeech) {
      this.speechMs += this.opts.frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += this.opts.frameMs;
    }

    // Hard cap wins: cut here so a long monologue can still be checked for the
    // wake word (and can't grow the buffer without bound).
    if (this.activeMs >= this.opts.maxSegmentMs) return this.close();

    // End of utterance.
    if (this.silenceMs >= this.opts.trailingSilenceMs) return this.close();

    return null;
  }

  /** Finish the current segment: emit it if it holds enough speech, else drop it. */
  private close(): Int16Array | null {
    const frames = this.segment;
    const enough = this.speechMs >= this.opts.minSpeechMs;

    this.segment = [];
    this.ring = [];
    this.speaking = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.activeMs = 0;

    if (!enough) return null;

    let total = 0;
    for (const f of frames) total += f.length;
    const out = new Int16Array(total);
    let o = 0;
    for (const f of frames) {
      out.set(f, o);
      o += f.length;
    }
    return out;
  }
}
