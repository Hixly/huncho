import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsStore, maskKey } from '../SettingsStore';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huncho-settings-'));
  file = path.join(dir, 'settings.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('round-trips a Gemini key through an injected path', () => {
    const a = new SettingsStore(file);
    expect(a.hasGeminiKey()).toBe(false);
    expect(a.getGeminiKey()).toBeNull();

    a.setGeminiKey('AIzaSampleKey1234');
    expect(a.hasGeminiKey()).toBe(true);
    expect(a.getGeminiKey()).toBe('AIzaSampleKey1234');

    // A fresh instance reads the persisted value (real disk write happened).
    const b = new SettingsStore(file);
    expect(b.getGeminiKey()).toBe('AIzaSampleKey1234');
  });

  it('trims the key and treats whitespace/empty as absent', () => {
    const s = new SettingsStore(file);
    s.setGeminiKey('   AIzaTrimmed   ');
    expect(s.getGeminiKey()).toBe('AIzaTrimmed');

    s.setGeminiKey('   ');
    expect(s.hasGeminiKey()).toBe(false);
    expect(s.getGeminiKey()).toBeNull();

    // Cleared value is gone from the persisted JSON too.
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(persisted.geminiApiKey).toBeUndefined();
  });

  it('tolerates a missing file (returns empty settings, never throws)', () => {
    const s = new SettingsStore(path.join(dir, 'does-not-exist.json'));
    expect(() => s.get()).not.toThrow();
    expect(s.get()).toEqual({});
    expect(s.hasGeminiKey()).toBe(false);
  });

  it('tolerates a corrupt file (falls back to empty settings)', () => {
    fs.writeFileSync(file, '{ not valid json', 'utf-8');
    const s = new SettingsStore(file);
    expect(s.get()).toEqual({});
    expect(s.hasGeminiKey()).toBe(false);
  });

  it('writes atomically (no leftover temp files after a set)', () => {
    const s = new SettingsStore(file);
    s.setGeminiKey('AIzaAtomic');
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('creates the parent directory if it does not exist', () => {
    const nested = path.join(dir, 'a', 'b', 'settings.json');
    const s = new SettingsStore(nested);
    s.setGeminiKey('AIzaNested');
    expect(fs.existsSync(nested)).toBe(true);
    expect(new SettingsStore(nested).getGeminiKey()).toBe('AIzaNested');
  });

  it('masks keys for logging and never reveals the middle', () => {
    expect(maskKey('AIzaSampleKey1234')).toBe('AIza…1234');
    expect(maskKey('short')).toBe('****');
    expect(maskKey(null)).toBe('(none)');
    expect(maskKey('')).toBe('(none)');
    expect(maskKey('AIzaSampleKey1234')).not.toContain('Sample');
  });
});
