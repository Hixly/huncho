import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryStore,
  MemoryIO,
  EmbedFn,
  MAX_MEMORIES,
  parseExtraction,
  buildExtractionPrompt,
} from '../memory/MemoryStore';

/**
 * Deterministic mock embeddings. Each distinct text maps to a fixed unit
 * vector so cosine similarity is fully predictable in tests. Texts that share
 * an explicit "group" tag (via the map below) embed identically → similarity 1.
 */
function makeEmbed(vectors: Record<string, number[]>): EmbedFn {
  return async (text: string) => {
    const v = vectors[text];
    if (v) return v.slice();
    // Unknown text → an orthogonal-ish fallback derived from char codes so two
    // unrelated strings don't accidentally collide at 1.0.
    const seed = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return [Math.cos(seed), Math.sin(seed), 0];
  };
}

/** In-memory IO so persistence is testable without touching disk. */
function makeMemoryIO(): MemoryIO & { data: string | null } {
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

describe('MemoryStore.add — dedupe', () => {
  it('updates an existing entry (no insert) when similarity >= 0.9', async () => {
    const embed = makeEmbed({
      'likes dark mode': [1, 0, 0],
      'prefers dark mode': [1, 0, 0], // identical vector → cosine 1.0
    });
    const store = new MemoryStore({ io: makeMemoryIO(), embed });

    const first = await store.add('likes dark mode', 'preference');
    const second = await store.add('prefers dark mode', 'preference');

    expect(store.size()).toBe(1);
    expect(second?.id).toBe(first?.id);
    expect(store.all()[0].text).toBe('prefers dark mode'); // text refreshed
  });

  it('inserts a new entry when similarity is below 0.9', async () => {
    const embed = makeEmbed({
      'uses gmail': [1, 0, 0],
      'lives in chicago': [0, 1, 0], // orthogonal → cosine 0
    });
    const store = new MemoryStore({ io: makeMemoryIO(), embed });

    await store.add('uses gmail', 'fact');
    await store.add('lives in chicago', 'fact');

    expect(store.size()).toBe(2);
  });
});

describe('MemoryStore.recall — top-k + threshold', () => {
  it('returns top-k above the similarity threshold, best first', async () => {
    const embed = makeEmbed({
      q: [1, 0, 0],
      close: [0.95, 0.31, 0], // high sim
      mid: [0.7, 0.71, 0], // moderate sim (~0.7)
      far: [0, 1, 0], // sim 0 → filtered
    });
    const store = new MemoryStore({ io: makeMemoryIO(), embed });
    await store.add('close', 'fact');
    await store.add('mid', 'fact');
    await store.add('far', 'fact');

    const hits = await store.recall('q', 3, 0.35);
    const texts = hits.map((h) => h.text);
    expect(texts).toEqual(['close', 'mid']); // 'far' below threshold, order by sim
  });

  it('respects k and bumps uses/lastUsedAt on returned entries', async () => {
    // All three share positive x (similar to q) but are mutually < 0.9 apart so
    // none dedupes into another.
    const embed = makeEmbed({
      q: [1, 0, 0],
      a: [0.7, 0.7, 0], // sim to q ~0.71
      b: [0.7, 0, 0.7], // sim to q ~0.71
      c: [0.6, 0.5, 0.6], // sim to q ~0.61
    });
    const store = new MemoryStore({ io: makeMemoryIO(), embed });
    await store.add('a', 'fact');
    await store.add('b', 'fact');
    await store.add('c', 'fact');

    const hits = await store.recall('q', 2, 0.35);
    expect(hits).toHaveLength(2);
    expect(hits[0].uses).toBe(1);
  });

  it('returns [] on empty store or empty query', async () => {
    const store = new MemoryStore({ io: makeMemoryIO(), embed: makeEmbed({}) });
    expect(await store.recall('anything')).toEqual([]);
    await store.add('x', 'fact');
    expect(await store.recall('')).toEqual([]);
  });
});

describe('MemoryStore — LRU cap eviction', () => {
  it('caps at MAX_MEMORIES, evicting least-recently-used', async () => {
    // One-hot vectors → every entry is orthogonal to every other (sim 0), so
    // nothing dedupes and eviction is purely LRU.
    const embed: EmbedFn = async (t) => {
      const n = Number(t.replace('m', ''));
      const v = new Array(MAX_MEMORIES + 10).fill(0);
      v[n] = 1;
      return v;
    };
    const store = new MemoryStore({ io: makeMemoryIO(), embed });

    for (let i = 0; i < MAX_MEMORIES + 5; i++) {
      await store.add(`m${i}`, 'fact');
    }
    expect(store.size()).toBe(MAX_MEMORIES);
    // The earliest-added (m0..m4) should have been evicted as LRU.
    const texts = new Set(store.all().map((e) => e.text));
    expect(texts.has('m0')).toBe(false);
    expect(texts.has(`m${MAX_MEMORIES + 4}`)).toBe(true);
  });
});

describe('MemoryStore — persistence roundtrip + corrupt tolerance', () => {
  it('persists and reloads entries', async () => {
    const io = makeMemoryIO();
    const embed = makeEmbed({ 'uses gmail': [1, 0, 0] });
    const a = new MemoryStore({ io, embed });
    await a.add('uses gmail', 'fact');

    const b = new MemoryStore({ io, embed });
    b.load();
    expect(b.size()).toBe(1);
    expect(b.all()[0].text).toBe('uses gmail');
  });

  it('starts empty on a corrupt file without throwing', () => {
    const io = makeMemoryIO();
    io.data = '{not valid json';
    const store = new MemoryStore({ io, embed: makeEmbed({}) });
    expect(() => store.load()).not.toThrow();
    expect(store.size()).toBe(0);
  });

  it('remove() deletes by id and persists', async () => {
    const io = makeMemoryIO();
    const embed = makeEmbed({ one: [1, 0, 0] });
    const store = new MemoryStore({ io, embed });
    const e = await store.add('one', 'fact');
    expect(store.remove(e!.id)).toBe(true);
    expect(store.size()).toBe(0);
    expect(store.remove('nope')).toBe(false);
  });
});

describe('parseExtraction', () => {
  it('parses a valid JSON array', () => {
    const raw = '[{"text":"uses gmail","kind":"fact"},{"text":"likes dark mode","kind":"preference"}]';
    const out = parseExtraction(raw);
    expect(out).toEqual([
      { text: 'uses gmail', kind: 'fact' },
      { text: 'likes dark mode', kind: 'preference' },
    ]);
  });

  it('strips ```json code fences', () => {
    const raw = '```json\n[{"text":"drinks coffee daily","kind":"routine"}]\n```';
    const out = parseExtraction(raw);
    expect(out).toEqual([{ text: 'drinks coffee daily', kind: 'routine' }]);
  });

  it('tolerates prose around the array and unknown kinds', () => {
    const raw = 'Sure! Here you go: [{"text":"has a dog","kind":"animal"}] hope that helps';
    const out = parseExtraction(raw);
    expect(out).toEqual([{ text: 'has a dog', kind: 'fact' }]); // unknown kind → fact
  });

  it('skips malformed items and empty text', () => {
    const raw = '[{"kind":"fact"},{"text":"  "},{"text":"real fact","kind":"fact"},"junk",42]';
    const out = parseExtraction(raw);
    expect(out).toEqual([{ text: 'real fact', kind: 'fact' }]);
  });

  it('returns [] for empty array, junk, and empty input', () => {
    expect(parseExtraction('[]')).toEqual([]);
    expect(parseExtraction('total nonsense no brackets')).toEqual([]);
    expect(parseExtraction('')).toEqual([]);
    expect(parseExtraction('NONE')).toEqual([]);
  });
});

describe('buildExtractionPrompt', () => {
  it('embeds both turns and asks for a JSON array', () => {
    const p = buildExtractionPrompt('I always use Gmail', 'Got it.');
    expect(p).toContain('I always use Gmail');
    expect(p).toContain('Got it.');
    expect(p).toContain('JSON array');
  });
});
