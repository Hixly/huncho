import { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-types';

// msedge-tts gives us free access to Microsoft's neural voices — no API key needed
let MsEdgeTTS: any;
let OUTPUT_FORMAT: any;

try {
  const edgeTts = require('msedge-tts');
  MsEdgeTTS = edgeTts.MsEdgeTTS;
  OUTPUT_FORMAT = edgeTts.OUTPUT_FORMAT;
} catch (err) {
  console.error('[EdgeTTS] Failed to load msedge-tts:', err);
}

// Brian = casual, approachable, warm — perfect voice for Duxy the duck companion
const VOICE = 'en-US-BrianNeural';

export class EdgeTTSClient {
  private tts: any = null;
  private ready = false;

  async initialize(): Promise<void> {
    if (!MsEdgeTTS) {
      console.error('[EdgeTTS] msedge-tts not available');
      return;
    }

    try {
      this.tts = new MsEdgeTTS();
      await this.tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      this.ready = true;
      console.log(`[EdgeTTS] Initialized with voice: ${VOICE}`);
    } catch (err) {
      console.error('[EdgeTTS] Failed to initialize:', err);
    }
  }

  // Escape XML special chars so they don't corrupt the SSML envelope
  private sanitize(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private sendFallback(text: string, targetWindows: BrowserWindow[]): void {
    for (const win of targetWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TTS_SPEAK_TEXT, { text });
      }
    }
  }

  async speak(text: string, targetWindows: BrowserWindow[]): Promise<void> {
    if (!this.ready || !this.tts) {
      console.warn('[EdgeTTS] Not ready, falling back to browser speechSynthesis');
      this.sendFallback(text, targetWindows);
      return;
    }

    try {
      const safeText = this.sanitize(text);
      console.log(`[EdgeTTS] Generating speech for: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);

      // Collect audio stream into a buffer
      const { audioStream } = await this.tts.toStream(safeText);
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        audioStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        audioStream.on('end', () => resolve());
        audioStream.on('close', () => resolve());
        audioStream.on('error', (err: Error) => reject(err));
      });

      const audioBuffer = Buffer.concat(chunks);
      console.log(`[EdgeTTS] Generated ${audioBuffer.length} bytes of audio`);

      // Empty buffer = SSML/network issue — fall back to speechSynthesis
      if (audioBuffer.length === 0) {
        console.warn('[EdgeTTS] Empty audio buffer, falling back to browser speechSynthesis');
        this.sendFallback(text, targetWindows);
        return;
      }

      const audioBase64 = audioBuffer.toString('base64');

      // Send to renderer for playback
      for (const win of targetWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.TTS_PLAY_AUDIO, { audioBase64 });
        }
      }
    } catch (err) {
      console.error('[EdgeTTS] Speech generation failed:', err);
      this.sendFallback(text, targetWindows);
    }
  }
}
