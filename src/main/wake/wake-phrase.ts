/**
 * Wake-phrase matching for the phrase-based wake engine.
 *
 * The segmenter hands us a short transcript from a local ASR pass; this module
 * decides whether the user actually said the wake word. Pure string work — no
 * Electron, no models — so it is fully unit-testable and cheap.
 *
 * Two rules keep false wakes down:
 *   1. Only a set of known variants counts (exact word-boundary matches, never
 *      substrings — "poncho" must not be found inside "ponchos" by accident).
 *   2. The match must START within the first few words. "Huncho, open YouTube"
 *      wakes; "...and then I was wearing a poncho" does not.
 */

/**
 * Accepted spellings for the wake word, tuned for what a small local ASR model
 * (Moonshine tiny) actually produces when someone says "Huncho" — it is not a
 * dictionary word, so it gets rendered as the nearest real ones. These are
 * deliberately generous **mishears**, not aliases: recognizing them is what
 * makes the wake word usable without training a model.
 *
 * Tunable by the user in `DUXY_CONFIG.wakeVariants` — trim entries that cause
 * false wakes in your environment (e.g. drop 'poncho' if you talk about
 * ponchos), or add whatever your own voice consistently transcribes as.
 */
export const DEFAULT_WAKE_VARIANTS: string[] = [
  'huncho',
  'hey huncho',
  'honcho',
  'hey honcho',
  'head honcho',
  'hun cho',
  'hunch oh',
  'huncha',
  'hunchoe',
  'uncho',
  'poncho',
  'hey poncho',
  'hunter cho',
  // Observed mishears from live testing (Moonshine tiny). Kept only the ones that
  // are NOT common standalone words — 'hunter'/'hunch' alone would false-wake in
  // normal conversation, so they are intentionally excluded.
  'huncher',
  'hey huncher',
  'hunt show',
  'hunch of',
];

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Lowercase, strip diacritics and punctuation, collapse whitespace, trim.
 * Punctuation becomes a space (not nothing) so "hun-cho" normalizes to the
 * two-word variant "hun cho" instead of the unmatched "huncho"… which would
 * also be fine, but the space keeps word boundaries honest.
 */
export function normalizePhrase(s: string): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(COMBINING_MARKS, '') // strip diacritics (café → cafe)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')     // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when any variant appears in `transcript` as a whole-word match that
 * STARTS within the first `maxWordsFromStart` words.
 *
 * Multi-word variants ("hey huncho", "hun cho") are matched as consecutive
 * word sequences.
 */
export function matchesWake(
  transcript: string,
  variants: string[],
  maxWordsFromStart = 3
): boolean {
  const norm = normalizePhrase(transcript);
  if (!norm) return false;
  const words = norm.split(' ');
  const limit = Math.min(maxWordsFromStart, words.length);

  for (const variant of variants ?? []) {
    const nv = normalizePhrase(variant);
    if (!nv) continue;
    const vWords = nv.split(' ');
    for (let i = 0; i < limit; i++) {
      if (i + vWords.length > words.length) break;
      let ok = true;
      for (let j = 0; j < vWords.length; j++) {
        if (words[i + j] !== vWords[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}
