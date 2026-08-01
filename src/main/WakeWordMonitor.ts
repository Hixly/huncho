import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import { IPC, WakePcmChunkPayload } from '../shared/ipc-types';
import { DUXY_CONFIG } from './config';
import { OpenWakeWord } from './wake/OpenWakeWord';
import { PhraseWakeDetector } from './wake/PhraseWakeDetector';
import { matchesWake, DEFAULT_WAKE_VARIANTS } from './wake/wake-phrase';
import { MoonshineTranscriber } from './stt/MoonshineTranscriber';

/**
 * Always-on wake word detection, fully local and keyless. The panel renderer
 * taps its pre-warmed mic stream, downsamples to 16kHz Int16 PCM, and streams
 * chunks here over IPC (`WAKE_PCM_CHUNK`). Nothing leaves the machine until
 * AFTER the wake word fires — no API keys, no cloud. Emits 'wake'.
 *
 * Two engines, selected by `DUXY_CONFIG.wakeEngine`:
 *
 *  • 'phrase' (DEFAULT) — no model training and no trademarked phrase.
 *    `PhraseWakeDetector` segments the stream into short candidate utterances;
 *    each is transcribed locally by Moonshine (tiny) and matched against
 *    `wakeVariants` by `matchesWake`. This is what lets Huncho answer to
 *    "Huncho", a word no pretrained wake model exists for.
 *
 *  • 'onnx' — the openWakeWord melspectrogram → embedding → wake-model
 *    pipeline. Cheaper per second of audio, but requires a trained model. The
 *    bundled pretrained model is "hey jarvis" — Marvel/Disney IP that must not
 *    be shipped publicly; train `assets/wake/huncho.onnx` instead.
 *
 * See docs/WAKE_WORD.md.
 */

/** Minimal transcriber surface used by the phrase engine (injectable for tests). */
export interface WakeTranscriber {
  warmup(): Promise<void>;
  transcribe(pcm: Int16Array, sampleRate: number): Promise<string>;
}

export interface WakeWordMonitorOptions {
  /** Inject a transcriber (tests). Production constructs a MoonshineTranscriber. */
  transcriber?: WakeTranscriber;
}

const WAKE_SAMPLE_RATE = 16000;

export class WakeWordMonitor extends EventEmitter {
  private oww: OpenWakeWord | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastWakeAt = 0;
  private destroyed = false;
  private paused = false;
  private static readonly WAKE_DEBOUNCE_MS = 2000;

  // Phrase-engine state
  private detector: PhraseWakeDetector | null = null;
  private transcriber: WakeTranscriber | null = null;
  private readonly injectedTranscriber?: WakeTranscriber;
  /** True while a wake transcription is running; new segments are dropped. */
  private transcribing = false;

  constructor(options: WakeWordMonitorOptions = {}) {
    super();
    this.injectedTranscriber = options.transcriber;
  }

  start(): boolean {
    return DUXY_CONFIG.wakeEngine === 'onnx' ? this.startOnnx() : this.startPhrase();
  }

  /**
   * Suspend/resume PCM ingestion. Paused means incoming audio is dropped on the
   * floor — not buffered, not transcribed. Two reasons this matters:
   *   1. CPU: no point running ASR while Huncho is already awake and busy.
   *   2. Self-triggering: while Huncho is listening/thinking/speaking, the mic
   *      hears the user's actual command AND Huncho's own TTS coming out of the
   *      speakers. Either could contain the wake word and re-trigger a wake
   *      mid-turn. CompanionManager pauses on every departure from 'idle'.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    // Drop any half-built segment so resuming starts from clean silence.
    if (paused) this.detector?.reset();
  }

  // ── Phrase engine (default) ────────────────────────────────────────────────

  private startPhrase(): boolean {
    this.detector = new PhraseWakeDetector({ sampleRate: WAKE_SAMPLE_RATE });
    this.transcriber =
      this.injectedTranscriber ??
      new MoonshineTranscriber({
        cacheDir: path.join(app.getPath('userData'), 'models'),
        model: DUXY_CONFIG.wakeMoonshineModel,
      });

    const variants = DUXY_CONFIG.wakeVariants?.length ? DUXY_CONFIG.wakeVariants : DEFAULT_WAKE_VARIANTS;
    console.log(
      `[WakeWordMonitor] Phrase engine — listening for "${DUXY_CONFIG.wakePhrase}" ` +
      `(${variants.length} accepted variants, Moonshine ${DUXY_CONFIG.wakeMoonshineModel}, local)`
    );

    // Warm the model in the background so the first real utterance isn't
    // stuck behind a download/load. Never throws.
    void this.transcriber.warmup();

    ipcMain.on(IPC.WAKE_PCM_CHUNK, (_event, payload: WakePcmChunkPayload) => {
      this.ingestPhrase(payload.pcmBase64);
    });
    return true;
  }

  private ingestPhrase(pcmBase64: string): void {
    if (this.destroyed || this.paused || !this.detector) return;

    let segment: Int16Array | null;
    try {
      const raw = Buffer.from(pcmBase64, 'base64');
      // Copy out — the underlying Buffer is pooled and may be reused.
      const pcm = new Int16Array(new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2)));
      segment = this.detector.feed(pcm);
    } catch (err) {
      console.warn('[WakeWordMonitor] phrase ingest error:', err);
      return;
    }
    if (!segment) return;

    // Bounded work: exactly one transcription at a time. A segment arriving
    // while one is in flight is DROPPED rather than queued — an unbounded queue
    // would lag further and further behind live audio and wake on stale speech.
    if (this.transcribing) {
      console.debug('[WakeWordMonitor] dropping wake segment — transcription already in flight');
      return;
    }
    this.transcribing = true;

    const pending = segment;
    this.queue = this.queue.then(async () => {
      try {
        if (this.destroyed || this.paused || !this.transcriber) return;
        const text = await this.transcriber.transcribe(pending, WAKE_SAMPLE_RATE);
        if (this.destroyed || this.paused || !text) return;
        const variants = DUXY_CONFIG.wakeVariants?.length ? DUXY_CONFIG.wakeVariants : DEFAULT_WAKE_VARIANTS;
        if (matchesWake(text, variants)) {
          this.fireWake(`phrase match "${text}"`);
        } else {
          console.debug(`[WakeWordMonitor] no wake in "${text}"`);
        }
      } catch (err) {
        console.warn('[WakeWordMonitor] wake transcription failed:', err);
      } finally {
        this.transcribing = false;
      }
    });
  }

  // ── ONNX engine (openWakeWord) ─────────────────────────────────────────────

  private startOnnx(): boolean {
    const wakeDir = path.join(app.getAppPath(), 'assets', 'wake');
    const melModelPath = path.join(wakeDir, 'melspectrogram.onnx');
    const embeddingModelPath = path.join(wakeDir, 'embedding_model.onnx');

    // Custom "Huncho" model wins if the user has trained + dropped one in;
    // otherwise fall back to the pretrained "hey_jarvis" model.
    const customModel = path.join(wakeDir, 'huncho.onnx');
    const isCustom = fs.existsSync(customModel);
    const wakeModelPath = isCustom ? customModel : path.join(wakeDir, 'hey_jarvis_v0.1.onnx');

    if (!fs.existsSync(melModelPath) || !fs.existsSync(embeddingModelPath) || !fs.existsSync(wakeModelPath)) {
      console.error('[WakeWordMonitor] wake model files missing in assets/wake — wake word disabled (Ctrl+H still works)');
      return false;
    }

    if (isCustom) {
      console.log('[WakeWordMonitor] ONNX engine — listening for custom wake word "Huncho"');
    } else {
      console.warn(
        '[WakeWordMonitor] ONNX engine falling back to the pretrained "hey jarvis" model. ' +
        '"Jarvis" is a Marvel/Disney trademark — DO NOT ship this model in a public build. ' +
        'Train assets/wake/huncho.onnx (docs/WAKE_WORD.md), or use wakeEngine: \'phrase\'.'
      );
    }

    // Load the ONNX sessions asynchronously; ingest is buffered until ready.
    OpenWakeWord.create({ wakeModelPath, melModelPath, embeddingModelPath, threshold: 0.5 })
      .then((oww) => {
        if (this.destroyed) return;
        this.oww = oww;
      })
      .catch((err) => {
        console.error('[WakeWordMonitor] Failed to initialize openWakeWord:', err);
      });

    ipcMain.on(IPC.WAKE_PCM_CHUNK, (_event, payload: WakePcmChunkPayload) => {
      this.ingestOnnx(payload.pcmBase64);
    });
    return true;
  }

  /** Append a base64 Int16 PCM chunk and run detection over complete frames. */
  private ingestOnnx(pcmBase64: string): void {
    // Serialize inference so buffers stay ordered even under async ORT runs.
    this.queue = this.queue.then(async () => {
      if (!this.oww || this.destroyed || this.paused) return;
      try {
        const raw = Buffer.from(pcmBase64, 'base64');
        const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
        const scores = await this.oww.ingest(pcm);
        for (const score of scores) {
          if (score >= this.oww.threshold) this.fireWake('onnx score');
        }
      } catch (err) {
        console.warn('[WakeWordMonitor] ingest error:', err);
      }
    });
  }

  // ── Shared ─────────────────────────────────────────────────────────────────

  /** Emit 'wake', respecting the debounce so one utterance triggers once. */
  private fireWake(why: string): void {
    const now = Date.now();
    if (now - this.lastWakeAt <= WakeWordMonitor.WAKE_DEBOUNCE_MS) return;
    this.lastWakeAt = now;
    console.log(`[WakeWordMonitor] WAKE WORD detected (${why})`);
    this.emit('wake');
  }

  destroy(): void {
    this.destroyed = true;
    ipcMain.removeAllListeners(IPC.WAKE_PCM_CHUNK);
    this.oww = null;
    this.detector = null;
    this.transcriber = null;
  }
}
