import { describe, it, expect } from 'vitest';
import { Endpointer, frameRms } from '../Endpointer';

// 80ms @ 16kHz = 1280 samples per frame. Amplitude conventions:
//   silence — zeros (RMS 0)
//   speech  — high-amplitude square-ish signal (RMS ~8000)
//   hum     — constant moderate amplitude (RMS ~1200), below the speech line
const FRAME_LEN = 1280;
const FRAME_MS = 80;

function makeFrame(amplitude: number): Int16Array {
  const f = new Int16Array(FRAME_LEN);
  // Alternating +/- so |sample| == amplitude and RMS == amplitude.
  for (let i = 0; i < FRAME_LEN; i++) f[i] = i % 2 === 0 ? amplitude : -amplitude;
  return f;
}

const SILENCE = makeFrame(0);
const SPEECH = makeFrame(8000);
const HUM = makeFrame(1200);

/** Feed `count` copies of `frame`, advancing the clock by FRAME_MS each time.
 *  Returns the first terminal decision seen (and the time it fired), or null. */
function feedFrames(
  ep: Endpointer,
  frame: Int16Array,
  count: number,
  startMs: number,
): { decision: 'stop' | 'cancel' | null; atMs: number; nextMs: number } {
  let now = startMs;
  for (let i = 0; i < count; i++) {
    const d = ep.feed(frame, now);
    if (d !== 'continue') return { decision: d, atMs: now, nextMs: now + FRAME_MS };
    now += FRAME_MS;
  }
  return { decision: null, atMs: now, nextMs: now };
}

describe('frameRms', () => {
  it('is 0 for silence and equals amplitude for an alternating signal', () => {
    expect(frameRms(SILENCE)).toBe(0);
    expect(Math.round(frameRms(SPEECH))).toBe(8000);
    expect(frameRms(new Int16Array(0))).toBe(0);
  });
});

describe('Endpointer', () => {
  it("returns 'stop' after silenceMs of silence following speech", () => {
    const ep = new Endpointer({ silenceMs: 1400 });
    let now = 0;
    // ~1s of speech.
    for (let i = 0; i < 13; i++) { expect(ep.feed(SPEECH, now)).toBe('continue'); now += FRAME_MS; }
    // Silence — should not stop before silenceMs, should stop after.
    const res = feedFrames(ep, SILENCE, 40, now);
    expect(res.decision).toBe('stop');
    // Fired only after ~1400ms of trailing silence (lastSpeech was at now-FRAME_MS).
    const silenceElapsed = res.atMs - (now - FRAME_MS);
    expect(silenceElapsed).toBeGreaterThan(1400);
    expect(silenceElapsed).toBeLessThan(1400 + 2 * FRAME_MS);
  });

  it("returns 'cancel' at noSpeechMs when speech is never heard", () => {
    const ep = new Endpointer({ noSpeechMs: 6000 });
    const res = feedFrames(ep, SILENCE, 200, 0);
    expect(res.decision).toBe('cancel');
    expect(res.atMs).toBeGreaterThan(6000);
    expect(res.atMs).toBeLessThan(6000 + 2 * FRAME_MS);
  });

  it("returns 'stop' at maxUtteranceMs for long continuous speech", () => {
    const ep = new Endpointer({ maxUtteranceMs: 15000, silenceMs: 99999 });
    const res = feedFrames(ep, SPEECH, 400, 0); // 400 * 80ms = 32s of speech
    expect(res.decision).toBe('stop');
    expect(res.atMs).toBeGreaterThan(15000);
    expect(res.atMs).toBeLessThan(15000 + 2 * FRAME_MS);
  });

  it('adapts its noise floor so a constant moderate hum is not speech', () => {
    const ep = new Endpointer({ noSpeechMs: 6000, silenceMs: 1400 });
    // A steady hum well below the 3x floor should be treated as silence and
    // eventually cancel (never counted as speech).
    const res = feedFrames(ep, HUM, 200, 0);
    expect(res.decision).toBe('cancel');
    expect(res.atMs).toBeGreaterThan(6000);
  });

  it('detects speech that rises above the adapted hum floor', () => {
    const ep = new Endpointer({ silenceMs: 1400 });
    let now = 0;
    // Establish a hum floor first.
    for (let i = 0; i < 10; i++) { expect(ep.feed(HUM, now)).toBe('continue'); now += FRAME_MS; }
    // Real speech (8000) is far above 3 * ~1200 → counts as speech.
    for (let i = 0; i < 13; i++) { expect(ep.feed(SPEECH, now)).toBe('continue'); now += FRAME_MS; }
    const res = feedFrames(ep, SILENCE, 40, now);
    expect(res.decision).toBe('stop'); // speech was seen, so trailing silence stops
  });

  it('latches after a terminal decision until reset()', () => {
    const ep = new Endpointer({ silenceMs: 200 });
    let now = 0;
    for (let i = 0; i < 5; i++) { ep.feed(SPEECH, now); now += FRAME_MS; }
    let stopped = false;
    for (let i = 0; i < 10; i++) { if (ep.feed(SILENCE, now) === 'stop') stopped = true; now += FRAME_MS; }
    expect(stopped).toBe(true);
    // Further feeds are inert until reset.
    expect(ep.feed(SILENCE, now)).toBe('continue');
    ep.reset();
    // After reset it behaves fresh: never-speech → cancel.
    const res = feedFrames(ep, SILENCE, 200, now);
    expect(res.decision).toBe('cancel');
  });
});
