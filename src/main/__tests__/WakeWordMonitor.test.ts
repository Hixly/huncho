import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (declared before importing the module under test) ---------------

const ipcHandlers: Record<string, (event: unknown, payload: unknown) => void> = {};
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app' },
  ipcMain: {
    on: (ch: string, cb: (event: unknown, payload: unknown) => void) => { ipcHandlers[ch] = cb; },
    removeAllListeners: (ch?: string) => { if (ch) delete ipcHandlers[ch]; },
  },
}));

let existing = new Set<string>();
vi.mock('fs', () => ({
  existsSync: (p: string) => existing.has(p.replace(/\\/g, '/')),
}));

// Controllable OpenWakeWord fake.
const createCalls: any[] = [];
let nextScores: number[] = [];
vi.mock('../wake/OpenWakeWord', () => ({
  OpenWakeWord: {
    async create(opts: any) {
      createCalls.push(opts);
      return {
        threshold: opts.threshold ?? 0.5,
        async ingest() { return nextScores; },
      };
    },
  },
}));

import { WakeWordMonitor } from '../WakeWordMonitor';
import { IPC } from '../../shared/ipc-types';

const MEL = '/app/assets/wake/melspectrogram.onnx';
const EMB = '/app/assets/wake/embedding_model.onnx';
const JARVIS = '/app/assets/wake/hey_jarvis_v0.1.onnx';
const HUNCHO = '/app/assets/wake/huncho.onnx';

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function fireChunk(): void {
  ipcHandlers[IPC.WAKE_PCM_CHUNK]?.(null, { pcmBase64: Buffer.from(new Int16Array(1280).buffer).toString('base64') });
}

beforeEach(() => {
  for (const k of Object.keys(ipcHandlers)) delete ipcHandlers[k];
  createCalls.length = 0;
  nextScores = [];
  existing = new Set([MEL, EMB, JARVIS]);
});

afterEach(() => vi.restoreAllMocks());

describe('WakeWordMonitor model path selection', () => {
  it('prefers a custom huncho.onnx when present', async () => {
    existing.add(HUNCHO);
    const m = new WakeWordMonitor();
    expect(m.start()).toBe(true);
    await flush();
    expect(createCalls[0].wakeModelPath.replace(/\\/g, '/')).toBe(HUNCHO);
  });

  it('falls back to hey_jarvis when no custom model exists', async () => {
    const m = new WakeWordMonitor();
    expect(m.start()).toBe(true);
    await flush();
    expect(createCalls[0].wakeModelPath.replace(/\\/g, '/')).toBe(JARVIS);
  });

  it('returns false and stays dormant when feature models are missing', () => {
    existing = new Set([JARVIS]); // mel + embedding absent
    const m = new WakeWordMonitor();
    expect(m.start()).toBe(false);
    expect(ipcHandlers[IPC.WAKE_PCM_CHUNK]).toBeUndefined();
  });

  it('always returns true (keyless) when models are present', () => {
    expect(new WakeWordMonitor().start()).toBe(true);
  });
});

describe('WakeWordMonitor wake emission', () => {
  it('emits wake when a score crosses the threshold', async () => {
    const m = new WakeWordMonitor();
    const spy = vi.fn();
    m.on('wake', spy);
    m.start();
    await flush();
    nextScores = [0.9];
    fireChunk();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not emit when scores stay below threshold', async () => {
    const m = new WakeWordMonitor();
    const spy = vi.fn();
    m.on('wake', spy);
    m.start();
    await flush();
    nextScores = [0.2, 0.3];
    fireChunk();
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('debounces multiple above-threshold frames into one wake', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10_000);
    const m = new WakeWordMonitor();
    const spy = vi.fn();
    m.on('wake', spy);
    m.start();
    await flush();

    nextScores = [0.9, 0.95];
    fireChunk();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);

    // Second chunk 500ms later — still within the 2000ms debounce window.
    now.mockReturnValue(10_500);
    fireChunk();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);

    // After the debounce window, a new detection fires again.
    now.mockReturnValue(13_000);
    fireChunk();
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('ignores chunks after destroy()', async () => {
    const m = new WakeWordMonitor();
    const spy = vi.fn();
    m.on('wake', spy);
    m.start();
    await flush();
    m.destroy();
    nextScores = [0.9];
    // handler was removed on destroy, so nothing should reach ingest
    fireChunk();
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });
});
