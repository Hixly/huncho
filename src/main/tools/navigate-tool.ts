// The single tool exposed to Claude in Phase 1B. Defines the exact JSON shape
// Anthropic's Messages API expects in the `tools` array, plus a strict
// normalizer that turns whatever the model emits into a safe https URL.

export const NAVIGATE_TOOL = {
  name: 'navigate',
  description:
    "Navigate Huncho's in-app browser to a URL. Use this whenever the user asks " +
    "to open, go to, or visit a website (e.g. 'open YouTube', 'go to Gmail'). " +
    "The 'url' argument can be a full URL ('https://youtube.com'), a bare domain " +
    "('youtube.com'), or a search term (which becomes a Google search).",
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        description: 'URL, bare domain, or search query to navigate to.',
      },
    },
    required: ['url'],
  },
} as const;

export type NavigateToolInput = { url: string };

const FORBIDDEN_PROTOCOLS = ['javascript:', 'file:', 'data:', 'vbscript:'];

/**
 * Turn whatever the model emits into a safe https URL — or null if it's
 * something we refuse to navigate to. Rules:
 *  - trim
 *  - reject javascript:/file:/data:/vbscript:
 *  - http://  -> https://
 *  - already https://  -> pass through
 *  - contains a dot, no protocol  -> prepend https://
 *  - no dot, no protocol  -> wrap as google search
 */
export function normalizeNavigateUrl(input: string): string | null {
  if (typeof input !== 'string') return null;
  let trimmed = input.trim().replace(/[.!?,;:]+$/, '');
  if (!trimmed) return null;

  const goToMatch = trimmed.match(
    /^(?:go to|open|visit|navigate to|take me to)\s+(?:the\s+)?(.+)$/i,
  );
  if (goToMatch?.[1]) {
    trimmed = goToMatch[1].trim().replace(/[.!?,;:]+$/, '');
  }

  const domainMatch = trimmed.match(
    /\b([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+\.[a-z]{2,})\b/i,
  );
  if (domainMatch) {
    return `https://${domainMatch[1].toLowerCase()}`;
  }

  const lower = trimmed.toLowerCase();
  for (const bad of FORBIDDEN_PROTOCOLS) {
    if (lower.startsWith(bad)) return null;
  }

  if (lower.startsWith('https://')) return trimmed;
  if (lower.startsWith('http://')) return 'https://' + trimmed.slice('http://'.length);

  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return `https://${trimmed.toLowerCase()}`;
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(trimmed);
}
