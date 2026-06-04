import { ipcMain } from 'electron';
import { IPC, MicPcmChunkPayload } from '../shared/ipc-types';
import { DUXY_CONFIG } from './config';

// Callback type for when transcription completes
type TranscriptReadyCallback = (transcript: string) => void;

export class AudioRecorder {
  private isRecording = false;
  private onTranscriptReady: TranscriptReadyCallback | null = null;

  constructor() {
    this.setupIpcListeners();
  }

  setTranscriptReadyCallback(callback: TranscriptReadyCallback): void {
    this.onTranscriptReady = callback;
  }

  private setupIpcListeners(): void {
    ipcMain.on(IPC.MIC_PCM_CHUNK, (_event, payload: MicPcmChunkPayload) => {
      const data = payload.pcmBase64;

      // Audio blob sent from renderer after MediaRecorder stops
      if (data.startsWith('__AUDIO__:')) {
        const audioBase64 = data.slice('__AUDIO__:'.length);
        console.log('[AudioRecorder] Audio blob received, sending to Groq Whisper...');
        this.transcribeAudio(audioBase64);
        return;
      }

      // Partial transcript text for live display (just forward, no processing needed)
      if (this.isRecording) {
        console.log('[AudioRecorder] Partial audio update received');
      }
    });
  }

  private async transcribeAudio(audioBase64: string): Promise<void> {
    try {
      // Decode base64 to raw binary and send directly (avoids JSON encode/decode corruption)
      const binary = Buffer.from(audioBase64, 'base64');
      console.log(`[AudioRecorder] Sending ${binary.length} bytes to worker`);

      const response = await fetch(`${DUXY_CONFIG.workerBaseURL}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: binary,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[AudioRecorder] Groq transcription failed:', errText);
        return;
      }

      const result = await response.json() as { transcript: string };
      const transcript = result.transcript?.trim();
      console.log('[AudioRecorder] Transcript from Groq:', transcript);

      if (transcript && this.onTranscriptReady) {
        this.onTranscriptReady(transcript);
      }
    } catch (err) {
      console.error('[AudioRecorder] Transcription request error:', err);
    }
  }

  async startRecording(): Promise<void> {
    if (this.isRecording) return;
    console.log('[AudioRecorder] Starting recording session');
    this.isRecording = true;
  }

  async stopRecording(): Promise<string> {
    if (!this.isRecording) return '';
    console.log('[AudioRecorder] Stopping recording session — waiting for Groq Whisper result');
    this.isRecording = false;
    // Audio blob will arrive asynchronously via __AUDIO__: IPC message
    return '';
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }
}
