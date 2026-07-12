import { describe, it, expect, vi } from 'vitest';
import { MoonshineTranscriber } from '../MoonshineTranscriber';

/** Build a transcriber wired to a fake pipeline factory so no real model loads. */
function makeTranscriber(
  pipe: (input: Float32Array) => Promise<{ text?: string } | Array<{ text?: string }>>,
  opts: { model?: 'base' | 'tiny' } = {}
) {
  const factory = vi.fn(async () => pipe);
  const t = new MoonshineTranscriber({ ...opts, pipelineFactory: factory as any });
  return { t, factory };
}

describe('MoonshineTranscriber', () => {
  it('runs the pipeline and returns trimmed text', async () => {
    const { t } = makeTranscriber(async () => ({ text: '  hello world  ' }));
    const pcm = new Int16Array([0, 16384, -16384, 32767]);
    const out = await t.transcribe(pcm, 16000);
    expect(out).toBe('hello world');
  });

  it('handles array-shaped pipeline output', async () => {
    const { t } = makeTranscriber(async () => [{ text: 'batched' }]);
    const out = await t.transcribe(new Int16Array([1, 2, 3]), 16000);
    expect(out).toBe('batched');
  });

  it('passes Float32 samples in [-1, 1] at 16kHz to the pipeline', async () => {
    let received: Float32Array | null = null;
    const { t } = makeTranscriber(async (input) => {
      received = input;
      return { text: 'ok' };
    });
    await t.transcribe(new Int16Array([32767, -32768, 0]), 16000);
    expect(received).not.toBeNull();
    expect(received!.length).toBe(3);
    expect(received![0]).toBeCloseTo(1, 4);
    expect(received![1]).toBeCloseTo(-1, 4);
    expect(received![2]).toBe(0);
  });

  it('resamples non-16kHz input before inference', async () => {
    let received: Float32Array | null = null;
    const { t } = makeTranscriber(async (input) => {
      received = input;
      return { text: 'ok' };
    });
    // 6 samples @48k -> 2 samples @16k
    await t.transcribe(new Int16Array([0, 100, 200, 300, 400, 500]), 48000);
    expect(received!.length).toBe(2);
  });

  it('returns empty string for empty PCM without loading the pipeline', async () => {
    const { t, factory } = makeTranscriber(async () => ({ text: 'never' }));
    const out = await t.transcribe(new Int16Array([]), 16000);
    expect(out).toBe('');
    expect(factory).not.toHaveBeenCalled();
  });

  it('loads the pipeline once and caches it across calls', async () => {
    const { t, factory } = makeTranscriber(async () => ({ text: 'x' }));
    await t.transcribe(new Int16Array([1]), 16000);
    await t.transcribe(new Int16Array([2]), 16000);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('selects the base model id by default and tiny when requested', async () => {
    const base = makeTranscriber(async () => ({ text: 'x' }));
    await base.t.transcribe(new Int16Array([1]), 16000);
    expect(base.factory).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/moonshine-base-ONNX',
      expect.anything()
    );

    const tiny = makeTranscriber(async () => ({ text: 'x' }), { model: 'tiny' });
    await tiny.t.transcribe(new Int16Array([1]), 16000);
    expect(tiny.factory).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/moonshine-tiny-ONNX',
      expect.anything()
    );
  });

  it('propagates pipeline errors so callers can fall back to cloud', async () => {
    const { t } = makeTranscriber(async () => {
      throw new Error('boom');
    });
    await expect(t.transcribe(new Int16Array([1, 2, 3]), 16000)).rejects.toThrow('boom');
  });

  it('warmup swallows errors and never throws', async () => {
    const factory = vi.fn(async () => {
      throw new Error('download failed');
    });
    const t = new MoonshineTranscriber({ pipelineFactory: factory as any });
    await expect(t.warmup()).resolves.toBeUndefined();
  });
});
