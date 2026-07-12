import { describe, it, expect } from 'vitest';
import { OpenWakeWord, OrtSessionLike, OrtTensorLike, TensorFactory } from '../OpenWakeWord';

// Fake ORT sessions that mimic the real model shapes closely enough to exercise
// the streaming buffer/window logic without loading any ONNX runtime.
const tensorFactory: TensorFactory = (data, dims) => ({ data, dims });

function makeMelSession(): OrtSessionLike {
  return {
    inputNames: ['input'],
    outputNames: ['output'],
    async run(feeds): Promise<Record<string, OrtTensorLike>> {
      const t = feeds['input'];
      const samples = t.dims[t.dims.length - 1] as number;
      // Real melspectrogram model: ~ceil(samples/160 - 3) frames of 32 bins.
      const frames = Math.max(0, Math.floor(samples / 160 - 3));
      return { output: { data: new Float32Array(frames * 32), dims: [1, 1, frames, 32] } };
    },
  };
}

function makeEmbeddingSession(): OrtSessionLike {
  return {
    inputNames: ['input_1'],
    outputNames: ['conv2d_19'],
    async run(): Promise<Record<string, OrtTensorLike>> {
      return { conv2d_19: { data: new Float32Array(96), dims: [1, 1, 1, 96] } };
    },
  };
}

// Wake session whose score is controlled by an external ref.
function makeWakeSession(scoreRef: { value: number }): OrtSessionLike {
  return {
    inputNames: ['x.1'],
    outputNames: ['53'],
    async run(): Promise<Record<string, OrtTensorLike>> {
      return { '53': { data: new Float32Array([scoreRef.value]), dims: [1, 1] } };
    },
  };
}

function makeDetector(scoreRef = { value: 0 }, threshold = 0.5): OpenWakeWord {
  return new OpenWakeWord({
    melSession: makeMelSession(),
    embeddingSession: makeEmbeddingSession(),
    wakeSession: makeWakeSession(scoreRef),
    tensorFactory,
    threshold,
  });
}

const silence = (n: number): Int16Array => new Int16Array(n);

describe('OpenWakeWord frame buffering', () => {
  it('emits exactly one score per full 1280-sample frame', async () => {
    const oww = makeDetector();
    const scores = await oww.ingest(silence(1280));
    expect(scores).toHaveLength(1);
  });

  it('emits nothing until a full frame accumulates', async () => {
    const oww = makeDetector();
    expect(await oww.ingest(silence(500))).toHaveLength(0);
    expect(await oww.ingest(silence(500))).toHaveLength(0);
    // 1000 + 500 = 1500 >= 1280 -> one frame processed, 220 held over
    expect(await oww.ingest(silence(500))).toHaveLength(1);
  });

  it('produces floor(total/1280) scores across arbitrary odd chunk sizes', async () => {
    const oww = makeDetector();
    const chunkSizes = [333, 1000, 777, 1280, 91, 2049, 512, 5000, 17];
    let total = 0;
    let produced = 0;
    for (const size of chunkSizes) {
      total += size;
      produced += (await oww.ingest(silence(size))).length;
    }
    expect(produced).toBe(Math.floor(total / 1280));
  });

  it('handles several frames delivered in a single chunk', async () => {
    const oww = makeDetector();
    const scores = await oww.ingest(silence(1280 * 3));
    expect(scores).toHaveLength(3);
  });
});

describe('OpenWakeWord threshold', () => {
  it('reports scores at or above threshold', async () => {
    const scoreRef = { value: 0.92 };
    const oww = makeDetector(scoreRef, 0.5);
    const scores = await oww.ingest(silence(1280));
    expect(scores[0]).toBeGreaterThanOrEqual(0.5);
  });

  it('reports scores below threshold as low', async () => {
    const scoreRef = { value: 0.01 };
    const oww = makeDetector(scoreRef, 0.5);
    const scores = await oww.ingest(silence(1280));
    expect(scores[0]).toBeLessThan(0.5);
  });

  it('defaults threshold to 0.5', () => {
    expect(makeDetector().threshold).toBe(0.5);
  });
});
