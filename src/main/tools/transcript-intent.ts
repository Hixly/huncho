/** True when the user clearly asked for a chained multi-step browser task. */
export function transcriptImpliesMultiStep(transcript: string): boolean {
  const t = transcript.toLowerCase();
  if (/\b(then|and then|after that|afterwards)\b/.test(t)) return true;
  if (/\bscroll\b/.test(t) && /\b(click|open|tap|press|select|find)\b/.test(t)) return true;
  if (/\b(search|google|look up)\b/.test(t) && /\b(click|open|go to)\b/.test(t)) return true;
  if (/\b(go to|open|visit)\b/.test(t) && /\b(and|then)\b/.test(t)) return true;
  return (t.match(/\band\b/g) ?? []).length >= 2;
}

/** Collapse agent-loop lines into one panel-friendly reply. */
export function formatPanelReply(aggregated: string, multiStep: boolean): string {
  const lines = aggregated.split('\n\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  if (!multiStep) return lines[lines.length - 1];
  return lines.join(' · ');
}
