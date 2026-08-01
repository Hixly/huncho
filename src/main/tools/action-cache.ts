/**
 * Action cache — Stagehand-v3-style replay of repeated voice commands.
 *
 * When Hix says the same thing twice ("open YouTube", "search my email for
 * flights"), the first run is model-driven (Gemini decides each tool call). We
 * record the resulting tool sequence keyed by a normalized transcript. The next
 * time the same intent comes in, we replay those steps directly — no LLM
 * round-trip — verifying each click/type target still resolves against the live
 * element map before touching it.
 *
 * This module is PURE logic: no Electron imports. Persistence is done through an
 * injected IO pair (read/write) or, by default, a plain file path handled with
 * node's fs (atomic write via temp-file + rename). That keeps it unit-testable
 * without a running app.
 */

import type { ElementMapEntry } from './dom-agent';

export type CachedTool = 'navigate' | 'click' | 'type_text' | 'scroll' | 'read_page';

export interface CachedStep {
  tool: CachedTool;
  /** The tool args as given to the executor. For click/type_text the element
   *  NUMBER is intentionally omitted — numbers change between page loads, so we
   *  re-resolve via targetFingerprint at replay time. */
  args: Record<string, unknown>;
  /** For click/type_text: the element-map text/description of the target at
   *  record time. Used to re-find the element on replay. */
  targetFingerprint?: string;
}

export interface CacheEntry {
  intentKey: string;
  /** Origin (protocol + host) of the page the run started on. */
  startUrlPattern: string;
  steps: CachedStep[];
  hits: number;
  createdAt: number;
  lastOkAt: number;
}

export interface CacheIO {
  read(): string | null;
  write(data: string): void;
}

export interface RecordableRun {
  steps: CachedStep[];
  /** True when the run finished without abort/error. */
  completedCleanly: boolean;
  /** True if ANY step in the run hit a confirmation-gated action (buy/pay/…). */
  hadConfirmationGated: boolean;
  /** The original transcript (used for question-word screening). */
  transcript: string;
}

export const MAX_ENTRIES = 100;

const LEADING_FILLERS = [
  'hey',
  'ok',
  'okay',
  'please',
  'can you',
  'could you',
  'would you',
  'will you',
  'huncho',
  'honcho', // common ASR mishear of the wake word — see wake/wake-phrase.ts
  'jarvis',
  'yo',
  'um',
  'uh',
];

/** Question/read words that imply the user wants an ANSWER, not a repeatable
 *  action. Runs whose transcript contains these are never cached. */
const QUESTION_WORDS = [
  'what',
  'how much',
  'how many',
  'read',
  'summarize',
  'summarise',
  'explain',
  'tell me',
  'who',
  'why',
];

/**
 * Normalize a transcript into a stable intent key: lowercase, strip punctuation,
 * strip leading filler words, collapse whitespace.
 */
export function normalizeIntent(transcript: string): string {
  let s = (transcript || '').toLowerCase();
  // strip punctuation (keep spaces + alphanumerics)
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // strip leading fillers, repeatedly (handles "hey huncho please …")
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of LEADING_FILLERS) {
      if (s === filler) {
        s = '';
        changed = true;
        break;
      }
      if (s.startsWith(filler + ' ')) {
        s = s.slice(filler.length + 1);
        changed = true;
        break;
      }
    }
  }
  return s.trim();
}

/** Normalize an element fingerprint / label for matching. */
function normFp(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Re-resolve a stored target fingerprint against the current element map.
 * Exact normalized match wins; otherwise a substring match in either direction
 * (longest overlap preferred). Returns null when nothing is confident.
 */
export function resolveFingerprint(
  fingerprint: string | undefined,
  elementMap: ElementMapEntry[],
): ElementMapEntry | null {
  const q = normFp(fingerprint ?? '');
  if (!q || elementMap.length === 0) return null;

  // 1) exact
  for (const e of elementMap) {
    if (normFp(e.text) === q) return e;
  }

  // 2) substring (either direction) — prefer the closest length match
  let best: ElementMapEntry | null = null;
  let bestScore = 0;
  for (const e of elementMap) {
    const t = normFp(e.text);
    if (!t) continue;
    if (t.includes(q) || q.includes(t)) {
      const score = Math.min(t.length, q.length);
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
  }
  // require a minimally meaningful overlap so a 1-char stray doesn't match
  return bestScore >= 3 ? best : null;
}

/**
 * Origin (protocol + host) of a URL, for start-page matching. Returns '' when
 * the URL can't be parsed (e.g. about:blank, empty).
 */
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Decide whether a completed run is worth caching.
 *   - at least one tool step
 *   - completed cleanly
 *   - no confirmation-gated step (buy/pay/send/delete …)
 *   - not a read_page-only run (nothing to replay usefully)
 *   - transcript free of question/read words
 */
export function shouldCache(run: RecordableRun): boolean {
  if (!run.completedCleanly) return false;
  if (run.hadConfirmationGated) return false;
  if (!run.steps || run.steps.length === 0) return false;

  const hasActionStep = run.steps.some((s) => s.tool !== 'read_page');
  if (!hasActionStep) return false;

  const key = normalizeIntent(run.transcript);
  for (const w of QUESTION_WORDS) {
    if (key.includes(w)) return false;
  }
  return true;
}

// Default file-backed IO with atomic write (temp + rename).
function defaultIO(filePath: string): CacheIO {
  // Lazily require fs so the module stays import-clean for pure unit tests that
  // inject their own IO.
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

export class ActionCache {
  private entries = new Map<string, CacheEntry>();
  private io: CacheIO;

  constructor(opts: { filePath?: string; io?: CacheIO }) {
    if (opts.io) {
      this.io = opts.io;
    } else if (opts.filePath) {
      this.io = defaultIO(opts.filePath);
    } else {
      throw new Error('ActionCache requires a filePath or an io implementation');
    }
  }

  /** Load persisted entries from disk. Silently starts empty on any problem. */
  load(): void {
    const raw = this.io.read();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { entries?: CacheEntry[] };
      const list = Array.isArray(parsed.entries) ? parsed.entries : [];
      this.entries.clear();
      for (const e of list) {
        if (e && typeof e.intentKey === 'string' && Array.isArray(e.steps)) {
          this.entries.set(e.intentKey, e);
        }
      }
    } catch {
      // corrupt file — ignore, start fresh
    }
  }

  private save(): void {
    const data = JSON.stringify({ entries: [...this.entries.values()] });
    try {
      this.io.write(data);
    } catch {
      // persistence is best-effort; never throw into the agent loop
    }
  }

  lookup(intentKey: string): CacheEntry | null {
    return this.entries.get(intentKey) ?? null;
  }

  /** Record (or overwrite) the step list for an intent, then persist. */
  recordRun(intentKey: string, steps: CachedStep[], startUrl: string): void {
    if (!intentKey || steps.length === 0) return;
    const now = Date.now();
    const existing = this.entries.get(intentKey);
    const entry: CacheEntry = {
      intentKey,
      startUrlPattern: originOf(startUrl),
      steps,
      hits: existing?.hits ?? 0,
      createdAt: existing?.createdAt ?? now,
      lastOkAt: now,
    };
    // Re-insert last so Map iteration order tracks recency.
    this.entries.delete(intentKey);
    this.entries.set(intentKey, entry);
    this.evictIfNeeded();
    this.save();
  }

  /** Bump hit count + recency on a successful replay. */
  markHit(intentKey: string): void {
    const entry = this.entries.get(intentKey);
    if (!entry) return;
    entry.hits += 1;
    entry.lastOkAt = Date.now();
    this.entries.delete(intentKey);
    this.entries.set(intentKey, entry);
    this.save();
  }

  /** Drop an entry (fingerprint mismatch, replay error, etc.). */
  invalidate(intentKey: string): void {
    if (this.entries.delete(intentKey)) this.save();
  }

  size(): number {
    return this.entries.size;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > MAX_ENTRIES) {
      // Least-recently-used by lastOkAt. Map insertion order roughly tracks
      // this, but scan to be exact (cheap at 100 entries).
      let lruKey: string | null = null;
      let lruAt = Infinity;
      for (const [k, e] of this.entries) {
        if (e.lastOkAt < lruAt) {
          lruAt = e.lastOkAt;
          lruKey = k;
        }
      }
      if (lruKey === null) break;
      this.entries.delete(lruKey);
    }
  }
}
