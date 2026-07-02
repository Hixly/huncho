/** Build label queries for fuzzy element-map matching (newest / most specific first). */
export function buildClickLabelQueries(
  reason: string,
  mapEntryText: string,
  userTranscript: string,
): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (t.length >= 4 && !out.includes(t)) out.push(t);
  };

  add(reason);
  add(mapEntryText);

  const clickTail = userTranscript.match(/click(?:\s+on)?\s+(?:the\s+)?(.+)/i);
  if (clickTail?.[1]) {
    add(clickTail[1].replace(/[.!?]+$/, '').trim());
  }

  // Long descriptive requests — use the full transcript as a last-resort hint.
  if (userTranscript.length >= 12) add(userTranscript);

  return out;
}
