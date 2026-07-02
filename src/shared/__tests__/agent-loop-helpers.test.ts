import { describe, it, expect } from 'vitest';

/** Mirror of CompanionManager.appendAggregatedLine for regression tests. */
function appendAggregatedLine(aggregated: string, line: string): string {
  const next = line.trim();
  if (!next) return aggregated;
  const last = aggregated.split('\n\n').pop()?.trim();
  if (last === next) return aggregated;
  return aggregated ? `${aggregated}\n\n${next}` : next;
}

describe('appendAggregatedLine', () => {
  it('dedupes consecutive identical lines', () => {
    const once = appendAggregatedLine('', 'Working on it.');
    const twice = appendAggregatedLine(once, 'Working on it.');
    expect(twice).toBe('Working on it.');
  });

  it('appends distinct lines', () => {
    const out = appendAggregatedLine('Scrolled down.', 'Opening site.');
    expect(out).toBe('Scrolled down.\n\nOpening site.');
  });
});
