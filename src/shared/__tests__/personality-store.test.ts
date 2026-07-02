import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/huncho-test' },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { PersonalityStore } from '../../main/personality/PersonalityStore';

describe('PersonalityStore feedback learning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('learns no-emoji preference', () => {
    const store = new PersonalityStore();
    store.load();
    expect(store.tryLearnFromUserMessage("Don't use emoji")).toBe(true);
    expect(store.getLearnedRules()).toContain('Never use emojis in any response.');
  });

  it('learns brevity preference', () => {
    const store = new PersonalityStore();
    store.load();
    expect(store.tryLearnFromUserMessage('That was too long, be briefer')).toBe(true);
    expect(store.getLearnedRules().some((r) => r.includes('short'))).toBe(true);
  });
});
