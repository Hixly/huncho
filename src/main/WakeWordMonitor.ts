import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import { IPC, WakePcmChunkPayload } from '../shared/ipc-types';
import { OpenWakeWord } from './wake/OpenWakeWord';

/**
 * Always-on wake word detection, fully local and keyless via openWakeWord's
 * ONNX pipeline (melspectrogram → speech-embedding → wake model). The panel
 * renderer taps its pre-warmed mic stream, downsamples to 16kHz Int16 PCM, and
 * streams chunks here over IPC. Nothing leaves the machine until AFTER the wake
 * word fires — no API keys, no cloud.
 *
 * Ships with the pretrained "hey_jarvis" model, so say "Jarvis" until a custom
 * "Huncho" model is trained (drop assets/wake/huncho.onnx to upgrade — see
 * docs/WAKE_WORD.md). Emits 'wake' when the keyword is detected.
 */
export class WakeWordMonitor extends EventEmitter {
  private oww: OpenWakeWord | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastWakeAt = 0;
  private destroyed = false;
  private static readonly WAKE_DEBOUNCE_MS = 2000;

  start(): boolean {
    const wakeDir = path.join(app.getAppPath(), 'assets', 'wake');
    const melModelPath = path.join(wakeDir, 'melspectrogram.onnx');
    const embeddingModelPath = path.join(wakeDir, 'embedding_model.onnx');

    // Custom "Huncho" model wins if the user has trained + dropped one in;
    // otherwise fall back to the pretrained "hey_jarvis" model.
    const customModel = path.join(wakeDir, 'huncho.onnx');
    const wakeModelPath = fs.existsSync(customModel)
      ? customModel
      : path.join(wakeDir, 'hey_jarvis_v0.1.onnx');

    if (!fs.existsSync(melModelPath) || !fs.existsSync(embeddingModelPath) || !fs.existsSync(wakeModelPath)) {
      console.error('[WakeWordMonitor] wake model files missing in assets/wake — wake word disabled (Ctrl+H still works)');
      return false;
    }

    const isCustom = wakeModelPath === customModel;
    console.log(
      isCustom
        ? '[WakeWordMonitor] Listening for custom wake word "Huncho"'
        : '[WakeWordMonitor] Listening for wake word "Jarvis" (drop assets/wake/huncho.onnx to upgrade)'
    );

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
      this.ingest(payload.pcmBase64);
    });
    return true;
  }

  /** Append a base64 Int16 PCM chunk and run detection over complete frames. */
  private ingest(pcmBase64: string): void {
    // Serialize inference so buffers stay ordered even under async ORT runs.
    this.queue = this.queue.then(async () => {
      if (!this.oww || this.destroyed) return;
      try {
        const raw = Buffer.from(pcmBase64, 'base64');
        const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
        const scores = await this.oww.ingest(pcm);
        for (const score of scores) {
          if (score >= this.oww.threshold) {
            const now = Date.now();
            if (now - this.lastWakeAt > WakeWordMonitor.WAKE_DEBOUNCE_MS) {
              this.lastWakeAt = now;
              console.log('[WakeWordMonitor] WAKE WORD detected');
              this.emit('wake');
            }
          }
        }
      } catch (err) {
        console.warn('[WakeWordMonitor] ingest error:', err);
      }
    });
  }

  destroy(): void {
    this.destroyed = true;
    ipcMain.removeAllListeners(IPC.WAKE_PCM_CHUNK);
    this.oww = null;
  }
}
