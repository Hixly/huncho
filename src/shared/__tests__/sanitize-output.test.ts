import { describe, it, expect } from 'vitest';
import { sanitizeForUser } from '../../main/personality/sanitize-output';

describe('sanitizeForUser', () => {
  it('removes POINT tags and coordinates from spoken text', () => {
    const raw = 'The bar is here [POINT:760,180:search bar:screen99] at @480,120.';
    expect(sanitizeForUser(raw)).toBe('The bar is here');
  });

  it('removes emoji', () => {
    expect(sanitizeForUser('Done! 🎉🔥')).toBe('Done!');
  });

  it('strips element map style lines', () => {
    const raw = 'Pick one:\n[3] button @480,120: Sign in\nDone.';
    expect(sanitizeForUser(raw)).not.toContain('@480');
    expect(sanitizeForUser(raw)).toContain('Done.');
  });
});
