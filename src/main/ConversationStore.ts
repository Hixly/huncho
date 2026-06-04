import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const MAX_MESSAGES = 200; // 100 exchanges on disk

export class ConversationStore {
  private filePath: string;
  private messages: StoredMessage[] = [];

  constructor() {
    const userDataDir = app.getPath('userData');
    this.filePath = path.join(userDataDir, 'conversation-history.json');
  }

  load(): StoredMessage[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.messages = parsed.slice(-MAX_MESSAGES);
        }
      }
    } catch (err) {
      console.error('[ConversationStore] Failed to load history:', err);
      this.messages = [];
    }
    console.log(`[ConversationStore] Loaded ${this.messages.length} messages from disk`);
    return this.messages;
  }

  addMessage(role: 'user' | 'assistant', text: string): StoredMessage {
    const msg: StoredMessage = { role, text, timestamp: Date.now() };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    this.save();
    return msg;
  }

  getMessages(): StoredMessage[] {
    return this.messages;
  }

  // Returns last N pairs in Claude API message format (text only, no images)
  toClaudeHistory(maxPairs: number): Array<{ role: 'user' | 'assistant'; content: string }> {
    const maxEntries = maxPairs * 2;
    return this.messages
      .slice(-maxEntries)
      .map(m => ({ role: m.role, content: m.text }));
  }

  clear(): void {
    this.messages = [];
    this.save();
    console.log('[ConversationStore] History cleared');
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.messages, null, 2), 'utf-8');
    } catch (err) {
      console.error('[ConversationStore] Failed to save history:', err);
    }
  }
}
