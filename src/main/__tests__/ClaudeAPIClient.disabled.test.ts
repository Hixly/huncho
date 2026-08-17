import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable config so tests can toggle whether a cloud proxy is configured.
const mockConfig = vi.hoisted(() => ({
  cloudFallbackUrl: '',
}));
vi.mock('../config', () => ({ DUXY_CONFIG: mockConfig }));

import { ClaudeAPIClient } from '../ClaudeAPIClient';
import type { ClaudeRequestOptions } from '../ClaudeAPIClient';

const options: ClaudeRequestOptions = {
  transcript: 'hi',
  screenshotBase64List: [],
  conversationHistory: [],
  model: 'claude-sonnet-4-5',
  systemPrompt: 'sys',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'x', body: null }));
  (global as any).fetch = fetchMock;
});

afterEach(() => vi.restoreAllMocks());

describe('ClaudeAPIClient with no cloud proxy (public build)', () => {
  it('does not fetch and surfaces a clear "unavailable" error when cloudFallbackUrl is empty', async () => {
    mockConfig.cloudFallbackUrl = '';
    const client = new ClaudeAPIClient();
    await expect(client.sendMessage(options)).rejects.toThrow(/unavailable in this build/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does attempt a fetch when a proxy IS configured (self-hosted build)', async () => {
    mockConfig.cloudFallbackUrl = 'https://my-proxy.example';
    const client = new ClaudeAPIClient();
    // 500 → throws an API error, but importantly it DID reach fetch.
    await expect(client.sendMessage(options)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://my-proxy.example/chat');
  });
});
