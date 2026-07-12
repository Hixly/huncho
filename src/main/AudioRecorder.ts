import { ipcMain } from 'electron';
import { IPC, MicPcmChunkPayload, WakePcmChunkPayload } from '../shared/ipc-types';
import { DUXY_CONFIG } from './config';
import { MoonshineTranscriber } from './stt/MoonshineTranscriber';

// Callback type for when transcription completes
type TranscriptReadyCallback = (transcript: string) => void;

// The panel mic tap streams 16kHz mono Int16 PCM continuously (for the wake
// word). We piggyback on that same stream for local STT so no renderer changes
// are needed: while recording, buffer the wake-tap frames and hand them to
// Moonshine when the utterance ends.
const WAKE_PCM_SAMPLE_RATE = 16000;
// Guard against runaway buffers if a recording is never stopped (~60s @16kHz).
const MAX_BUFFERED_SAMPLES = WAKE_PCM_SAMPLE_RATE * 60;

export class AudioRecorder {
  private isRecording = false;
  private onTranscriptReady: TranscriptReadyCallback | null = null;
  private moonshine: MoonshineTranscriber | null = null;

  // PCM captured from the wake-tap stream during the current recording window.
  private pcmFrames: Int16Array[] = [];
  private pcmSampleCount = 0;
  // Frozen snapshot of the utterance PCM, taken at stopRecording().
  private capturedPcm: Int16Array | null = null;

  constructor() {
    this.setupIpcListeners();
  }

  setTranscriptReadyCallback(callback: TranscriptReadyCallback): void {
    this.onTranscriptReady = callback;
  }

  /** Inject the local transcriber (constructed by CompanionManager with the
   *  Electron userData cache dir). Enables the local STT fast-path. */
  setLocalTranscriber(transcriber: MoonshineTranscriber): void {
    this.moonshine = transcriber;
  }

  private setupIpcListeners(): void {
    ipcMain.on(IPC.MIC_PCM_CHUNK, (_event, payload: MicPcmChunkPayload) => {
      const data = payload.pcmBase64;

      // Audio blob sent from renderer after MediaRecorder stops
      if (data.startsWith('__AUDIO__:')) {
        const audioBase64 = data.slice('__AUDIO__:'.length);
        this.handleUtterance(audioBase64);
        return;
      }

      // Partial transcript text for live display (just forward, no processing needed)
      if (this.isRecording) {
        console.log('[AudioRecorder] Partial audio update received');
      }
    });

    // Piggyback on the always-on wake-tap PCM stream. WakeWordMonitor also
    // listens on this channel — multiple ipcMain listeners are fine. We only
    // retain frames while actively recording an utterance.
    ipcMain.on(IPC.WAKE_PCM_CHUNK, (_event, payload: WakePcmChunkPayload) => {
      if (!this.isRecording) return;
      if (this.pcmSampleCount >= MAX_BUFFERED_SAMPLES) return;
      try {
        const raw = Buffer.from(payload.pcmBase64, 'base64');
        const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
        // Copy out — the underlying Buffer is pooled and may be reused.
        this.pcmFrames.push(new Int16Array(pcm));
        this.pcmSampleCount += pcm.length;
      } catch (err) {
        console.warn('[AudioRecorder] Failed to buffer wake PCM chunk:', err);
      }
    });
  }

  /** Decide how to transcribe a finished utterance: local Moonshine first (when
   *  selected), with an automatic fall back to the cloud Whisper proxy. */
  private async handleUtterance(audioBase64: string): Promise<void> {
    const engine = DUXY_CONFIG.sttEngine;
    const pcm = this.capturedPcm;
    this.capturedPcm = null;

    if (engine === 'moonshine' && this.moonshine && pcm && pcm.length > 0) {
      try {
        const transcript = await this.moonshine.transcribe(pcm, WAKE_PCM_SAMPLE_RATE);
        if (transcript) {
          console.log('[AudioRecorder] Transcript from Moonshine (local):', transcript);
          this.onTranscriptReady?.(transcript);
          return;
        }
        console.warn('[AudioRecorder] Moonshine returned empty text — falling back to cloud');
      } catch (err) {
        console.warn('[AudioRecorder] Moonshine failed — falling back to cloud Whisper proxy:', err);
      }
    }

    // Cloud fallback (also the path when sttEngine === 'assemblyai' or no local PCM).
    await this.transcribeAudioViaCloud(audioBase64);
  }

  private async transcribeAudioViaCloud(audioBase64: string): Promise<void> {
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
        console.error('[AudioRecorder] Cloud transcription failed:', errText);
        return;
      }

      const result = await response.json() as { transcript: string };
      const transcript = result.transcript?.trim();
      console.log('[AudioRecorder] Transcript from cloud:', transcript);

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
    this.pcmFrames = [];
    this.pcmSampleCount = 0;
    this.capturedPcm = null;
    this.isRecording = true;
  }

  async stopRecording(): Promise<string> {
    if (!this.isRecording) return '';
    console.log('[AudioRecorder] Stopping recording session — waiting for transcription');
    this.isRecording = false;
    // Freeze the buffered utterance PCM so the async __AUDIO__ blob handler can
    // use it (or fall back to cloud). Flatten the captured frames into one array.
    this.capturedPcm = this.flattenPcm();
    this.pcmFrames = [];
    this.pcmSampleCount = 0;
    // Audio blob will arrive asynchronously via __AUDIO__: IPC message
    return '';
  }

  private flattenPcm(): Int16Array | null {
    if (this.pcmSampleCount === 0) return null;
    const out = new Int16Array(this.pcmSampleCount);
    let offset = 0;
    for (const frame of this.pcmFrames) {
      out.set(frame, offset);
      offset += frame.length;
    }
    return out;
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }
}
