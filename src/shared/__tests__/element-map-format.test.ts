import { describe, it, expect } from 'vitest';
import { formatElementMapForClaude } from '../../main/tools/element-map-format';
import type { ElementMapEntry } from '../../main/tools/dom-agent';

function entry(n: number, y: number, text: string): ElementMapEntry {
  return { n, type: 'button', text, bbox: { x: 100, y, w: 80, h: 24 } };
}

describe('formatElementMapForClaude', () => {
  it('groups entries by viewport region and includes coordinates', () => {
    const map = [
      entry(1, 50, 'Home'),
      entry(2, 400, 'Search'),
      entry(3, 800, 'Footer'),
    ];
    const out = formatElementMapForClaude(map, { viewportHeight: 900 });
    expect(out).toContain('[top —');
    expect(out).toContain('[1] button @100,50: Home');
    expect(out).toContain('[mid —');
    expect(out).toContain('[2] button @100,400: Search');
    expect(out).toContain('[bottom —');
    expect(out).toContain('[3] button @100,800: Footer');
  });

  it('notes truncation when the map exceeds the cap', () => {
    const map = Array.from({ length: 85 }, (_, i) => entry(i + 1, 100, `item-${i + 1}`));
    const out = formatElementMapForClaude(map, { maxEntries: 80, viewportHeight: 900 });
    expect(out).toContain('Showing 80 of 85');
    expect(out).toContain('Truncated: 5 more');
  });
});
