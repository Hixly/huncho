import { describe, it, expect } from 'vitest';
import { normalizePhrase, matchesWake, DEFAULT_WAKE_VARIANTS } from '../wake-phrase';

const V = DEFAULT_WAKE_VARIANTS;

describe('normalizePhrase', () => {
  it('lowercases and trims', () => {
    expect(normalizePhrase('  HUNCHO  ')).toBe('huncho');
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(normalizePhrase('Huncho,   open   YouTube!')).toBe('huncho open youtube');
  });

  it('strips diacritics', () => {
    expect(normalizePhrase('Hüncho')).toBe('huncho');
  });

  it('turns hyphens into word boundaries', () => {
    expect(normalizePhrase('hun-cho')).toBe('hun cho');
  });

  it('returns empty for empty/punctuation-only input', () => {
    expect(normalizePhrase('')).toBe('');
    expect(normalizePhrase('...!?')).toBe('');
  });
});

describe('matchesWake', () => {
  it('matches the exact wake word', () => {
    expect(matchesWake('huncho', V)).toBe(true);
  });

  it('matches "hey huncho"', () => {
    expect(matchesWake('Hey Huncho', V)).toBe(true);
  });

  it('matches every default mishear variant', () => {
    for (const variant of V) {
      expect(matchesWake(variant, V), `variant "${variant}"`).toBe(true);
    }
  });

  it('is case and punctuation insensitive', () => {
    expect(matchesWake('HUNCHO!', V)).toBe(true);
    expect(matchesWake('Huncho, open YouTube.', V)).toBe(true);
    expect(matchesWake('  hey, honcho?  ', V)).toBe(true);
  });

  it('matches when the wake word starts within the first 3 words', () => {
    expect(matchesWake('uh ok huncho open youtube', V)).toBe(true);
  });

  it('rejects a variant appearing later in a sentence', () => {
    expect(matchesWake('and then I was wearing a poncho', V)).toBe(false);
    expect(matchesWake('he is basically the head honcho around here', V)).toBe(false);
  });

  it('rejects unrelated text', () => {
    expect(matchesWake('what is the weather today', V)).toBe(false);
    expect(matchesWake('scroll down please', V)).toBe(false);
  });

  it('rejects substring-only hits (word boundaries are enforced)', () => {
    expect(matchesWake('hunchback of notre dame', V)).toBe(false);
    expect(matchesWake('ponchos are cheap', V)).toBe(false);
  });

  it('handles empty input and empty variant lists', () => {
    expect(matchesWake('', V)).toBe(false);
    expect(matchesWake('huncho', [])).toBe(false);
    expect(matchesWake('huncho', ['', '   '])).toBe(false);
  });

  it('honours a custom maxWordsFromStart', () => {
    expect(matchesWake('one two three four huncho', V, 3)).toBe(false);
    expect(matchesWake('one two three four huncho', V, 5)).toBe(true);
  });

  it('matches multi-word variants as consecutive words only', () => {
    expect(matchesWake('hun cho open youtube', V)).toBe(true);
    expect(matchesWake('hun the cho', V)).toBe(false);
  });
});
