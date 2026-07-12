import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActionCache,
  CacheIO,
  CachedStep,
  MAX_ENTRIES,
  normalizeIntent,
  originOf,
  resolveFingerprint,
  shouldCache,
} from '../tools/action-cache';
import type { ElementMapEntry } from '../tools/dom-agent';

// In-memory IO so tests never touch disk.
function memIO(): CacheIO & { data: string | null } {
  return {
    data: null as string | null,
    read() {
      return this.data;
    },
    write(d: string) {
      this.data = d;
    },
  };
}

function el(n: number, text: string, type = 'link'): ElementMapEntry {
  return { n, type, text, bbox: { x: 0, y: 0, w: 10, h: 10 } };
}

function step(tool: CachedStep['tool'], args: Record<string, unknown> = {}, fp?: string): CachedStep {
  return fp ? { tool, args, targetFingerprint: fp } : { tool, args };
}

describe('normalizeIntent', () => {
  it('lowercases, trims, strips punctuation, collapses whitespace', () => {
    expect(normalizeIntent('  Open   YouTube!! ')).toBe('open youtube');
    expect(normalizeIntent('Search, for cats.')).toBe('search for cats');
  });

  it('strips leading fillers (single and stacked)', () => {
    expect(normalizeIntent('Hey Huncho, open YouTube')).toBe('open youtube');
    expect(normalizeIntent('please open gmail')).toBe('open gmail');
    expect(normalizeIntent('Jarvis can you open amazon')).toBe('open amazon');
    expect(normalizeIntent('ok huncho please scroll down')).toBe('scroll down');
  });

  it('is deterministic and stable across equivalent phrasings', () => {
    expect(normalizeIntent('Open YouTube')).toBe(normalizeIntent('open  youtube!'));
  });

  it('handles a transcript that is only fillers', () => {
    expect(normalizeIntent('hey huncho')).toBe('');
  });
});

describe('shouldCache', () => {
  const base = {
    steps: [step('navigate', { url: 'https://youtube.com' })],
    completedCleanly: true,
    hadConfirmationGated: false,
    transcript: 'open youtube',
  };

  it('caches a clean navigate run', () => {
    expect(shouldCache(base)).toBe(true);
  });

  it('rejects runs that did not complete cleanly', () => {
    expect(shouldCache({ ...base, completedCleanly: false })).toBe(false);
  });

  it('rejects runs with a confirmation-gated step', () => {
    expect(shouldCache({ ...base, hadConfirmationGated: true })).toBe(false);
  });

  it('rejects runs with no tool steps', () => {
    expect(shouldCache({ ...base, steps: [] })).toBe(false);
  });

  it('rejects read_page-only runs', () => {
    expect(shouldCache({ ...base, steps: [step('read_page')], transcript: 'open the page' })).toBe(false);
  });

  it('allows a run that includes read_page alongside an action step', () => {
    expect(
      shouldCache({
        ...base,
        steps: [step('navigate', { url: 'https://x.com' }), step('read_page')],
        transcript: 'open x',
      }),
    ).toBe(true);
  });

  it('rejects transcripts with question/read words', () => {
    for (const t of ['what is on the page', 'how much is this', 'read this article', 'summarize the news', 'who wrote this']) {
      expect(shouldCache({ ...base, transcript: t })).toBe(false);
    }
  });
});

describe('resolveFingerprint', () => {
  const map = [el(3, 'Sign in'), el(7, 'Subscribe now'), el(12, 'Search results for cats')];

  it('exact match wins', () => {
    expect(resolveFingerprint('Sign in', map)?.n).toBe(3);
  });

  it('normalizes case / whitespace / quotes for exact match', () => {
    expect(resolveFingerprint('  SIGN   IN ', map)?.n).toBe(3);
  });

  it('substring match (stored fp is a substring of map text)', () => {
    expect(resolveFingerprint('Search results', map)?.n).toBe(12);
  });

  it('substring match (map text is a substring of stored fp)', () => {
    expect(resolveFingerprint('Subscribe now to the channel', map)?.n).toBe(7);
  });

  it('returns null when nothing matches', () => {
    expect(resolveFingerprint('Checkout', map)).toBeNull();
  });

  it('returns null for empty fingerprint or empty map', () => {
    expect(resolveFingerprint('', map)).toBeNull();
    expect(resolveFingerprint('Sign in', [])).toBeNull();
    expect(resolveFingerprint(undefined, map)).toBeNull();
  });
});

describe('originOf', () => {
  it('extracts protocol + host', () => {
    expect(originOf('https://www.youtube.com/watch?v=1')).toBe('https://www.youtube.com');
  });
  it('returns empty for unparseable urls', () => {
    expect(originOf('')).toBe('');
    expect(originOf('not a url')).toBe('');
  });
});

describe('ActionCache record → lookup roundtrip + persistence', () => {
  let io: CacheIO & { data: string | null };
  let cache: ActionCache;

  beforeEach(() => {
    io = memIO();
    cache = new ActionCache({ io });
  });

  it('records and looks up an entry', () => {
    const steps = [step('navigate', { url: 'https://youtube.com' })];
    cache.recordRun('open youtube', steps, 'https://google.com');
    const entry = cache.lookup('open youtube');
    expect(entry).not.toBeNull();
    expect(entry!.steps).toEqual(steps);
    expect(entry!.startUrlPattern).toBe('https://google.com');
    expect(entry!.hits).toBe(0);
  });

  it('persists via injected IO and reloads', () => {
    cache.recordRun('open youtube', [step('navigate', { url: 'https://youtube.com' })], 'https://google.com');
    expect(io.data).toBeTruthy();

    const cache2 = new ActionCache({ io });
    cache2.load();
    expect(cache2.lookup('open youtube')?.steps.length).toBe(1);
  });

  it('markHit increments hits + persists', () => {
    cache.recordRun('open youtube', [step('navigate', { url: 'https://youtube.com' })], 'https://google.com');
    cache.markHit('open youtube');
    cache.markHit('open youtube');
    expect(cache.lookup('open youtube')!.hits).toBe(2);
  });

  it('invalidate removes an entry', () => {
    cache.recordRun('open youtube', [step('navigate', { url: 'https://youtube.com' })], 'https://google.com');
    cache.invalidate('open youtube');
    expect(cache.lookup('open youtube')).toBeNull();
  });

  it('re-recording overwrites steps but preserves createdAt + hits', () => {
    cache.recordRun('open youtube', [step('navigate', { url: 'https://a.com' })], 'https://google.com');
    cache.markHit('open youtube');
    const created = cache.lookup('open youtube')!.createdAt;
    cache.recordRun('open youtube', [step('navigate', { url: 'https://b.com' })], 'https://google.com');
    const entry = cache.lookup('open youtube')!;
    expect(entry.steps[0].args.url).toBe('https://b.com');
    expect(entry.hits).toBe(1);
    expect(entry.createdAt).toBe(created);
  });

  it('ignores corrupt persisted data on load', () => {
    io.data = '{ not valid json';
    const c = new ActionCache({ io });
    expect(() => c.load()).not.toThrow();
    expect(c.size()).toBe(0);
  });
});

describe('ActionCache LRU cap', () => {
  it('caps at MAX_ENTRIES, evicting the least-recently-used', () => {
    const io = memIO();
    const cache = new ActionCache({ io });

    for (let i = 0; i < MAX_ENTRIES; i++) {
      cache.recordRun(`intent ${i}`, [step('navigate', { url: `https://s${i}.com` })], 'https://google.com');
    }
    expect(cache.size()).toBe(MAX_ENTRIES);

    // Touch intent 0 so it's the most-recently-used, then overflow by one.
    cache.markHit('intent 0');
    cache.recordRun('intent overflow', [step('navigate', { url: 'https://o.com' })], 'https://google.com');

    expect(cache.size()).toBe(MAX_ENTRIES);
    // intent 1 was the oldest untouched → evicted; intent 0 survived.
    expect(cache.lookup('intent 1')).toBeNull();
    expect(cache.lookup('intent 0')).not.toBeNull();
    expect(cache.lookup('intent overflow')).not.toBeNull();
  });
});

describe('fingerprint-based re-resolution scenario (record → replay match)', () => {
  it('a recorded click fingerprint re-resolves to a different number after renumbering', () => {
    // Record: element 5 was "Watch later"
    const recorded = step('click', { reason: 'open watch later' }, 'Watch later');

    // Replay: page reloaded, same element is now number 42
    const liveMap = [el(10, 'Home'), el(42, 'Watch later'), el(99, 'History')];
    const match = resolveFingerprint(recorded.targetFingerprint, liveMap);
    expect(match?.n).toBe(42);

    // If the target vanished, replay must get null (→ abort + invalidate).
    const goneMap = [el(10, 'Home'), el(99, 'History')];
    expect(resolveFingerprint(recorded.targetFingerprint, goneMap)).toBeNull();
  });
});
