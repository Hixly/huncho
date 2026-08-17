import { EventEmitter } from 'events';
import { NAVIGATE_TOOL } from './tools/navigate-tool';
import { DOM_TOOLS } from './tools/dom-agent';
import {
  ClaudeRequestOptions,
  ConversationMessage,
  CursorPointEvent,
  ToolUseEvent,
} from './ClaudeAPIClient';
import { SettingsStore } from './SettingsStore';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Shown to the user (via the dead-turn/error path) when no key is available.
export const NO_GEMINI_KEY_MESSAGE =
  'No Gemini API key set. Open Settings and paste your key (free at aistudio.google.com/apikey).';

/**
 * Gemini engine for Huncho. Exposes the exact same surface as ClaudeAPIClient
 * (sendMessage/cancel + textChunk/toolUse/cursorPoint events) so
 * CompanionManager can hot-swap engines based on the selected model.
 *
 * Calls the Gemini REST API directly with GEMINI_API_KEY from the environment
 * (loaded from huncho/.env at boot) — no proxy worker in between.
 */
export class GeminiAPIClient extends EventEmitter {
  private currentAbortController: AbortController | null = null;
  private _firedTags = new Set<string>();
  private _toolCallCounter = 0;
  private _emptyRetry = false;
  private settings: SettingsStore | null;

  /**
   * @param settings Injected SettingsStore (the user's bring-your-own Gemini
   *   key lives there). Optional so the class stays testable; when omitted the
   *   client resolves the key from the environment only.
   */
  constructor(settings?: SettingsStore) {
    super();
    this.settings = settings ?? null;
  }

  /**
   * Resolve the Gemini key: user-provided SettingsStore value first, then the
   * GEMINI_API_KEY env var (dev fallback). Throws a clear, user-facing error
   * when neither is present — the message is surfaced to the user via the
   * pipeline's dead-turn/error path.
   */
  private resolveApiKey(): string {
    const fromSettings = this.settings?.getGeminiKey() ?? null;
    const key = fromSettings ?? process.env.GEMINI_API_KEY ?? '';
    if (!key.trim()) throw new Error(NO_GEMINI_KEY_MESSAGE);
    return key.trim();
  }

  async sendMessage(options: ClaudeRequestOptions): Promise<{ fullText: string; durationMs: number }> {
    const apiKey = this.resolveApiKey();

    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    this.currentAbortController = new AbortController();
    const startTime = Date.now();

    // ── Build request ────────────────────────────────────────────────────
    const contents: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

    for (const msg of options.conversationHistory) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: historyText(msg) }],
      });
    }

    const userParts: any[] = [];
    for (const screen of options.screenshotBase64List) {
      userParts.push({
        inline_data: { mime_type: 'image/jpeg', data: screen.base64 },
      });
      userParts.push({
        text: `[Screenshot: ${screen.label} | tag with screen${screen.displayIndex} | image size: ${screen.capturedWidth}×${screen.capturedHeight}px | use these image pixel coords for POINT tags on THIS screenshot]`,
      });
    }
    if (options.windowContext?.app) {
      const ctx = options.windowContext;
      userParts.push({
        text: ctx.title ? `[Active window: ${ctx.app} — "${ctx.title}"]` : `[Active window: ${ctx.app}]`,
      });
    }
    userParts.push({ text: options.transcript });
    contents.push({ role: 'user', parts: userParts });

    // System prompt arrives pre-built (personality + brief mode already applied)
    const systemPrompt = options.systemPrompt;

    // Anthropic tool schema → Gemini functionDeclarations. Gemini rejects an
    // empty properties object, so tools with no inputs omit `parameters`.
    const functionDeclarations = [NAVIGATE_TOOL, ...DOM_TOOLS].map((t: any) => {
      const decl: any = { name: t.name, description: t.description };
      const schema = t.input_schema;
      if (schema && schema.properties && Object.keys(schema.properties).length > 0) {
        decl.parameters = schema;
      }
      return decl;
    });

    const model = options.model.startsWith('gemini') ? options.model : 'gemini-flash-latest';
    const requestBody = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ function_declarations: functionDeclarations }],
      generationConfig: { maxOutputTokens: 1024 },
    };

    this._firedTags.clear();
    console.log(`[GeminiAPIClient] Sending request with model ${model}, ${options.screenshotBase64List.length} screenshot(s)`);

    // 503 UNAVAILABLE ("high demand") is common on the -latest aliases when
    // Google ships a new model. Retry with backoff, then fall back to the
    // previous-generation stable model, which is far less contended.
    const fallbackModel = model.includes('pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const attempts = [model, model, ...(fallbackModel !== model ? [fallbackModel] : [])];
    let response: Response | null = null;
    let lastStatus = 0;
    let lastErrText = '';

    // Per-attempt first-byte timeout: an overloaded model can accept the
    // request then crawl (observed: 102s to first token). If headers haven't
    // arrived in 25s, abort the attempt and move to the fallback model.
    const FIRST_BYTE_TIMEOUT_MS = 25000;

    for (let i = 0; i < attempts.length; i++) {
      const attemptModel = attempts[i];
      // Dedicated controller per attempt: the timeout is cleared the moment
      // headers arrive, so it can never abort a healthy long-running stream.
      // User interrupts (Ctrl+H) forward into it for the request's lifetime.
      const attemptController = new AbortController();
      const forwardUserAbort = () => attemptController.abort();
      this.currentAbortController.signal.addEventListener('abort', forwardUserAbort, { once: true });
      const firstByteTimer = setTimeout(() => attemptController.abort(), FIRST_BYTE_TIMEOUT_MS);
      try {
        response = await fetch(
          `${GEMINI_BASE}/models/${attemptModel}:streamGenerateContent?alt=sse&key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: attemptController.signal,
          },
        );
      } catch (err: any) {
        // User interrupt (Ctrl+H) → propagate. Slow-model timeout → next attempt.
        if (this.currentAbortController?.signal.aborted) throw err;
        lastStatus = 408;
        lastErrText = `first byte took >${FIRST_BYTE_TIMEOUT_MS}ms on ${attemptModel}`;
        response = null;
        console.warn(`[GeminiAPIClient] ${attemptModel} timed out waiting for first byte — trying next`);
        continue;
      } finally {
        clearTimeout(firstByteTimer);
      }
      if (response.ok) {
        if (attemptModel !== model) console.log(`[GeminiAPIClient] ${model} overloaded — fell back to ${attemptModel}`);
        break;
      }
      lastStatus = response.status;
      lastErrText = await response.text();
      response = null;
      // Only overload/rate-limit statuses are worth retrying
      if (lastStatus !== 503 && lastStatus !== 429) break;
      if (i < attempts.length - 1) {
        console.warn(`[GeminiAPIClient] ${attemptModel} returned ${lastStatus} — retrying (${i + 1}/${attempts.length - 1})`);
        await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
    }

    if (!response) {
      throw new Error(`[GeminiAPIClient] API error ${lastStatus}: ${lastErrText.slice(0, 500)}`);
    }
    if (!response.body) {
      throw new Error('[GeminiAPIClient] No response body for streaming');
    }

    // ── Stream ───────────────────────────────────────────────────────────
    let fullText = '';
    let sawToolCall = false;
    let finishReason = '';
    let blockReason = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          continue; // malformed SSE line
        }

        if (event?.candidates?.[0]?.finishReason) finishReason = event.candidates[0].finishReason;
        if (event?.promptFeedback?.blockReason) blockReason = event.promptFeedback.blockReason;

        const parts = event?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) continue;

        for (const part of parts) {
          if (typeof part.text === 'string' && part.text) {
            fullText += part.text;
            this.processCursorTags(fullText);
            this.emit('textChunk', {
              chunk: part.text,
              accumulated: fullText
                .replace(/\[POINT:[^\]]*\]/g, '')
                .replace(/\[POINT:[^\]]*$/, '')
                .trimEnd(),
            });
          } else if (part.functionCall && part.functionCall.name) {
            sawToolCall = true;
            const toolEvent: ToolUseEvent = {
              id: `gemini-fc-${++this._toolCallCounter}`,
              name: part.functionCall.name,
              input: part.functionCall.args ?? {},
            };
            console.log(`[GeminiAPIClient] functionCall: ${toolEvent.name}(${JSON.stringify(toolEvent.input)})`);
            this.emit('toolUse', toolEvent);
          }
        }
      }
    }

    // Gemini 2.5 occasionally returns a completely empty candidate (often
    // finishReason=MALFORMED_FUNCTION_CALL or a safety block) — no text, no
    // tool call. Without a retry the turn dies silently and Huncho looks
    // frozen. Retry the whole request once before giving up.
    if (!fullText.trim() && !sawToolCall && !this.currentAbortController?.signal.aborted) {
      console.warn(
        `[GeminiAPIClient] EMPTY response (finishReason=${finishReason || 'none'}, blockReason=${blockReason || 'none'})` +
        (this._emptyRetry ? ' — already retried, giving up' : ' — retrying once'),
      );
      if (!this._emptyRetry) {
        this._emptyRetry = true;
        try {
          return await this.sendMessage(options);
        } finally {
          this._emptyRetry = false;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[GeminiAPIClient] Response complete: ${fullText.length} chars in ${durationMs}ms`);

    const cleanText = fullText.replace(/\[POINT:[^\]]*\]/g, '').trim();
    this.currentAbortController = null;
    return { fullText: cleanText, durationMs };
  }

  // Same lenient POINT parsing as ClaudeAPIClient — sloppy tags still fly via
  // label-snap; URL-ish segments are excluded from labels.
  private processCursorTags(fullText: string): void {
    const regex = /\[POINT:([^\]]*)\]/g;
    let match;

    while ((match = regex.exec(fullText)) !== null) {
      const key = `${match.index}:${match[0]}`;
      if (this._firedTags.has(key)) continue;
      this._firedTags.add(key);

      const body = match[1];
      const coordMatch = body.match(/(\d+)\s*,\s*(\d+)/);
      const screenMatch = body.match(/screen\s*(\d+)/i);
      const label = body
        .split(':')
        .map((s) => s.trim())
        .filter((s) =>
          s.length > 0 &&
          !/^\d+\s*,\s*\d+$/.test(s) &&
          !/^\d+$/.test(s) &&
          !/^screen\s*\d+$/i.test(s) &&
          !/^https?$/i.test(s) &&
          !/^\/\//.test(s) &&
          !/\.\w{2,}/.test(s.replace(/\s/g, ''))
        )
        .join(' ')
        .trim();

      if (!label && !coordMatch) continue;

      const event: CursorPointEvent = {
        x: coordMatch ? parseInt(coordMatch[1], 10) : 0,
        y: coordMatch ? parseInt(coordMatch[2], 10) : 0,
        label: label || 'here',
        displayIndex: screenMatch ? parseInt(screenMatch[1], 10) : 99,
      };
      console.log(`[GeminiAPIClient] Cursor point (lenient): screen${event.displayIndex} (${event.x}, ${event.y}) — "${event.label}"`);
      this.emit('cursorPoint', event);
    }
  }

  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this._firedTags.clear();
  }

  /**
   * Lightweight, non-streaming, tool-free text completion. Used by the memory
   * layer for a cheap extraction call (returns raw model text). Deliberately
   * isolated from sendMessage: no tools, no POINT parsing, no event emission,
   * and its own abort controller so it never interferes with a live voice turn.
   * Throws on any failure — callers are expected to catch (fire-and-forget).
   */
  async generateText(
    prompt: string,
    opts: { model?: string; maxOutputTokens?: number } = {},
  ): Promise<string> {
    const apiKey = this.resolveApiKey();

    const model = opts.model ?? 'gemini-2.5-flash';
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: opts.maxOutputTokens ?? 256, temperature: 0 },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(
        `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`[GeminiAPIClient] generateText error ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      const data = (await response.json()) as any;
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return '';
      return parts.map((p: any) => (typeof p.text === 'string' ? p.text : '')).join('');
    } finally {
      clearTimeout(timer);
    }
  }
}

function historyText(msg: ConversationMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .map((block) => (block.type === 'text' && block.text ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}
