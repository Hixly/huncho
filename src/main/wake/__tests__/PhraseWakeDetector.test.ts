import { describe, it, expect } from 'vitest';
import { PhraseWakeDetector } from '../PhraseWakeDetector';

const SR = 16000;
const FRAME_MS = 80;
const FRAME = (SR * FRAME_MS) / 1000; // 1280

/** N ms of PCM at a fixed amplitude (constant sign → RMS == amplitude). */
function tone(ms: number, amplitude: number): Int16Array {
  const n = Math.round((SR * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = i % 2 === 0 ? amplitude : -amplitude;
  return out;
}

const LOUD = 8000;
const QUIET = 20;

/** Feed a chunk and collect the segment, if any. */
function feedAll(d: PhraseWakeDetector, chunks: Int16Array[]): Int16Array[] {
  const segs: Int16Array[] = [];
  for (const c of chunks) {
    const s = d.feed(c);
    if (s) segs.push(s);
  }
  return segs;
}

describe('PhraseWakeDetector', () => {
  it('returns null during pure silence', () => {
    const d = new PhraseWakeDetector();
    const segs = feedAll(d, [tone(2000, QUIET)]);
    expect(segs).toHaveLength(0);
  });

  it('emits a segment on speech followed by trailing silence', () => {
    const d = new PhraseWakeDetector();
    const segs = feedAll(d, [
      tone(400, QUIET),  // ambient
      tone(600, LOUD),   // "huncho"
      tone(600, QUIET),  // trailing silence > 400ms
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].length).toBeGreaterThan(0);
  });

  it('rejects a blip shorter than minSpeechMs', () => {
    const d = new PhraseWakeDetector();
    // 80ms of speech (one frame) is well under the 250ms minimum.
    const segs = feedAll(d, [tone(400, QUIET), tone(80, LOUD), tone(800, QUIET)]);
    expect(segs).toHaveLength(0);
  });

  it('still segments after a rejected blip (state is reset)', () => {
    const d = new PhraseWakeDetector();
    feedAll(d, [tone(400, QUIET), tone(80, LOUD), tone(800, QUIET)]);
    const segs = feedAll(d, [tone(600, LOUD), tone(600, QUIET)]);
    expect(segs).toHaveLength(1);
  });

  it('cuts at maxSegmentMs while speech continues', () => {
    const d = new PhraseWakeDetector({ maxSegmentMs: 800 });
    // 5s of unbroken speech — must not buffer forever.
    const segs = feedAll(d, [tone(400, QUIET), tone(5000, LOUD)]);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    // The first cut is the cap (800ms) plus at most the pre-roll (300ms → 4 frames).
    const capSamples = (SR * 800) / 1000;
    const preRollSamples = 4 * FRAME;
    expect(segs[0].length).toBeLessThanOrEqual(capSamples + preRollSamples);
    expect(segs[0].length).toBeGreaterThanOrEqual(capSamples);
  });

  it('includes pre-roll audio captured before speech was detected', () => {
    const withPreRoll = new PhraseWakeDetector();
    const noPreRoll = new PhraseWakeDetector({ preRollMs: 0 });
    const chunks = () => [tone(1000, QUIET), tone(600, LOUD), tone(600, QUIET)];

    const a = feedAll(withPreRoll, chunks())[0];
    const b = feedAll(noPreRoll, chunks())[0];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // 300ms pre-roll rounds up to 4 x 80ms frames.
    expect(a.length - b.length).toBe(4 * FRAME);
    // ...and the extra leading audio is the quiet ambient, not speech.
    expect(Math.abs(a[0])).toBe(QUIET);
  });

  it('handles chunk sizes that do not align to frame boundaries', () => {
    const aligned = new PhraseWakeDetector();
    const ragged = new PhraseWakeDetector();

    const full = new Int16Array([...tone(400, QUIET), ...tone(600, LOUD), ...tone(600, QUIET)]);
    const alignedSeg = aligned.feed(full);

    // Same audio, sliced at deliberately awkward sizes (prime-ish, < and > a frame).
    let raggedSeg: Int16Array | null = null;
    const sizes = [7, 331, 1279, 1281, 2000, 53];
    let i = 0;
    let k = 0;
    while (i < full.length) {
      const size = sizes[k++ % sizes.length];
      const s = ragged.feed(full.subarray(i, Math.min(i + size, full.length)));
      if (s && !raggedSeg) raggedSeg = s;
      i += size;
    }

    expect(alignedSeg).not.toBeNull();
    expect(raggedSeg).not.toBeNull();
    expect(raggedSeg!.length).toBe(alignedSeg!.length);
  });

  it('reset() discards an in-progress segment', () => {
    const d = new PhraseWakeDetector();
    d.feed(tone(400, QUIET));
    d.feed(tone(600, LOUD)); // mid-utterance
    d.reset();
    // Only trailing silence remains — nothing should close.
    expect(d.feed(tone(800, QUIET))).toBeNull();
    // And it segments cleanly afterwards.
    d.feed(tone(600, LOUD));
    expect(d.feed(tone(600, QUIET))).not.toBeNull();
  });

  it('ignores an empty chunk', () => {
    const d = new PhraseWakeDetector();
    expect(d.feed(new Int16Array(0))).toBeNull();
  });

  it('does not treat a loud steady hum as speech (adaptive noise floor)', () => {
    const d = new PhraseWakeDetector();
    // A constant 1200-RMS hum: above absoluteFloor, but the floor adapts up to
    // it so it never crosses noiseFloor * 3.
    const segs = feedAll(d, [tone(6000, 1200)]);
    expect(segs).toHaveLength(0);
  });
});
