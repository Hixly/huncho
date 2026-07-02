import { describe, it, expect } from 'vitest';
import { buildClickLabelQueries } from '../../main/tools/resolve-click-target';

describe('buildClickLabelQueries', () => {
  it('prefers reason and map text, then click tail from transcript', () => {
    const queries = buildClickLabelQueries(
      'open CBS Sports article',
      'Ranking the 25 greatest players in Steelers history',
      'Click on the CBS Sports link about ranking the 25 greatest Steelers players.',
    );
    expect(queries[0]).toBe('open CBS Sports article');
    expect(queries).toContain('Ranking the 25 greatest players in Steelers history');
    expect(queries.some((q) => q.includes('CBS Sports link'))).toBe(true);
  });

  it('skips very short strings', () => {
    expect(buildClickLabelQueries('ok', 'ab', 'hi')).toEqual([]);
  });
});
