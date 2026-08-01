import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (declared before importing the module under test) ---------------

vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>();
  return { DUXY_CONFIG: { ...actual.DUXY_CONFIG, wakeEngine: 'phrase' } };
});

const ipcHandlers: Record<string, (event: unknown, payload: unknown) => void> = {};
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app', getPath: () => '/userData' },
  ipcMain: {
    on: (ch: string, cb: (event: unknown, payload: unknown) => void) => { ipcHandlers[ch] = cb; },
    removeAllListeners: (ch?: string) => { if (ch) delete ipcHandlers[ch]; },
  },
}));

vi.mock('fs', () => ({ existsSync: () => true }));

import { WakeWordMonitor } from '../WakeWordMonitor';
import { IPC } from '../../shared/ipc-types';

// --- Audio helpers ---------------------------------------------------------

const SR = 16000;
const LOUD = 8000;
const QUIET = 20;

function tone(ms: number, amplitude: number): Int16Array {
  const n = Math.round((SR * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = i % 2 === 0 ? amplitude : -amplitude;
  return out;
}

function firePcm(samples: Int16Array): void {
  const b64 = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
  ipcHandlers[IPC.WAKE_PCM_CHUNK]?.(null, { pcmBase64: b64 });
}

/** Ambient → utterance → trailing silence: produces exactly one segment. */
function speak(): void {
  firePcm(tone(400, QUIET));
  firePcm(tone(600, LOUD));
  firePcm(tone(600, QUIET));
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// --- Controllable transcriber ---------------------------------------------

let nextText = '';
let gate: Promise<void> | null = null;
let openGate: (() => void) | null = null;

function makeTranscriber() {
  return {
    warmup: vi.fn(async (): Promise<void> => {}),
    transcribe: vi.fn(async (_pcm: Int16Array, _sampleRate: number): Promise<string> => {
      if (gate) await gate;
      return nextText;
    }),
  };
}

let transcriber: ReturnType<typeof makeTranscriber>;

function blockTranscription(): void {
  gate = new Promise<void>((resolve) => { openGate = resolve; });
}

beforeEach(() => {
  for (const k of Object.keys(ipcHandlers)) delete ipcHandlers[k];
  nextText = '';
  gate = null;
  openGate = null;
  transcriber = makeTranscriber();
});

afterEach(() => vi.restoreAllMocks());

function startMonitor(): { monitor: WakeWordMonitor; wake: ReturnType<typeof vi.fn> } {
  const monitor = new WakeWordMonitor({ transcriber });
  const wake = vi.fn();
  monitor.on('wake', wake);
  expect(monitor.start()).toBe(true);
  return { monitor, wake };
}

describe('WakeWordMonitor — phrase engine', () => {
  it('starts, registers the PCM listener, and warms the transcriber up', () => {
    startMonitor();
    expect(ipcHandlers[IPC.WAKE_PCM_CHUNK]).toBeTypeOf('function');
    expect(transcriber.warmup).toHaveBeenCalledTimes(1);
  });

  it('emits wake when a segment transcribes to the wake phrase', async () => {
    const { wake } = startMonitor();
    nextText = 'Huncho, open YouTube.';
    speak();
    await flush();
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    expect(transcriber.transcribe.mock.calls[0][1]).toBe(SR);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('accepts a known mishear of the wake phrase', async () => {
    const { wake } = startMonitor();
    nextText = 'hey honcho';
    speak();
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit for a non-matching transcript', async () => {
    const { wake } = startMonitor();
    nextText = 'what is the weather today';
    speak();
    await flush();
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    expect(wake).not.toHaveBeenCalled();
  });

  it('does NOT emit when the wake word appears late in a sentence', async () => {
    const { wake } = startMonitor();
    nextText = 'and then I was wearing a poncho';
    speak();
    await flush();
    expect(wake).not.toHaveBeenCalled();
  });

  it('does not transcribe pure silence (no segment)', async () => {
    startMonitor();
    firePcm(tone(3000, QUIET));
    await flush();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('debounces repeated matches into a single wake', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10_000);
    const { wake } = startMonitor();
    nextText = 'huncho';

    speak();
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);

    // 500ms later — inside the 2000ms debounce window.
    now.mockReturnValue(10_500);
    speak();
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);

    // Past the window — fires again.
    now.mockReturnValue(13_000);
    speak();
    await flush();
    expect(wake).toHaveBeenCalledTimes(2);
  });

  it('ignores PCM entirely while paused, and resumes after', async () => {
    const { monitor, wake } = startMonitor();
    nextText = 'huncho';

    monitor.setPaused(true);
    speak();
    await flush();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();

    monitor.setPaused(false);
    speak();
    await flush();
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('does not wake from audio that was mid-utterance when it was paused', async () => {
    const { monitor, wake } = startMonitor();
    nextText = 'huncho';

    firePcm(tone(400, QUIET));
    firePcm(tone(600, LOUD)); // utterance in progress
    monitor.setPaused(true);  // e.g. Huncho started speaking
    firePcm(tone(600, QUIET));
    await flush();
    expect(wake).not.toHaveBeenCalled();

    // Resuming must not flush the discarded half-segment either.
    monitor.setPaused(false);
    firePcm(tone(600, QUIET));
    await flush();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('drops overlapping segments instead of queueing them up', async () => {
    const { wake } = startMonitor();
    nextText = 'huncho';
    blockTranscription();

    speak();          // segment 1 → transcription starts, blocked on the gate
    await flush();
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);

    speak();          // segment 2 while 1 is in flight → dropped
    speak();          // segment 3 → dropped
    await flush();
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);

    openGate!();
    gate = null;
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);

    // Once the in-flight one settles, new segments are accepted again.
    speak();
    await flush();
    expect(transcriber.transcribe).toHaveBeenCalledTimes(2);
  });

  it('survives a transcription error and keeps accepting segments', async () => {
    const { wake } = startMonitor();
    transcriber.transcribe.mockRejectedValueOnce(new Error('model exploded'));
    speak();
    await flush();
    expect(wake).not.toHaveBeenCalled();

    nextText = 'huncho';
    speak();
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('ignores chunks after destroy()', async () => {
    const { monitor, wake } = startMonitor();
    nextText = 'huncho';
    monitor.destroy();
    speak();
    await flush();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });
});
