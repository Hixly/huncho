import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiAPIClient, NO_GEMINI_KEY_MESSAGE } from '../GeminiAPIClient';
import type { ClaudeRequestOptions } from '../ClaudeAPIClient';

// A minimal SettingsStore stand-in (only getGeminiKey is used by the client).
function fakeSettings(key: string | null) {
  return { getGeminiKey: () => key } as any;
}

const baseOptions: ClaudeRequestOptions = {
  transcript: 'hello',
  screenshotBase64List: [],
  conversationHistory: [],
  model: 'gemini-2.5-flash',
  systemPrompt: 'sys',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Capture the request URL, then end the attempt fast with a non-retryable 400
  // so sendMessage rejects quickly (we only care about which key was used).
  fetchMock = vi.fn(async () => ({
    ok: false,
    status: 400,
    text: async () => 'stop',
  }));
  (global as any).fetch = fetchMock;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  vi.restoreAllMocks();
});

function urlOfFirstCall(): string {
  return String(fetchMock.mock.calls[0][0]);
}

describe('GeminiAPIClient key resolution', () => {
  it('throws a clear, user-facing error when neither settings nor env has a key', async () => {
    const client = new GeminiAPIClient(fakeSettings(null));
    await expect(client.sendMessage(baseOptions)).rejects.toThrow(NO_GEMINI_KEY_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the SettingsStore key over the env var', async () => {
    process.env.GEMINI_API_KEY = 'env-key';
    const client = new GeminiAPIClient(fakeSettings('settings-key'));
    await expect(client.sendMessage(baseOptions)).rejects.toThrow(); // 400 stops it
    expect(urlOfFirstCall()).toContain('key=settings-key');
    expect(urlOfFirstCall()).not.toContain('env-key');
  });

  it('falls back to the env var when settings has no key (dev fallback)', async () => {
    process.env.GEMINI_API_KEY = 'env-key';
    const client = new GeminiAPIClient(fakeSettings(null));
    await expect(client.sendMessage(baseOptions)).rejects.toThrow();
    expect(urlOfFirstCall()).toContain('key=env-key');
  });

  it('works with no injected SettingsStore, resolving from env only', async () => {
    process.env.GEMINI_API_KEY = 'env-only';
    const client = new GeminiAPIClient();
    await expect(client.sendMessage(baseOptions)).rejects.toThrow();
    expect(urlOfFirstCall()).toContain('key=env-only');
  });

  it('generateText also resolves via the same rules and throws when no key', async () => {
    const client = new GeminiAPIClient(fakeSettings(null));
    await expect(client.generateText('extract this')).rejects.toThrow(NO_GEMINI_KEY_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
