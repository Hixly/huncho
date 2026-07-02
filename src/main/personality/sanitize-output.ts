/** Strip internal markup, coordinates, and emoji before chat display or TTS. */

const POINT_TAG = /\[POINT:\d+,\d+:[^:\]]+:screen\d+\]/gi;
const ELEMENT_MAP_LINE = /^\[\d+\]\s+\S+\s*@\d+\s*,\s*\d+:[^\n]*$/gim;
const BRACKET_META = /\[(?:Browser element map|Active window|Screenshot|Result of your previous)[^\]]*\][^\n]*/gi;
const AT_COORD = /@?\d+\s*,\s*\d+/g;
const SCREEN_TAG = /\bscreen\d+\b/gi;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu;
const MARKDOWN = /\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|`([^`]+)`/g;

export function sanitizeForUser(text: string): string {
  if (!text) return '';

  let out = text
    .replace(POINT_TAG, '')
    .replace(BRACKET_META, '')
    .replace(ELEMENT_MAP_LINE, '')
    .replace(AT_COORD, '')
    .replace(SCREEN_TAG, '')
    .replace(EMOJI, '')
    .replace(MARKDOWN, (_m, a, b, c, d) => a ?? b ?? c ?? d ?? '')
    .replace(/\s+at\s*[.,]?\s*$/gi, '')
    .replace(/\s+\.\s*$/g, '.')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return out;
}
