import { DUXY_CONFIG } from '../config';

export function buildHunchoSystemPrompt(opts: {
  personalityMarkdown: string;
  learnedRules: string[];
  briefMode: boolean;
}): string {
  const learned =
    opts.learnedRules.length > 0
      ? `\n\nLEARNED PREFERENCES (from Hix — permanent until cleared):\n${opts.learnedRules.map((r) => `- ${r}`).join('\n')}`
      : '';

  const brief = opts.briefMode ? DUXY_CONFIG.briefModeAppendix : '';

  return `${opts.personalityMarkdown}\n\n---\n\n${DUXY_CONFIG.systemPrompt}${learned}${brief}`;
}
