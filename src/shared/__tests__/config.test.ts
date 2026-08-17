import { describe, it, expect } from 'vitest';
import { DUXY_CONFIG } from '../../main/config';

describe('Huncho config', () => {
  it('identifies as Huncho, not Duxy, in the system prompt', () => {
    expect(DUXY_CONFIG.systemPrompt).toContain('You are Huncho');
    expect(DUXY_CONFIG.systemPrompt).not.toContain('You are Duxy');
  });

  it('ships no personal cloud proxy (public build: cloudFallbackUrl is empty)', () => {
    // Public builds must not point at anyone's personal worker. Empty = every
    // cloud path is disabled cleanly.
    expect(DUXY_CONFIG.cloudFallbackUrl).toBe('');
  });

  it('has a default model', () => {
    expect(DUXY_CONFIG.defaultModel.length).toBeGreaterThan(0);
  });

  it('does not embed any personal domain in the system prompt', () => {
    expect(DUXY_CONFIG.systemPrompt).not.toContain('matthixon');
    expect(DUXY_CONFIG.systemPrompt).not.toContain('duxy-worker');
  });
});
