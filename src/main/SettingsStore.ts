import * as fs from 'fs';
import * as path from 'path';

/**
 * User settings persisted as JSON on disk. In a public build the ONLY secret a
 * user brings is their own Gemini API key — stored here, on their machine, and
 * never sent back to the renderer or logged in the clear.
 *
 * Electron-optional by design: the file path can be injected so the store is
 * unit-testable without an Electron app instance. When no path is given it
 * lazily resolves `app.getPath('userData')/settings.json`.
 */
export interface Settings {
  geminiApiKey?: string;
  // Extensible: future keys (other providers, prefs) live here.
}

/** Mask a secret for logs: show the provider prefix + last 4, never the middle. */
export function maskKey(key: string | null | undefined): string {
  if (!key) return '(none)';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export class SettingsStore {
  private filePath: string | null;
  private cache: Settings | null = null;

  /**
   * @param filePath Explicit JSON path. Omit in the real app to resolve lazily
   *   from Electron userData (kept out of the constructor so tests never touch
   *   the electron module).
   */
  constructor(filePath?: string) {
    this.filePath = filePath ?? null;
  }

  private resolvePath(): string {
    if (this.filePath) return this.filePath;
    // Lazy require so unit tests using an injected path never load electron.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    this.filePath = path.join(app.getPath('userData'), 'settings.json');
    return this.filePath;
  }

  /** Read + cache settings. Missing/corrupt file → empty settings (never throws). */
  get(): Settings {
    if (this.cache) return this.cache;
    try {
      const raw = fs.readFileSync(this.resolvePath(), 'utf-8');
      const parsed = JSON.parse(raw);
      this.cache = parsed && typeof parsed === 'object' ? (parsed as Settings) : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  /** The trimmed Gemini key, or null when absent/blank. */
  getGeminiKey(): string | null {
    const key = this.get().geminiApiKey;
    if (typeof key !== 'string') return null;
    const trimmed = key.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  hasGeminiKey(): boolean {
    return this.getGeminiKey() !== null;
  }

  /** Persist a new Gemini key. Empty/whitespace clears it. */
  setGeminiKey(key: string): void {
    const trimmed = (key ?? '').trim();
    const next: Settings = { ...this.get() };
    if (trimmed.length > 0) {
      next.geminiApiKey = trimmed;
    } else {
      delete next.geminiApiKey;
    }
    this.write(next);
    console.log(`[SettingsStore] Gemini key ${trimmed ? `set (${maskKey(trimmed)})` : 'cleared'}`);
  }

  /** Atomic write: temp file + rename so a crash mid-write can't truncate the store. */
  private write(settings: Settings): void {
    const target = this.resolvePath();
    const dir = path.dirname(target);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // dir may already exist — ignore
    }
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
    this.cache = settings;
  }
}
