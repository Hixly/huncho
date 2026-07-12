/**
 * Pure, dependency-free audio helpers for local STT. Kept separate from
 * MoonshineTranscriber so they can be unit-tested without loading transformers.js.
 */

/** Convert signed 16-bit PCM samples to normalized Float32 in the range [-1, 1]. */
export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i];
    // Negative full-scale is -32768, positive is +32767 — divide by the
    // matching magnitude so the result stays within [-1, 1].
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

/**
 * Resample a mono Float32 signal from `inRate` to `outRate` using linear
 * interpolation. Cheap and good enough for speech STT (Moonshine wants 16kHz).
 * Returns the input untouched when the rates already match.
 */
export function resampleLinear(
  input: Float32Array,
  inRate: number,
  outRate: number
): Float32Array {
  if (inRate === outRate || input.length === 0) return input;
  const ratio = inRate / outRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx];
    const b = idx + 1 < input.length ? input[idx + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
