import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mutable config so tests can flip the engine. Wrapped in vi.hoisted so it
// exists before the hoisted vi.mock factory runs.
const mockConfig = vi.hoisted(() => ({
  workerBaseURL: 'https://worker.test',
  sttEngine: 'moonshine' as 'moonshine' | 'assemblyai',
  moonshineModel: 'base' as 'base' | 'tiny',
}));
vi.mock('../config', () => ({ DUXY_CONFIG: mockConfig }));

import { IPC } from '../../shared/ipc-types';
import { AudioRecorder } from '../AudioRecorder';
import { MoonshineTranscriber } from '../stt/MoonshineTranscriber';

function pcmChunkPayload(samples: number[]): { pcmBase64: string } {
  const int16 = new Int16Array(samples);
  const b64 = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString('base64');
  return { pcmBase64: b64 };
}

function feedWakePcm(samples: number[]) {
  ipcHandlers[IPC.WAKE_PCM_CHUNK]?.(null, pcmChunkPayload(samples));
}

function feedAudioBlob() {
  ipcHandlers[IPC.MIC_PCM_CHUNK]?.(null, { pcmBase64: '__AUDIO__:' + Buffer.from('webm-bytes').toString('base64') });
}

/** Wait a tick for the async utterance handler to settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AudioRecorder STT engine selection & fallback', () => {
  beforeEach(() => {
    mockConfig.sttEngine = 'moonshine';
    vi.restoreAllMocks();
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transcript: 'cloud transcript' }),
      text: async () => '',
    }));
  });

  it('uses the local Moonshine transcriber when sttEngine=moonshine', async () => {
    const rec = new AudioRecorder();
    const transcribe = vi.fn(async (_pcm: Int16Array, _sr: number) => 'local transcript');
    rec.setLocalTranscriber({ transcribe } as unknown as MoonshineTranscriber);

    const got: string[] = [];
    rec.setTranscriptReadyCallback((t) => got.push(t));

    await rec.startRecording();
    feedWakePcm([100, 200, 300]);
    feedWakePcm([400, 500]);
    await rec.stopRecording();
    feedAudioBlob();
    await flush();

    expect(transcribe).toHaveBeenCalledTimes(1);
    // Buffered 5 samples should have reached the transcriber at 16kHz.
    const pcmArg = transcribe.mock.calls[0][0] as Int16Array;
    expect(pcmArg.length).toBe(5);
    expect(transcribe.mock.calls[0][1]).toBe(16000);
    expect(got).toEqual(['local transcript']);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('falls back to the cloud path when Moonshine throws', async () => {
    const rec = new AudioRecorder();
    rec.setLocalTranscriber({
      transcribe: vi.fn(async () => {
        throw new Error('model exploded');
      }),
    } as unknown as MoonshineTranscriber);

    const got: string[] = [];
    rec.setTranscriptReadyCallback((t) => got.push(t));

    await rec.startRecording();
    feedWakePcm([1, 2, 3]);
    await rec.stopRecording();
    feedAudioBlob();
    await flush();

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(got).toEqual(['cloud transcript']);
  });

  it('falls back to the cloud path when Moonshine returns empty text', async () => {
    const rec = new AudioRecorder();
    rec.setLocalTranscriber({ transcribe: vi.fn(async () => '') } as unknown as MoonshineTranscriber);
    const got: string[] = [];
    rec.setTranscriptReadyCallback((t) => got.push(t));

    await rec.startRecording();
    feedWakePcm([1, 2, 3]);
    await rec.stopRecording();
    feedAudioBlob();
    await flush();

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(got).toEqual(['cloud transcript']);
  });

  it('uses the cloud path directly when sttEngine=assemblyai', async () => {
    mockConfig.sttEngine = 'assemblyai';
    const rec = new AudioRecorder();
    const transcribe = vi.fn(async () => 'local');
    rec.setLocalTranscriber({ transcribe } as unknown as MoonshineTranscriber);
    const got: string[] = [];
    rec.setTranscriptReadyCallback((t) => got.push(t));

    await rec.startRecording();
    feedWakePcm([1, 2, 3]);
    await rec.stopRecording();
    feedAudioBlob();
    await flush();

    expect(transcribe).not.toHaveBeenCalled();
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(got).toEqual(['cloud transcript']);
  });

  it('does not buffer wake PCM when not recording', async () => {
    const rec = new AudioRecorder();
    const transcribe = vi.fn(async () => 'local transcript');
    rec.setLocalTranscriber({ transcribe } as unknown as MoonshineTranscriber);
    const got: string[] = [];
    rec.setTranscriptReadyCallback((t) => got.push(t));

    // PCM before any recording is ignored; with no buffered PCM the handler
    // falls through to cloud.
    feedWakePcm([1, 2, 3]);
    await rec.startRecording();
    await rec.stopRecording();
    feedAudioBlob();
    await flush();

    expect(transcribe).not.toHaveBeenCalled();
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });
});
