import type { ElementMapEntry } from './dom-agent';

export const ELEMENT_MAP_MAX_ENTRIES = 80;

type ViewportRegion = 'top' | 'mid' | 'bottom';

function regionFor(y: number, viewportHeight: number): ViewportRegion {
  const third = Math.max(viewportHeight, 1) / 3;
  if (y < third) return 'top';
  if (y < third * 2) return 'mid';
  return 'bottom';
}

function regionLabel(region: ViewportRegion, viewportHeight: number): string {
  const third = Math.round(Math.max(viewportHeight, 1) / 3);
  switch (region) {
    case 'top':
      return `[top — y 0–${third}]`;
    case 'mid':
      return `[mid — y ${third}–${third * 2}]`;
    case 'bottom':
      return `[bottom — y ${third * 2}+]`;
    default: {
      const _exhaustive: never = region;
      return _exhaustive;
    }
  }
}

function formatEntry(entry: ElementMapEntry): string {
  const { x, y } = entry.bbox;
  return `[${entry.n}] ${entry.type} @${x},${y}: ${entry.text}`;
}

/**
 * Build the element-map block Claude sees. Groups by viewport region and
 * includes pixel hints so the model can cross-reference the screenshot.
 */
export function formatElementMapForClaude(
  entries: ElementMapEntry[],
  options?: { maxEntries?: number; viewportHeight?: number },
): string {
  const maxEntries = options?.maxEntries ?? ELEMENT_MAP_MAX_ENTRIES;
  const viewportHeight = options?.viewportHeight ?? 900;

  if (entries.length === 0) return '';

  const shown = entries.slice(0, maxEntries);
  const truncated = entries.length > maxEntries;
  const lines: string[] = [
    '[Browser element map — only use these numbers with click/type_text]',
    `Viewport ~${viewportHeight}px tall. Showing ${shown.length} of ${entries.length} visible elements.`,
  ];

  let currentRegion: ViewportRegion | null = null;
  for (const entry of shown) {
    const region = regionFor(entry.bbox.y, viewportHeight);
    if (region !== currentRegion) {
      currentRegion = region;
      lines.push('');
      lines.push(regionLabel(region, viewportHeight));
    }
    lines.push(formatEntry(entry));
  }

  if (truncated) {
    const omitted = entries.length - maxEntries;
    lines.push('');
    lines.push(
      `(Truncated: ${omitted} more visible elements omitted. Scroll down with scroll(down) or scroll(bottom), then Continue to refresh the map.)`,
    );
  }

  return lines.join('\n');
}
