import { BrowserWindow } from 'electron';
import { DUXY_CONFIG } from './config';
import { IPC } from '../shared/ipc-types';

export class ElevenLabsTTSClient {
  private isPlaying = false;

  async speak(text: string, targetWindows: BrowserWindow[]): Promise<void> {
    if (!text.trim()) {
      console.warn('[ElevenLabsTTS] Empty text, skipping TTS');
      return;
    }

    if (this.isPlaying) {
      console.warn('[ElevenLabsTTS] Already playing, queueing request');
    }

    this.isPlaying = true;

    try {
      const requestBody = {
        text,
        model_id: DUXY_CONFIG.ttsModel,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      };

      console.log(`[ElevenLabsTTS] Requesting TTS for: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);

      const response = await fetch(`${DUXY_CONFIG.workerBaseURL}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`[ElevenLabsTTS] TTS error ${response.status}: ${errText}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString('base64');

      console.log(`[ElevenLabsTTS] Received audio: ${audioBuffer.byteLength} bytes`);

      // Send audio to all renderer windows for playback
      for (const win of targetWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.TTS_PLAY_AUDIO, { audioBase64 });
        }
      }
    } catch (err) {
      console.error('[ElevenLabsTTS] Error:', err);
      throw err;
    } finally {
      // Rough estimate: audio finishes playing asynchronously in renderer
      // We mark isPlaying false here; renderer will confirm via playback events
      this.isPlaying = false;
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  stop(): void {
    this.isPlaying = false;
  }
}

