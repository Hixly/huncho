/**
 * Voice endpointing (auto-stop after silence) for the wake/PTT listen window.
 *
 * Pure and dependency-free (no Electron) so it can be unit-tested with
 * synthesized Int16 PCM frames. The AudioRecorder feeds it every 16kHz mono
 * frame it buffers while recording; when the user stops speaking (a run of
 * silence past `silenceMs`) it returns 'stop', which the caller routes to the
 * exact same stop-listening path as a manual Ctrl+H toggle.
 *
 * Threshold strategy: track a rolling noise floor (EMA of recent frame RMS
 * while below the speech line). A frame counts as speech when its RMS exceeds
 * max(absoluteFloor, noiseFloor * speechFactor) — so a constant moderate hum
 * lifts the floor and never registers as speech, while real speech (which sits
 * well above the ambient floor) does.
 */

export interface EndpointerOptions {
  /** Trailing silence after speech that ends the utterance. */
  silenceMs?: number;
  /** If no speech is ever heard within this window, cancel (discard). */
  noSpeechMs?: number;
  /** Hard cap on total utterance length. */
  maxUtteranceMs?: number;
  /** Nominal frame duration (informational; decisions use the supplied nowMs). */
  frameMs?: number;
  /** Absolute Int16 RMS below which audio is always treated as silence. */
  absoluteFloor?: number;
  /** A frame is speech when RMS > noiseFloor * this factor (and > absoluteFloor). */
  speechFactor?: number;
}

export type EndpointDecision = 'continue' | 'stop' | 'cancel';

type EndpointState = 'WAITING' | 'SPEAKING';

const DEFAULTS: Required<EndpointerOptions> = {
  silenceMs: 1400,
  noSpeechMs: 6000,
  maxUtteranceMs: 15000,
  frameMs: 80,
  absoluteFloor: 500,
  speechFactor: 3,
};

/** Root-mean-square amplitude of an Int16 PCM frame. */
export function frameRms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i];
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

export class Endpointer {
  private readonly opts: Required<EndpointerOptions>;

  private state: EndpointState = 'WAITING';
  private startMs = -1;
  private lastSpeechMs = -1;
  private speechSeen = false;
  // Rolling ambient floor (EMA of sub-speech frame RMS). Starts at absoluteFloor
  // so the very first frame can already register as speech, then adapts UP to
  // track a steady hum (never seeded from a frame that might itself be speech).
  private noiseFloor: number;
  private decided = false;  // latch: once we return stop/cancel, ignore further frames

  constructor(options: EndpointerOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.noiseFloor = this.opts.absoluteFloor;
  }

  reset(): void {
    this.state = 'WAITING';
    this.startMs = -1;
    this.lastSpeechMs = -1;
    this.speechSeen = false;
    this.noiseFloor = this.opts.absoluteFloor;
    this.decided = false;
  }

  /**
   * Feed one PCM frame. Returns:
   *   'continue' — keep listening
   *   'stop'     — user finished speaking (or hit max); transcribe normally
   *   'cancel'   — no usable speech (never spoke, or timed out); discard
   * After a terminal decision, subsequent feeds return 'continue' (the caller
   * has already stopped) until reset() is called.
   */
  feed(frame: Int16Array, nowMs: number): EndpointDecision {
    if (this.decided) return 'continue';

    if (this.startMs < 0) this.startMs = nowMs;
    const elapsed = nowMs - this.startMs;

    const rms = frameRms(frame);
    const speechLine = Math.max(this.opts.absoluteFloor, this.noiseFloor * this.opts.speechFactor);
    const isSpeech = rms > speechLine;

    // Adapt the noise floor only while below the speech line (ambient tracking).
    if (!isSpeech) {
      this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    }

    // Hard cap always wins: stop if we captured speech, else discard.
    if (elapsed > this.opts.maxUtteranceMs) {
      return this.decide(this.speechSeen ? 'stop' : 'cancel');
    }

    if (this.state === 'WAITING') {
      if (isSpeech) {
        this.speechSeen = true;
        this.state = 'SPEAKING';
        this.lastSpeechMs = nowMs;
      } else if (elapsed > this.opts.noSpeechMs) {
        return this.decide('cancel');
      }
      return 'continue';
    }

    // SPEAKING
    if (isSpeech) {
      this.lastSpeechMs = nowMs;
    } else if (nowMs - this.lastSpeechMs > this.opts.silenceMs) {
      return this.decide('stop');
    }
    return 'continue';
  }

  private decide(decision: 'stop' | 'cancel'): EndpointDecision {
    this.decided = true;
    return decision;
  }
}
