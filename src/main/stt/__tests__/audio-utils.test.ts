import { describe, it, expect } from 'vitest';
import { int16ToFloat32, resampleLinear } from '../audio-utils';

describe('int16ToFloat32', () => {
  it('maps full-scale and zero correctly into [-1, 1]', () => {
    const out = int16ToFloat32(new Int16Array([0, 32767, -32768, 16384]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(1, 5);
    expect(out[2]).toBeCloseTo(-1, 5);
    expect(out[3]).toBeCloseTo(0.5, 4);
  });

  it('returns an empty array for empty input', () => {
    expect(int16ToFloat32(new Int16Array([])).length).toBe(0);
  });

  it('keeps every sample within [-1, 1]', () => {
    const out = int16ToFloat32(new Int16Array([-32768, -1, 1, 32767]));
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('resampleLinear', () => {
  it('returns the input untouched when rates match', () => {
    const input = new Float32Array([0, 0.5, 1]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });

  it('downsamples 48k -> 16k to one third of the length', () => {
    // 6 samples @48k -> 2 samples @16k
    const input = new Float32Array([0, 1, 2, 3, 4, 5]);
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe(2);
    // ratio = 3; positions 0 and 3 -> exact samples 0 and 3
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(3, 5);
  });

  it('linearly interpolates a known ramp when the position is fractional', () => {
    // 44.1k -> 16k, ratio ~2.75625. Verify interpolation between neighbors.
    const input = new Float32Array(Array.from({ length: 100 }, (_, i) => i));
    const out = resampleLinear(input, 44100, 16000);
    // Each output sample must equal its fractional source position (ramp = index).
    const ratio = 44100 / 16000;
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(i * ratio, 3);
    }
  });

  it('upsamples 8k -> 16k to double the length', () => {
    const input = new Float32Array([0, 2, 4]);
    const out = resampleLinear(input, 8000, 16000);
    expect(out.length).toBe(6);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(1, 5); // midpoint between 0 and 2
    expect(out[2]).toBeCloseTo(2, 5);
  });

  it('returns empty for empty input', () => {
    expect(resampleLinear(new Float32Array([]), 48000, 16000).length).toBe(0);
  });
});
