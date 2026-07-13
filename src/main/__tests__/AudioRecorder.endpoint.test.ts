import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (declared before importing the module under test) ---------------

const ipcHandlers: Record<string, (event: unknown, payload: unknown) => void> = {};
vi.mock('electron', () => ({
  ipcMain: {
    on: (ch: string, cb: (event: unknown, payload: unknown) => void) => {
      ipcHandlers[ch] = cb;
    },
    removeAllListeners: (ch?: string) => {
      if (ch) delete ipcHandlers[ch];
    },
  },
}));

// Config WITH endpointing enabled and small thresholds so the state machine
// reaches its decisions within a handful of synthesized frames.
const mockConfig = vi.hoisted(() => ({
  workerBaseURL: 'https://worker.test',
  sttEngine: 'moonshine' as 'moonshine' | 'assemblyai',
  moonshineModel: 'base' as 'base' | 'tiny',
  endpointing: { enabled: true, silenceMs: 300, noSpeechMs: 1000, maxUtteranceMs: 5000 },
}));
vi.mock('../config', () => ({ DUXY_CONFIG: mockConfig }));

import { IPC } from '../../shared/ipc-types';
import { AudioRecorder } from '../AudioRecorder';
import { MoonshineTranscriber } from '../stt/MoonshineTranscriber';

const FRAME_LEN = 1280; // 80ms @ 16kHz
const FRAME_MS = 80;

function frameB64(amplitude: number): { pcmBase64: string } {
  const int16 = new Int16Array(FRAME_LEN);
  for (let i = 0; i < FRAME_LEN; i++) int16[i] = i % 2 === 0 ? amplitude : -amplitude;
  return { pcmBase64: Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString('base64') };
}

function feedWake(amplitude: number) {
  ipcHandlers[IPC.WAKE_PCM_CHUNK]?.(null, frameB64(amplitude));
}

function feedAudioBlob() {
  ipcHandlers[IPC.MIC_PCM_CHUNK]?.(null, { pcmBase64: '__AUDIO__:' + Buffer.from('webm').toString('base64') });
}

describe('AudioRecorder endpointing wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    (global as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ transcript: 'x' }), text: async () => '' }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the endpoint callback with 'stop' after speech then silence", async () => {
    const rec = new AudioRecorder();
    const reasons: string[] = [];
    rec.setEndpointCallback((r) => reasons.push(r));

    await rec.startRecording();
    // ~0.5s of speech.
    for (let i = 0; i < 6; i++) { feedWake(8000); vi.advanceTimersByTime(FRAME_MS); }
    // Silence past silenceMs (300ms) → 'stop'.
    for (let i = 0; i < 8 && reasons.length === 0; i++) { feedWake(0); vi.advanceTimersByTime(FRAME_MS); }

    expect(reasons).toEqual(['stop']);
  });

  it("fires 'cancel' when no speech is heard, and discards the utterance (no transcription)", async () => {
    const rec = new AudioRecorder();
    const transcribe = vi.fn(async () => 'local');
    rec.setLocalTranscriber({ transcribe } as unknown as MoonshineTranscriber);
    const reasons: string[] = [];
    rec.setEndpointCallback((r) => reasons.push(r));

    await rec.startRecording();
    // Only silence, past noSpeechMs (1000ms) → 'cancel'.
    for (let i = 0; i < 20 && reasons.length === 0; i++) { feedWake(0); vi.advanceTimersByTime(FRAME_MS); }
    expect(reasons).toEqual(['cancel']);

    // Manual-stop path would call stopRecording; then the blob arrives and must
    // be discarded (discardCurrent latched by the cancel decision).
    await rec.stopRecording();
    vi.useRealTimers();
    feedAudioBlob();
    await new Promise((r) => setTimeout(r, 0));

    expect(transcribe).not.toHaveBeenCalled();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('resets the endpointer on each startRecording (no stale decision carryover)', async () => {
    const rec = new AudioRecorder();
    const reasons: string[] = [];
    rec.setEndpointCallback((r) => reasons.push(r));

    // First session cancels on silence.
    await rec.startRecording();
    for (let i = 0; i < 20 && reasons.length === 0; i++) { feedWake(0); vi.advanceTimersByTime(FRAME_MS); }
    expect(reasons).toEqual(['cancel']);
    await rec.stopRecording();

    // Second session: speech should be recognized fresh and stop on silence.
    reasons.length = 0;
    await rec.startRecording();
    for (let i = 0; i < 6; i++) { feedWake(8000); vi.advanceTimersByTime(FRAME_MS); }
    for (let i = 0; i < 8 && reasons.length === 0; i++) { feedWake(0); vi.advanceTimersByTime(FRAME_MS); }
    expect(reasons).toEqual(['stop']);
  });
});
