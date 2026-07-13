/**
 * MemoryStore — local-first, Mem0-style long-term memory for Huncho.
 *
 * Durable user facts, preferences and routines are embedded once (via the
 * injected embed function — in production the local all-MiniLM-L6-v2 pipeline
 * from ./embeddings.ts) and recalled by cosine similarity. Fully offline: no
 * API spend, nothing leaves the machine.
 *
 * This module is PURE logic with no Electron imports. Persistence goes through
 * an injected IO pair or, by default, a plain file path handled with node's fs
 * (atomic write via temp-file + rename). The embedding function is injected too,
 * so the whole store is unit-testable with deterministic mock vectors.
 */

import { cosineSimilarity } from './embeddings';

export type MemoryKind = 'preference' | 'fact' | 'routine';

const MEMORY_KINDS: readonly MemoryKind[] = ['preference', 'fact', 'routine'];

export interface MemoryEntry {
  id: string;
  text: string;
  kind: MemoryKind;
  embedding: number[];
  createdAt: number;
  lastUsedAt: number;
  uses: number;
}

export interface MemoryIO {
  read(): string | null;
  write(data: string): void;
}

/** Embed a string into a vector. Production wires this to embeddings.ts. */
export type EmbedFn = (text: string) => Promise<number[]>;

/** Cap on stored memories; least-recently-used entries are evicted past this. */
export const MAX_MEMORIES = 200;

/** Cosine similarity at/above which add() updates an existing entry rather than
 *  inserting a near-duplicate. */
export const DEDUPE_SIMILARITY = 0.9;

export interface ExtractedMemory {
  text: string;
  kind: MemoryKind;
}

/**
 * Parse a model extraction response into a list of {text, kind}. Defensive:
 * strips markdown code fences, isolates the first JSON array, tolerates junk
 * (returns [] on unparseable input), and skips malformed items. An unknown or
 * missing kind is coerced to 'fact'; empty/whitespace text is dropped.
 */
export function parseExtraction(raw: string): ExtractedMemory[] {
  if (!raw || typeof raw !== 'string') return [];

  // Strip ```json … ``` / ``` … ``` fences.
  let s = raw.trim();
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Isolate the first JSON array in the text (models often prepend prose).
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  s = s.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ExtractedMemory[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) continue;
    const rawKind = typeof rec.kind === 'string' ? rec.kind.trim().toLowerCase() : '';
    const kind = (MEMORY_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as MemoryKind)
      : 'fact';
    out.push({ text, kind });
  }
  return out;
}

/**
 * Build the extraction prompt sent to the cheap model call after a completed
 * turn. Asks for a strict JSON array of durable user facts/preferences/routines
 * worth remembering across sessions — or [] when there's nothing.
 */
export function buildExtractionPrompt(userText: string, assistantText: string): string {
  return `You extract DURABLE long-term memories about the user ("Hix") from a single conversation turn, for a personal assistant that should remember them across sessions.

Return ONLY a JSON array. Each item: {"text": string, "kind": "preference" | "fact" | "routine"}.
Return [] if nothing is worth remembering.

INCLUDE only durable, user-specific things:
- preference: stable likes/dislikes, defaults, how they want things done ("prefers dark mode", "likes concise answers")
- fact: stable personal facts ("uses Gmail", "lives in Chicago", "drives a Tesla")
- routine: recurring habits/workflows ("checks email every morning", "orders coffee on Fridays")

EXCLUDE:
- one-off commands or task chatter ("open youtube", "scroll down", "what's this")
- transient state, questions, or anything about the current page only
- anything you're not confident is durable

User: ${userText}
Assistant: ${assistantText}

JSON array:`;
}

// Default file-backed IO with atomic write (temp + rename).
function defaultIO(filePath: string): MemoryIO {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  return {
    read(): string | null {
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
    },
    write(data: string): void {
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, filePath);
    },
  };
}

export class MemoryStore {
  private entries: MemoryEntry[] = [];
  private io: MemoryIO;
  private embed: EmbedFn;
  private idCounter = 0;

  constructor(opts: { filePath?: string; io?: MemoryIO; embed: EmbedFn }) {
    this.embed = opts.embed;
    if (opts.io) {
      this.io = opts.io;
    } else if (opts.filePath) {
      this.io = defaultIO(opts.filePath);
    } else {
      throw new Error('MemoryStore requires a filePath or an io implementation');
    }
  }

  /** Load persisted memories from disk. Silently starts empty on any problem. */
  load(): void {
    const raw = this.io.read();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { entries?: MemoryEntry[] };
      const list = Array.isArray(parsed.entries) ? parsed.entries : [];
      this.entries = list.filter(
        (e): e is MemoryEntry =>
          !!e &&
          typeof e.id === 'string' &&
          typeof e.text === 'string' &&
          Array.isArray(e.embedding),
      );
    } catch {
      // corrupt file — ignore, start fresh
      this.entries = [];
    }
  }

  private save(): void {
    const data = JSON.stringify({ entries: this.entries });
    try {
      this.io.write(data);
    } catch {
      // persistence is best-effort; never throw into the pipeline
    }
  }

  private nextId(): string {
    return `mem_${Date.now().toString(36)}_${(this.idCounter++).toString(36)}`;
  }

  /**
   * Add a memory. Dedupe: if the new text embeds within DEDUPE_SIMILARITY of an
   * existing entry, that entry's text is refreshed (and its recency bumped)
   * instead of inserting a near-duplicate. Returns the affected entry.
   */
  async add(text: string, kind: MemoryKind): Promise<MemoryEntry | null> {
    const clean = (text || '').trim();
    if (!clean) return null;

    const vector = await this.embed(clean);
    const now = Date.now();

    // Dedupe against existing entries by cosine similarity.
    let best: MemoryEntry | null = null;
    let bestSim = -Infinity;
    for (const e of this.entries) {
      const sim = cosineSimilarity(vector, e.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        best = e;
      }
    }
    if (best && bestSim >= DEDUPE_SIMILARITY) {
      best.text = clean;
      best.kind = kind;
      best.embedding = vector;
      best.lastUsedAt = now;
      this.save();
      return best;
    }

    const entry: MemoryEntry = {
      id: this.nextId(),
      text: clean,
      kind,
      embedding: vector,
      createdAt: now,
      lastUsedAt: now,
      uses: 0,
    };
    this.entries.push(entry);
    this.evictIfNeeded();
    this.save();
    return entry;
  }

  /**
   * Recall the top-k memories most similar to the query above minSim. Bumps
   * lastUsedAt/uses on every returned entry. Returns best-first.
   */
  async recall(query: string, k = 3, minSim = 0.35): Promise<MemoryEntry[]> {
    const clean = (query || '').trim();
    if (!clean || this.entries.length === 0) return [];

    const qVec = await this.embed(clean);
    const scored = this.entries
      .map((e) => ({ e, sim: cosineSimilarity(qVec, e.embedding) }))
      .filter((s) => s.sim >= minSim)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k);

    if (scored.length === 0) return [];

    const now = Date.now();
    for (const s of scored) {
      s.e.lastUsedAt = now;
      s.e.uses += 1;
    }
    this.save();
    return scored.map((s) => s.e);
  }

  /** Remove a memory by id. Returns true if one was removed. */
  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    const removed = this.entries.length !== before;
    if (removed) this.save();
    return removed;
  }

  /** All stored memories (live references — treat as read-only). */
  all(): MemoryEntry[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }

  /** Evict least-recently-used entries down to MAX_MEMORIES. */
  private evictIfNeeded(): void {
    if (this.entries.length <= MAX_MEMORIES) return;
    // Sort oldest-used first, drop from the front until within cap.
    this.entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    this.entries = this.entries.slice(this.entries.length - MAX_MEMORIES);
  }
}
