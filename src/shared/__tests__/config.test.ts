import { describe, it, expect } from 'vitest';
import { DUXY_CONFIG } from '../../main/config';

describe('Huncho config', () => {
  it('identifies as Huncho, not Duxy, in the system prompt', () => {
    expect(DUXY_CONFIG.systemPrompt).toContain('You are Huncho');
    expect(DUXY_CONFIG.systemPrompt).not.toContain('You are Duxy');
  });

  it('has a worker base URL and a default model', () => {
    expect(DUXY_CONFIG.workerBaseURL).toMatch(/^https:\/\//);
    expect(DUXY_CONFIG.defaultModel.length).toBeGreaterThan(0);
  });
});
