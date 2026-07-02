import { describe, it, expect } from 'vitest';
import { formatPanelReply, transcriptImpliesMultiStep } from '../../main/tools/transcript-intent';

describe('transcriptImpliesMultiStep', () => {
  it('detects chained scroll then click', () => {
    expect(transcriptImpliesMultiStep('Scroll down and click the CBS link')).toBe(true);
  });

  it('treats single click as one step', () => {
    expect(transcriptImpliesMultiStep('Click on Shorts for me')).toBe(false);
  });

  it('treats point-only requests as one step', () => {
    expect(transcriptImpliesMultiStep('Point out the shopping tab')).toBe(false);
  });
});

describe('formatPanelReply', () => {
  it('keeps only the last line for single-step turns', () => {
    const raw = 'Scrolled.\n\nOpening site.\n\nClicking on Shorts now.';
    expect(formatPanelReply(raw, false)).toBe('Clicking on Shorts now.');
  });

  it('joins multi-step lines compactly', () => {
    const raw = 'Opening Google.\n\nSearching now.';
    expect(formatPanelReply(raw, true)).toBe('Opening Google. · Searching now.');
  });
});
