import { sanitizeForUser } from './sanitize-output';

/** Hard cap for BRIEF mode — one short phrase per agent iteration. */
export function enforceBriefResponse(text: string, maxWords = 8): string {
  const cleaned = sanitizeForUser(text);
  if (!cleaned) return '';

  const firstSentence = cleaned.split(/[.!?](?:\s|$)/)[0]?.trim() || cleaned;
  const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, maxWords);
  if (words.length === 0) return '';

  const phrase = words.join(' ');
  // Avoid turning a partial stream chunk into a one-word "sentence."
  if (words.length === 1 && !/[.!?]$/.test(cleaned.trim())) {
    return phrase;
  }

  return phrase.endsWith('.') || phrase.endsWith('!') || phrase.endsWith('?')
    ? phrase
    : `${phrase}.`;
}
