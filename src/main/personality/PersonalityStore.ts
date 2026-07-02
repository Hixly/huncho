import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const MAX_LEARNED_RULES = 15;

interface PersonalityFile {
  learnedRules: string[];
  updatedAt: string;
}

/** Detect when Hix is correcting Huncho's behavior and persist as a learned rule. */
const FEEDBACK_EXTRACTORS: Array<{ test: RegExp; rule: (match: RegExpMatchArray, text: string) => string | null }> = [
  {
    test: /\b(?:no|don't|do not|stop|never|quit)\s+(?:use|using)?\s*emojis?\b/i,
    rule: () => 'Never use emojis in any response.',
  },
  {
    test: /\b(?:no|don't|stop|never)\s+(?:read|say|speak|mention)\s+(?:the\s+)?(?:coordinates|coords|pixel|numbers)\b/i,
    rule: () => 'Never speak pixel coordinates, @x,y values, or element numbers aloud.',
  },
  {
    test: /\b(?:too\s+long|long[\-\s]?winded|shorter|be\s+briefer|keep\s+it\s+short)\b/i,
    rule: () => 'Keep every reply as short as possible — one sentence when feasible.',
  },
  {
    test: /\b(?:stop|don't|never)\s+(?:saying|say)\s+["']?(.+?)["']?\s*$/i,
    rule: (m) => {
      const phrase = m[1]?.trim().slice(0, 80);
      return phrase ? `Never say "${phrase}" or similar filler phrases.` : null;
    },
  },
  {
    test: /\b(?:remember|prefer|always|from now on)\s+(.+)/i,
    rule: (m) => {
      const pref = m[1]?.trim().slice(0, 120);
      return pref ? `Preference: ${pref}` : null;
    },
  },
];

export class PersonalityStore {
  private filePath: string;
  private personalityMdPath: string;
  private learnedRules: string[] = [];

  constructor() {
    const userDataDir = app.getPath('userData');
    this.filePath = path.join(userDataDir, 'huncho-personality.json');
    this.personalityMdPath = path.join(__dirname, '../../assets/personality/huncho-personality.md');
  }

  load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as PersonalityFile;
        if (Array.isArray(raw.learnedRules)) {
          this.learnedRules = raw.learnedRules.slice(-MAX_LEARNED_RULES);
        }
      }
    } catch (err) {
      console.warn('[PersonalityStore] Failed to load learned rules:', err);
      this.learnedRules = [];
    }
    console.log(`[PersonalityStore] Loaded ${this.learnedRules.length} learned rule(s)`);
  }

  getLearnedRules(): string[] {
    return [...this.learnedRules];
  }

  /** Load the static personality markdown shipped with the app. */
  getPersonalityMarkdown(): string {
    try {
      if (fs.existsSync(this.personalityMdPath)) {
        return fs.readFileSync(this.personalityMdPath, 'utf-8');
      }
    } catch (err) {
      console.warn('[PersonalityStore] Failed to read personality file:', err);
    }
    return 'You are Huncho. Be concise, calm, and never use emojis or speak coordinates aloud.';
  }

  /** If the user message looks like feedback, store a rule and return true. */
  tryLearnFromUserMessage(transcript: string): boolean {
    const text = transcript.trim();
    if (text.length < 8) return false;

    for (const { test, rule } of FEEDBACK_EXTRACTORS) {
      const match = text.match(test);
      if (!match) continue;
      const extracted = rule(match, text);
      if (extracted && this.addRule(extracted)) {
        console.log(`[PersonalityStore] Learned: ${extracted}`);
        return true;
      }
    }
    return false;
  }

  private addRule(rule: string): boolean {
    const normalized = rule.trim();
    if (!normalized) return false;
    if (this.learnedRules.some((r) => r.toLowerCase() === normalized.toLowerCase())) {
      return false;
    }
    this.learnedRules.push(normalized);
    if (this.learnedRules.length > MAX_LEARNED_RULES) {
      this.learnedRules = this.learnedRules.slice(-MAX_LEARNED_RULES);
    }
    this.save();
    return true;
  }

  private save(): void {
    try {
      const payload: PersonalityFile = {
        learnedRules: this.learnedRules,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PersonalityStore] Failed to save:', err);
    }
  }
}
