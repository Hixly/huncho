import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import { IPC, WakePcmChunkPayload } from '../shared/ipc-types';

/**
 * Always-on wake word detection ("Jarvis" built-in now, custom "Huncho" .ppn
 * later). The panel renderer taps its pre-warmed mic stream, downsamples to
 * 16kHz Int16 PCM, and streams chunks here over IPC. Porcupine runs fully
 * on-device — nothing leaves the machine until AFTER the wake word fires.
 *
 * Emits 'wake' when the keyword is detected. Requires PICOVOICE_ACCESS_KEY
 * in huncho/.env; without it the monitor logs once and stays dormant.
 */
export class WakeWordMonitor extends EventEmitter {
  private porcupine: any = null;
  private frameLength = 512;
  private pcmBuffer: Int16Array = new Int16Array(0);
  private lastWakeAt = 0;
  private static readonly WAKE_DEBOUNCE_MS = 2000;

  start(): boolean {
    const accessKey = process.env.PICOVOICE_ACCESS_KEY;
    if (!accessKey) {
      console.log('[WakeWordMonitor] PICOVOICE_ACCESS_KEY not set — wake word disabled (Ctrl+H still works)');
      return false;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Porcupine, BuiltinKeyword } = require('@picovoice/porcupine-node');

      // Custom "Huncho" model wins if the user has trained + dropped one in;
      // otherwise fall back to the built-in "Jarvis" keyword.
      const customPpn = path.join(app.getAppPath(), 'assets', 'wake', 'huncho_windows.ppn');
      if (fs.existsSync(customPpn)) {
        this.porcupine = new Porcupine(accessKey, [customPpn], [0.6]);
        console.log('[WakeWordMonitor] Listening for custom wake word "Huncho"');
      } else {
        this.porcupine = new Porcupine(accessKey, [BuiltinKeyword.JARVIS], [0.6]);
        console.log('[WakeWordMonitor] Listening for built-in wake word "Jarvis" (drop assets/wake/huncho_windows.ppn to upgrade)');
      }
      this.frameLength = this.porcupine.frameLength;
    } catch (err) {
      console.error('[WakeWordMonitor] Failed to initialize Porcupine:', err);
      this.porcupine = null;
      return false;
    }

    ipcMain.on(IPC.WAKE_PCM_CHUNK, (_event, payload: WakePcmChunkPayload) => {
      this.ingest(payload.pcmBase64);
    });
    return true;
  }

  /** Append a base64 Int16 PCM chunk and run detection over complete frames. */
  private ingest(pcmBase64: string): void {
    if (!this.porcupine) return;
    try {
      const raw = Buffer.from(pcmBase64, 'base64');
      const incoming = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));

      const merged = new Int16Array(this.pcmBuffer.length + incoming.length);
      merged.set(this.pcmBuffer);
      merged.set(incoming, this.pcmBuffer.length);

      let offset = 0;
      while (merged.length - offset >= this.frameLength) {
        const frame = merged.subarray(offset, offset + this.frameLength);
        offset += this.frameLength;
        const keywordIndex = this.porcupine.process(frame);
        if (keywordIndex >= 0) {
          const now = Date.now();
          if (now - this.lastWakeAt > WakeWordMonitor.WAKE_DEBOUNCE_MS) {
            this.lastWakeAt = now;
            console.log('[WakeWordMonitor] WAKE WORD detected');
            this.emit('wake');
          }
        }
      }
      this.pcmBuffer = merged.slice(offset);
    } catch (err) {
      console.warn('[WakeWordMonitor] ingest error:', err);
    }
  }

  destroy(): void {
    ipcMain.removeAllListeners(IPC.WAKE_PCM_CHUNK);
    if (this.porcupine) {
      try { this.porcupine.release(); } catch { /* already released */ }
      this.porcupine = null;
    }
  }
}
