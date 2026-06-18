import { EventEmitter } from 'events';
import { DUXY_CONFIG } from './config';
import { NAVIGATE_TOOL } from './tools/navigate-tool';
import { DOM_TOOLS } from './tools/dom-agent';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; source?: any }>;
}

export interface ScreenshotInfo {
  base64: string;
  label: string;
  displayIndex: number;
  capturedWidth: number;
  capturedHeight: number;
  screenWidth: number;
  screenHeight: number;
}

export interface ClaudeRequestOptions {
  transcript: string;
  screenshotBase64List: ScreenshotInfo[];
  conversationHistory: ConversationMessage[];
  model: string;
  windowContext?: { app: string; title: string };
  briefMode?: boolean;
}

export interface CursorPointEvent {
  x: number;
  y: number;
  label: string;
  displayIndex: number;
}

export interface ToolUseEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Regex to find [POINT:x,y:description:screenN] tags
const POINT_TAG_REGEX = /\[POINT:(\d+),(\d+):([^:]+):screen(\d+)\]/g;

export class ClaudeAPIClient extends EventEmitter {
  private currentAbortController: AbortController | null = null;

  async sendMessage(options: ClaudeRequestOptions): Promise<{ fullText: string; durationMs: number }> {
    // Cancel any previous in-flight request
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }

    this.currentAbortController = new AbortController();
    const startTime = Date.now();

    // Build the user message content array with screenshots + text
    const userContent: Array<any> = [];

    // Add each screenshot as an image block
    for (const screen of options.screenshotBase64List) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: screen.base64,
        },
      });
      userContent.push({
        type: 'text',
        text: `[Screenshot: ${screen.label} | image size: ${screen.capturedWidth}×${screen.capturedHeight}px | use these image pixel coords for POINT tags]`,
      });
    }

    // Prepend active window context if available
    if (options.windowContext?.app) {
      const ctx = options.windowContext;
      const contextLine = ctx.title
        ? `[Active window: ${ctx.app} — "${ctx.title}"]`
        : `[Active window: ${ctx.app}]`;
      userContent.push({ type: 'text', text: contextLine });
    }

    // Add the transcript
    userContent.push({
      type: 'text',
      text: options.transcript,
    });

    // Build the messages array with history
    const messages: ConversationMessage[] = [
      ...options.conversationHistory,
      {
        role: 'user',
        content: userContent,
      },
    ];

    const systemPrompt = options.briefMode
      ? DUXY_CONFIG.systemPrompt + '\n\nBRIEF MODE: Keep ALL responses to 1-2 sentences maximum. Be direct and concise. No elaboration unless the user specifically asks for it.'
      : DUXY_CONFIG.systemPrompt;

    const requestBody = {
      model: options.model,
      max_tokens: 1024,
      stream: true,
      system: systemPrompt,
      messages,
      tools: [NAVIGATE_TOOL, ...DOM_TOOLS],
    };

    this._firedTags.clear(); // reset per-message
    this._currentToolUse = null; // reset per-message tool-use accumulator
    console.log(`[ClaudeAPIClient] Sending request with model ${options.model}, ${options.screenshotBase64List.length} screenshot(s)`);

    const response = await fetch(`${DUXY_CONFIG.workerBaseURL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal: this.currentAbortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`[ClaudeAPIClient] API error ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error('[ClaudeAPIClient] No response body for streaming');
    }

    let fullText = '';
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
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (
              event.type === 'content_block_delta' &&
              event.delta?.type === 'text_delta' &&
              event.delta?.text
            ) {
              const chunk: string = event.delta.text;
              fullText += chunk;

              // Check for cursor point tags in the accumulated text
              this.processCursorTags(fullText);

              this.emit('textChunk', { chunk, accumulated: fullText.replace(/\[POINT:\d+,\d+:[^:]+:screen\d+\]/g, '').trimEnd() });
            } else if (
              event.type === 'content_block_start' &&
              event.content_block?.type === 'tool_use'
            ) {
              // A tool_use content block has begun — capture id + name; the input JSON
              // will arrive as input_json_delta events that we accumulate below.
              this._currentToolUse = {
                id: event.content_block.id,
                name: event.content_block.name,
                inputBuf: '',
              };
              console.log(`[ClaudeAPIClient] tool_use start: ${event.content_block.name} (id=${event.content_block.id})`);
            } else if (
              event.type === 'content_block_delta' &&
              event.delta?.type === 'input_json_delta' &&
              this._currentToolUse
            ) {
              // Anthropic streams the tool input as JSON fragments
              this._currentToolUse.inputBuf += event.delta.partial_json ?? '';
            } else if (
              event.type === 'content_block_stop' &&
              this._currentToolUse
            ) {
              // Tool block complete — parse the buffered JSON and emit
              const tu = this._currentToolUse;
              this._currentToolUse = null;
              let parsedInput: Record<string, unknown> = {};
              try {
                parsedInput = tu.inputBuf ? JSON.parse(tu.inputBuf) : {};
              } catch (parseErr) {
                console.warn(`[ClaudeAPIClient] Failed to parse tool input JSON: ${tu.inputBuf}`, parseErr);
              }
              const toolEvent: ToolUseEvent = { id: tu.id, name: tu.name, input: parsedInput };
              console.log(`[ClaudeAPIClient] tool_use complete: ${tu.name}(${JSON.stringify(parsedInput)})`);
              this.emit('toolUse', toolEvent);
            } else if (event.type === 'message_stop') {
              console.log('[ClaudeAPIClient] Stream complete');
            }
          } catch (e) {
            // Ignore malformed SSE lines
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[ClaudeAPIClient] Response complete: ${fullText.length} chars in ${durationMs}ms`);

    // Strip point tags from the text before returning (for TTS)
    const cleanText = fullText.replace(POINT_TAG_REGEX, '').trim();

    this.currentAbortController = null;
    return { fullText: cleanText, durationMs };
  }

  // Track already-fired tags so we don't double-emit when scanning full text each chunk
  private _firedTags = new Set<string>();
  private _currentToolUse: { id: string; name: string; inputBuf: string } | null = null;

  private processCursorTags(fullText: string): void {
    // Always scan full accumulated text — avoids missing tags split across chunks
    const regex = /\[POINT:(\d+),(\d+):([^:]+):screen(\d+)\]/g;
    let match;

    while ((match = regex.exec(fullText)) !== null) {
      const key = `${match.index}:${match[0]}`;
      if (this._firedTags.has(key)) continue; // already emitted
      this._firedTags.add(key);

      const event: CursorPointEvent = {
        x: parseInt(match[1], 10),
        y: parseInt(match[2], 10),
        label: match[3],
        displayIndex: parseInt(match[4], 10),
      };
      console.log(`[ClaudeAPIClient] Cursor point: screen${event.displayIndex} (${event.x}, ${event.y}) — ${event.label}`);
      this.emit('cursorPoint', event);
    }
  }

  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this._firedTags.clear();
    this._currentToolUse = null;
  }
}

