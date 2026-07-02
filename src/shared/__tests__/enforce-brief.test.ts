import { describe, it, expect } from 'vitest';
import { enforceBriefResponse } from '../../main/personality/enforce-brief';

describe('enforceBriefResponse', () => {
  it('caps to first sentence and max words', () => {
    const raw = 'Scrolling down. Scrolling down further. I am on the site now.';
    expect(enforceBriefResponse(raw, 5)).toBe('Scrolling down.');
  });

  it('does not add a period to a single streaming word', () => {
    expect(enforceBriefResponse('Clicking', 8)).toBe('Clicking');
  });

  it('returns empty for blank input', () => {
    expect(enforceBriefResponse('   ')).toBe('');
  });

  it('strips POINT tags before enforcing', () => {
    const raw = 'Clicking VIDEO [POINT:100,200:Video:screen99] in the menu.';
    expect(enforceBriefResponse(raw, 6)).toBe('Clicking VIDEO in the menu.');
  });
});
