import { ipcMain, BrowserWindow, screen, app } from 'electron';
import { IPC, VoiceState, RequestModelChangePayload } from '../shared/ipc-types';
import { DUXY_CONFIG } from './config';
import { GlobalHotkeyMonitor } from './GlobalHotkeyMonitor';
import { ScreenCaptureManager, ScreenshotInfo } from './ScreenCaptureManager';
import { AudioRecorder } from './AudioRecorder';
import { ClaudeAPIClient, ConversationMessage, CursorPointEvent } from './ClaudeAPIClient';
import { ElevenLabsTTSClient } from './ElevenLabsTTSClient';
import { EdgeTTSClient } from './EdgeTTSClient';
import { OverlayManager } from './OverlayManager';
import { TrayManager } from './TrayManager';
import { ConversationStore } from './ConversationStore';
import { captureActiveWindow, WindowContext } from './WindowContextManager';
import { BrowserSurface } from './BrowserSurface';
import { isDangerousAction, DomToolResult } from './tools/dom-agent';

export class CompanionManager {
  private state: VoiceState = 'idle';
  private currentModel: string = DUXY_CONFIG.defaultModel;
  private briefMode = false;
  private conversationHistory: ConversationMessage[] = [];
  private lastTranscript = '';

  private hotkeyMonitor: GlobalHotkeyMonitor;
  private screenCapture: ScreenCaptureManager;
  private audioRecorder: AudioRecorder;
  private claudeClient: ClaudeAPIClient;
  private ttsClient: ElevenLabsTTSClient;
  private edgeTTS: EdgeTTSClient;
  private overlayManager: OverlayManager;
  private trayManager: TrayManager;
  private conversationStore: ConversationStore;

  private browser: BrowserSurface | null = null;

  // Phase 1C — Eyes + Hands. Pending action that needs verbal confirmation
  // before Huncho will execute it (Buy, Delete, Send, etc.). Cleared on the
  // next transcript when the user says yes/no.
  private pendingConfirmation: null | {
    tool: 'click' | 'type_text';
    n: number;
    text?: string;
    submit?: boolean;
    elementText: string;
    reason: string;
  } = null;

  // Most recent DOM tool result — injected into the next user message so Claude
  // can chain a follow-up action without needing to re-call read_page.
  private lastDomResult: null | { tool: string; result: DomToolResult } = null;

  // In-flight tool dispatch promises for the current turn. The agent loop in
  // runPipeline awaits these before checking lastDomResult to decide whether
  // to continue (so the loop sees a tool fired even if dispatchTool is slow).
  private inFlightDispatches: Promise<void>[] = [];

  // Text accumulated across all agent-loop iterations for the current turn —
  // used to keep the panel's streaming chat display continuous instead of
  // resetting on each Claude follow-up call.
  private aggregatedResponseText = '';

  private pendingPipelineAbort = false;
  private transcriptTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private cursorTrackingInterval: ReturnType<typeof setInterval> | null = null;
  // Heartbeat that re-promotes the diamond overlay above the full-screen
  // browser window. Page loads + click handling on Windows can sneak the
  // browser BaseWindow above the screen-saver overlay even with always-on-top;
  // this pings every 1500ms while Huncho is non-idle to snap it back.
  private overlayHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastWindowContext: WindowContext = { app: '', title: '' };

  // Screenshot state: captured at PTT press, used in pipeline
  private lastScreenshots: ScreenshotInfo[] = [];

  // Streaming TTS state
  private ttsStreamPos = 0;
  private ttsChunkQueue: string[] = [];
  private ttsAllQueued = false;
  private ttsProcessorPromise: Promise<void> | null = null;

  constructor(
    hotkeyMonitor: GlobalHotkeyMonitor,
    overlayManager: OverlayManager,
    trayManager: TrayManager
  ) {
    this.hotkeyMonitor = hotkeyMonitor;
    this.overlayManager = overlayManager;
    this.trayManager = trayManager;

    this.screenCapture = new ScreenCaptureManager();
    this.audioRecorder = new AudioRecorder();
    this.claudeClient = new ClaudeAPIClient();
    this.ttsClient = new ElevenLabsTTSClient();
    this.edgeTTS = new EdgeTTSClient();
    this.conversationStore = new ConversationStore();
  }

  async initialize(): Promise<void> {
    // Load persisted conversation history
    this.conversationStore.load();
    this.conversationHistory = this.conversationStore.toClaudeHistory(DUXY_CONFIG.maxConversationHistory);
    console.log(`[CompanionManager] Restored ${this.conversationHistory.length} messages into Claude context`);

    // IPC: panel requests full chat history on mount
    ipcMain.on(IPC.REQUEST_CHAT_HISTORY, (event) => {
      event.reply(IPC.CHAT_HISTORY, { messages: this.conversationStore.getMessages() });
    });

    // IPC: clear all history and reset context
    ipcMain.on(IPC.CLEAR_HISTORY, () => {
      this.conversationStore.clear();
      this.conversationHistory = [];
      this.broadcastToAll(IPC.CLEAR_HISTORY);
      console.log('[CompanionManager] History cleared');
    });

    // Wire up Web Speech API transcript callback from AudioRecorder
    this.audioRecorder.setTranscriptReadyCallback(async (transcript: string) => {
      console.log(`[CompanionManager] Transcript received from renderer: "${transcript}"`);
      this.broadcastToAll(IPC.TRANSCRIPT_UPDATE, { transcript, isFinal: true });
      if (this.state !== 'listening' && this.state !== 'processing') return;
      // If a dangerous-action confirmation is pending, intercept yes/no here
      // before running the normal LLM pipeline.
      if (this.pendingConfirmation) {
        const handled = await this.handlePendingConfirmation(transcript);
        if (handled) {
          this.setState('responding');
          return;
        }
      }
      this.runPipeline(transcript);
    });

    // Wire up Claude streaming events. For agent-loop iterations 2+, we
    // present the panel with the AGGREGATED text (prev iters + this iter) so
    // the chat display stays continuous rather than resetting per iter.
    this.claudeClient.on('textChunk', ({ chunk, accumulated }: { chunk: string; accumulated: string }) => {
      const display = this.aggregatedResponseText
        ? this.aggregatedResponseText + '\n\n' + accumulated
        : accumulated;
      this.broadcastToAll(IPC.RESPONSE_CHUNK, { text: chunk, accumulated: display });
      // Stream TTS detects sentence boundaries on THIS iter's accumulated.
      this.pushTTSSentences(accumulated);
    });

    // Scale POINT coordinates from screenshot space → actual screen space
    this.claudeClient.on('cursorPoint', (event: CursorPointEvent) => {
      const screenInfo = this.lastScreenshots.find(s => s.displayIndex === event.displayIndex);
      let x = event.x;
      let y = event.y;

      if (screenInfo && screenInfo.capturedWidth > 0 && screenInfo.capturedHeight > 0) {
        x = Math.round(event.x * (screenInfo.screenWidth / screenInfo.capturedWidth));
        y = Math.round(event.y * (screenInfo.screenHeight / screenInfo.capturedHeight));
        console.log(`[CompanionManager] POINT scaled: (${event.x},${event.y}) → (${x},${y}) [${screenInfo.capturedWidth}×${screenInfo.capturedHeight} → ${screenInfo.screenWidth}×${screenInfo.screenHeight}]`);
      }

      this.overlayManager.forwardCursorPointAt({ x, y, label: event.label, displayIndex: event.displayIndex });
    });

    this.claudeClient.on('toolUse', (event: { id: string; name: string; input: Record<string, unknown> }) => {
      const p = this.dispatchTool(event).catch((err) => {
        console.error(`[CompanionManager] Tool dispatch error (${event.name}):`, err);
      });
      this.inFlightDispatches.push(p);
    });

    // Wire up hotkey monitor
    this.hotkeyMonitor.on('pttPress', () => this.handlePttPress());
    this.hotkeyMonitor.on('pttRelease', () => this.handlePttRelease());

    // IPC: power level forwarding from renderer to all windows (waveform display)
    ipcMain.on(IPC.AUDIO_POWER_LEVEL, (_event, payload) => {
      this.broadcastToAll(IPC.AUDIO_POWER_LEVEL, payload);
    });

    // IPC: model change request from renderer
    ipcMain.on(IPC.REQUEST_MODEL_CHANGE, (_event, payload: RequestModelChangePayload) => {
      this.currentModel = payload.model;
      this.broadcastToAll(IPC.MODEL_CHANGED, { model: this.currentModel });
      console.log(`[CompanionManager] Model changed to: ${this.currentModel}`);
    });

    // IPC: brief mode toggle from panel
    ipcMain.on(IPC.TOGGLE_BRIEF_MODE, () => {
      this.briefMode = !this.briefMode;
      this.broadcastToAll(IPC.BRIEF_MODE_CHANGED, { briefMode: this.briefMode });
      console.log(`[CompanionManager] Brief mode: ${this.briefMode ? 'ON' : 'OFF'}`);
    });

    // Forward TTS complete from panel → overlay, and transition to idle now that
    // all audio has finished playing in the renderer. Keeping state = 'responding'
    // until here (rather than when chunks were sent) ensures Alt+D during playback
    // always hits the interrupt block, never starts a spurious new listening session.
    ipcMain.on(IPC.TTS_COMPLETE, () => {
      this.overlayManager.broadcastToAll(IPC.TTS_COMPLETE);
      if (this.state === 'responding') {
        this.setState('idle');
        this.trayManager.doneRecording();
      }
    });

    // IPC: hide panel + duck (X button)
    ipcMain.on(IPC.HIDE_PANEL, () => {
      this.trayManager.hidePanel();
    });

    // IPC: minimize panel only — duck stays visible
    ipcMain.on(IPC.MINIMIZE_PANEL, () => {
      this.trayManager.minimizePanel();
    });

    // IPC: quit (tray right-click → Quit Huncho)
    ipcMain.on(IPC.QUIT, () => {
      app.quit();
      setTimeout(() => process.exit(0), 1000);
    });

    // Initialize Edge TTS (free Microsoft neural voices)
    await this.edgeTTS.initialize();

    // Link overlay visibility to panel visibility
    this.trayManager.setOverlayManager(this.overlayManager);

    // Start cursor tracking
    this.startCursorTracking();

    console.log('[CompanionManager] Initialized');
  }

  private startCursorTracking(): void {
    if (this.cursorTrackingInterval) return;
    const displays = screen.getAllDisplays();
    let lastDuckVisible = true;
    let lastCursorOnPage = false;
    let lastCursorOnPagePushAt = 0;
    const URLBAR_HEIGHT = 36;
    this.cursorTrackingInterval = setInterval(() => {
      const point = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(point);
      const displayIndex = displays.findIndex((d) => d.id === display.id);
      this.overlayManager.sendCursorPosition({
        x: point.x - display.bounds.x,
        y: point.y - display.bounds.y,
        displayIndex: displayIndex >= 0 ? displayIndex : 0,
      });

      // Decide whether the desktop overlay duck should be visible. It should
      // hide ONLY when the cursor is over the browser content area (below the
      // URL bar) — the browser has its own in-page diamond there. Anywhere
      // else (panel, taskbar, tray, other monitors), the desktop duck shows.
      const primary = screen.getPrimaryDisplay();
      const wa = primary.workArea;
      const overPanel = (() => {
        const panel = this.trayManager.getPanelWindow();
        if (!panel || panel.isDestroyed() || !panel.isVisible()) return false;
        const b = panel.getBounds();
        return point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height;
      })();
      const overBrowser = !overPanel
        && point.x >= wa.x && point.x <= wa.x + wa.width
        && point.y >= wa.y + URLBAR_HEIGHT && point.y <= wa.y + wa.height;
      const duckVisible = !overBrowser;
      if (duckVisible !== lastDuckVisible) {
        lastDuckVisible = duckVisible;
        this.overlayManager.broadcastToAll(IPC.DUCK_VISIBLE, { visible: duckVisible });
      }
      // Push the in-page diamond visibility on every state flip AND at least
      // once per second as a safety re-assertion (cures phantom diamonds
      // that linger after focus shifts across windows).
      const now = Date.now();
      if (this.browser && (overBrowser !== lastCursorOnPage || now - lastCursorOnPagePushAt > 1000)) {
        lastCursorOnPage = overBrowser;
        lastCursorOnPagePushAt = now;
        this.browser.setCursorOnPage(overBrowser);
      }
    }, 33); // ~30fps
  }

  private stopCursorTracking(): void {
    if (this.cursorTrackingInterval) {
      clearInterval(this.cursorTrackingInterval);
      this.cursorTrackingInterval = null;
    }
  }

  private async handlePttPress(): Promise<void> {
    console.log(`[CompanionManager] PTT pressed (current state: ${this.state})`);

    // If Huncho is mid-response, pressing PTT stops it and returns to idle —
    // the user then presses PTT again when ready to ask their next question.
    // This avoids capturing silence/breath as a spurious recording.
    if (this.state === 'processing' || this.state === 'responding') {
      this.pendingPipelineAbort = true;
      this.claudeClient.cancel();
      this.ttsChunkQueue = [];
      const panelWin = this.trayManager.getPanelWindow();
      if (panelWin && !panelWin.isDestroyed()) {
        panelWin.webContents.send(IPC.TTS_STOP);
      }
      this.setState('idle');
      this.trayManager.doneRecording();
      // Reset pttActive so the very next Alt+D starts listening rather than
      // firing a stale pttRelease that silently does nothing.
      this.hotkeyMonitor.resetPttState();
      console.log('[CompanionManager] Response interrupted — press Alt+D to ask a follow-up');
      return;
    }

    this.setState('listening');

    // Capture screenshot and active window immediately (parallel with recording)
    // By the time the user finishes speaking + Groq transcribes, these will be ready
    captureActiveWindow()
      .then((ctx) => { this.lastWindowContext = ctx; })
      .catch(() => { this.lastWindowContext = { app: '', title: '' }; });

    this.screenCapture.captureAllScreensAsBase64()
      .then((screens) => {
        this.lastScreenshots = screens;
        console.log(`[CompanionManager] Screenshots captured during recording: ${screens.length} screen(s)`);
      })
      .catch(() => {
        this.lastScreenshots = [];
      });

    // Show panel off-screen so renderer can access getUserMedia
    this.trayManager.showForRecording();

    try {
      await this.audioRecorder.startRecording();
    } catch (err) {
      console.error('[CompanionManager] Failed to start recording:', err);
      this.setState('idle');
      this.overlayManager.hideAll();
    }
  }

  private async handlePttRelease(): Promise<void> {
    if (this.state !== 'listening') {
      console.warn(`[CompanionManager] PTT released but state is ${this.state}`);
      return;
    }

    console.log('[CompanionManager] PTT released, waiting for speech recognition result...');
    this.pendingPipelineAbort = false;

    await this.audioRecorder.stopRecording();
    this.setState('processing');

    // If no transcript arrives within 15 seconds, return to idle
    if (this.transcriptTimeoutId) clearTimeout(this.transcriptTimeoutId);
    this.transcriptTimeoutId = setTimeout(() => {
      this.transcriptTimeoutId = null;
      if (this.state === 'processing') {
        console.log('[CompanionManager] No transcript received, returning to idle');
        this.setState('idle');
        this.trayManager.doneRecording();
        this.overlayManager.hideAll();
      }
    }, 15000);
  }

  // ── Streaming TTS helpers ──────────────────────────────────────────────────

  private resetTTSStream(): void {
    this.ttsStreamPos = 0;
    this.ttsChunkQueue = [];
    this.ttsAllQueued = false;
    // ttsProcessorPromise drains naturally; pendingPipelineAbort will stop it if needed
  }

  // Called from textChunk handler — enqueue all complete sentences found in the accumulated text
  private pushTTSSentences(accumulated: string): void {
    const newText = accumulated.slice(this.ttsStreamPos);
    if (!newText) return;

    // Find all sentence boundaries (. ! ?) not inside abbreviations
    const regex = /[.!?](?=\s|$)/g;
    let lastEnd = 0;
    let match;

    while ((match = regex.exec(newText)) !== null) {
      const boundaryEnd = match.index + 1;
      const sentence = newText.slice(lastEnd, boundaryEnd).trim();
      if (sentence.length > 3) { // skip tiny fragments like "Ok."
        this.enqueueTTS(sentence);
      }
      // Advance past whitespace after punctuation
      let skip = boundaryEnd;
      while (skip < newText.length && /\s/.test(newText[skip])) skip++;
      lastEnd = skip;
    }

    this.ttsStreamPos += lastEnd;
  }

  private enqueueTTS(text: string): void {
    this.ttsChunkQueue.push(text);
    if (!this.ttsProcessorPromise) {
      this.ttsProcessorPromise = this.runTTSProcessor();
    }
  }

  private async runTTSProcessor(): Promise<void> {
    const panelWin = this.trayManager.getPanelWindow();

    while (this.ttsChunkQueue.length > 0 || !this.ttsAllQueued) {
      if (this.pendingPipelineAbort) {
        this.ttsChunkQueue = [];
        break;
      }

      if (this.ttsChunkQueue.length === 0) {
        // Waiting for more sentences from Claude — poll briefly
        await new Promise<void>((r) => setTimeout(r, 20));
        continue;
      }

      const text = this.ttsChunkQueue.shift()!;

      try {
        const ttsWindows = panelWin && !panelWin.isDestroyed() ? [panelWin] : [];
        await this.edgeTTS.speak(text, ttsWindows);
      } catch (err) {
        console.error('[CompanionManager] TTS chunk error:', err);
        if (panelWin && !panelWin.isDestroyed()) {
          panelWin.webContents.send(IPC.TTS_SPEAK_TEXT, { text });
        }
      }

      // EdgeTTS.speak() sends TTS_PLAY_AUDIO just before returning. If an
      // interrupt arrived while speak() was awaiting the network round-trip,
      // that late TTS_PLAY_AUDIO would restart audio AFTER the TTS_STOP that
      // handlePttPress already sent. Re-send TTS_STOP here to kill it.
      if (this.pendingPipelineAbort) {
        if (panelWin && !panelWin.isDestroyed()) {
          panelWin.webContents.send(IPC.TTS_STOP);
        }
        break;
      }
    }

    this.ttsProcessorPromise = null;

    // Signal renderer all audio chunks have been sent
    if (!this.pendingPipelineAbort) {
      if (panelWin && !panelWin.isDestroyed()) {
        panelWin.webContents.send(IPC.TTS_ALL_SENT);
      }
    }
  }

  // ── Phase 1C: Eyes + Hands tool dispatch ──────────────────────────────────

  /**
   * Execute a tool call from Claude. Most tools fire live during the stream
   * for snappy perceived latency. Dangerous actions (Buy, Delete, Send, etc.)
   * are deferred: Huncho speaks a confirmation prompt and stores the action
   * until the user's next transcript says "yes" or "no".
   */
  private async dispatchTool(event: { id: string; name: string; input: Record<string, unknown> }): Promise<void> {
    if (!this.browser) {
      console.warn(`[CompanionManager] Tool ${event.name} called but no BrowserSurface attached`);
      return;
    }
    const { name, input } = event;

    switch (name) {
      case 'navigate': {
        const url = typeof input.url === 'string' ? input.url : '';
        if (!url) return console.warn('[CompanionManager] navigate called without a url');
        const final = this.browser.navigate(url);
        console.log(`[CompanionManager] tool navigate("${url}") -> ${final ?? 'REJECTED'}`);
        this.lastDomResult = { tool: 'navigate', result: { ok: !!final, url: final ?? null } };
        // Browser nav steals z-order on Windows — re-promote overlay so the diamond stays visible.
        setTimeout(() => this.overlayManager.bringToFront(), 200);
        return;
      }

      case 'click': {
        const n = typeof input.n === 'number' ? input.n : NaN;
        const reason = typeof input.reason === 'string' ? input.reason : '';
        if (!Number.isFinite(n)) return console.warn('[CompanionManager] click called without a valid n');
        const map = await this.browser.getElementMap();
        const target = map.find((e) => e.n === n);
        const elementText = target?.text ?? '';
        if (isDangerousAction(elementText, reason)) {
          this.pendingConfirmation = { tool: 'click', n, elementText, reason };
          const prompt = `About to click "${elementText || `#${n}`}". Want me to go ahead?`;
          console.log(`[CompanionManager] click(${n}) -> CONFIRMATION REQUIRED: ${prompt}`);
          this.enqueueTTS(prompt);
          this.lastDomResult = { tool: 'click', result: { ok: false, deferred: true, awaiting_confirmation: true, n, elementText } };
          return;
        }
        const result = await this.browser.clickByNumber(n);
        console.log(`[CompanionManager] click(${n}) -> ${JSON.stringify(result)}`);
        this.lastDomResult = { tool: 'click', result };
        setTimeout(() => this.overlayManager.bringToFront(), 200);
        return;
      }

      case 'type_text': {
        const n = typeof input.n === 'number' ? input.n : NaN;
        const text = typeof input.text === 'string' ? input.text : '';
        const submit = input.submit === true;
        const reason = typeof input.reason === 'string' ? input.reason : '';
        if (!Number.isFinite(n)) return console.warn('[CompanionManager] type_text called without a valid n');
        // Submission on a form whose surrounding text suggests irreversibility → confirm.
        if (submit && isDangerousAction(reason, text)) {
          const map = await this.browser.getElementMap();
          const target = map.find((e) => e.n === n);
          const elementText = target?.text ?? '';
          this.pendingConfirmation = { tool: 'type_text', n, text, submit, elementText, reason };
          const prompt = `About to type "${text}" and submit. Want me to go ahead?`;
          console.log(`[CompanionManager] type_text(${n}) -> CONFIRMATION REQUIRED`);
          this.enqueueTTS(prompt);
          this.lastDomResult = { tool: 'type_text', result: { ok: false, deferred: true, awaiting_confirmation: true } };
          return;
        }
        const result = await this.browser.typeByNumber(n, text, submit);
        console.log(`[CompanionManager] type_text(${n}, ${JSON.stringify(text)}, submit=${submit}) -> ${JSON.stringify(result)}`);
        this.lastDomResult = { tool: 'type_text', result };
        if (submit) setTimeout(() => this.overlayManager.bringToFront(), 200);
        return;
      }

      case 'scroll': {
        const direction = (input.direction as 'up' | 'down' | 'top' | 'bottom') ?? 'down';
        const amount = typeof input.amount === 'number' ? input.amount : undefined;
        const result = await this.browser.scrollPage(direction, amount);
        console.log(`[CompanionManager] scroll(${direction}, ${amount}) -> ${JSON.stringify(result)}`);
        this.lastDomResult = { tool: 'scroll', result };
        return;
      }

      case 'read_page': {
        const result = await this.browser.readPage();
        const preview = typeof result.text === 'string' ? result.text.slice(0, 80).replace(/\s+/g, ' ') : '';
        console.log(`[CompanionManager] read_page -> "${preview}..."`);
        this.lastDomResult = { tool: 'read_page', result };
        return;
      }

      default:
        console.warn(`[CompanionManager] Unknown tool: ${name}`);
    }
  }

  /**
   * Check if the current user transcript is a yes/no answer to a pending
   * confirmation. If yes, fires the pending action and returns true (caller
   * skips the normal pipeline). If no, cancels and tells the user. If the
   * transcript isn't a clear yes/no, the pending action is cleared and
   * the pipeline runs normally with the transcript as a new request.
   */
  private async handlePendingConfirmation(transcript: string): Promise<boolean> {
    if (!this.pendingConfirmation || !this.browser) return false;
    const t = transcript.trim().toLowerCase();
    const yes = /^(yes|yeah|yep|yup|go|do it|go ahead|confirm|sure|ok|okay|please)\b/.test(t);
    const no = /^(no|nope|cancel|stop|don't|nevermind|never mind|abort)\b/.test(t);

    if (yes) {
      const pending = this.pendingConfirmation;
      this.pendingConfirmation = null;
      let result: DomToolResult;
      if (pending.tool === 'click') {
        result = await this.browser.clickByNumber(pending.n);
      } else {
        result = await this.browser.typeByNumber(pending.n, pending.text ?? '', !!pending.submit);
      }
      console.log(`[CompanionManager] confirmed ${pending.tool}(${pending.n}) -> ${JSON.stringify(result)}`);
      this.enqueueTTS('Done.');
      this.ttsAllQueued = true;
      if (!this.ttsProcessorPromise) this.ttsProcessorPromise = this.runTTSProcessor();
      return true;
    }
    if (no) {
      this.pendingConfirmation = null;
      this.enqueueTTS('Cancelled.');
      this.ttsAllQueued = true;
      if (!this.ttsProcessorPromise) this.ttsProcessorPromise = this.runTTSProcessor();
      return true;
    }
    // Unclear — drop the pending action and let the pipeline handle normally.
    this.pendingConfirmation = null;
    return false;
  }

  // ──────────────────────────────────────────────────────────────────────────

  private async runPipeline(transcript: string): Promise<void> {
    this.lastTranscript = transcript;

    if (this.pendingPipelineAbort) {
      this.setState('idle');
      return;
    }

    this.setState('processing');
    this.resetTTSStream();
    this.aggregatedResponseText = '';

    // Persist the user turn once up front; the assistant turn accumulates across
    // agent-loop iterations and gets persisted at the end.
    this.conversationStore.addMessage('user', transcript);
    this.conversationHistory.push({ role: 'user', content: transcript });

    // Phase 1C: agent loop. Claude can call a tool, see the result, call the
    // next one, etc. — within a single voice command. Cap iterations so a
    // confused model can't loop forever.
    const MAX_AGENT_ITERATIONS = 5;
    let iteration = 0;
    let aggregatedText = '';
    let currentUserMessage = transcript;

    this.setState('responding');

    try {
    while (iteration < MAX_AGENT_ITERATIONS) {
      iteration++;
      if (this.pendingPipelineAbort) break;

      // Gather state for THIS iteration:
      //   - The desktop screenshots captured at PTT press (iter 1 only)
      //   - A fresh browser screenshot + element map every iteration
      //   - The result of the previous tool call, if any
      const screenshotList = iteration === 1 ? [...this.lastScreenshots] : [];
      let browserContextText = '';

      if (this.browser) {
        try {
          const [browserShot, elementMap] = await Promise.all([
            this.browser.captureScreenshotBase64(),
            this.browser.getElementMap(),
          ]);
          if (browserShot) {
            screenshotList.push({
              base64: browserShot,
              label: `Huncho browser surface (iter ${iteration})`,
              displayIndex: 99,
              capturedWidth: 0,
              capturedHeight: 0,
              screenWidth: 0,
              screenHeight: 0,
            });
          }
          if (elementMap.length > 0) {
            const compact = elementMap.slice(0, 80).map((e) => `[${e.n}] ${e.type}: ${e.text}`).join('\n');
            browserContextText = `[Browser element map — only use these numbers with click/type_text]\n${compact}`;
          }
          if (this.lastDomResult) {
            const r = this.lastDomResult;
            browserContextText += `\n\n[Result of your previous ${r.tool}]: ${JSON.stringify(r.result).slice(0, 400)}`;
            this.lastDomResult = null;
          }
        } catch (err) {
          console.warn('[CompanionManager] Failed to gather browser context:', err);
        }
      }

      // Reset per-iteration TTS sentence pointer so pushTTSSentences works on
      // THIS iteration's accumulated text, not the previous one. We DO keep
      // the audio chunk queue draining across iterations.
      this.ttsStreamPos = 0;

      // Clear in-flight dispatch tracking for this turn
      this.inFlightDispatches = [];

      console.log(`[CompanionManager] Agent loop iteration ${iteration}/${MAX_AGENT_ITERATIONS}`);

      let iterText = '';
      try {
        const result = await this.claudeClient.sendMessage({
          transcript: browserContextText ? `${browserContextText}\n\n${currentUserMessage}` : currentUserMessage,
          screenshotBase64List: screenshotList,
          conversationHistory: this.conversationHistory,
          model: this.currentModel,
          windowContext: this.lastWindowContext,
          briefMode: this.briefMode,
        });
        iterText = result.fullText;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          console.log('[CompanionManager] Claude request aborted');
          break;
        }
        console.error('[CompanionManager] Claude API error:', err);
        break;
      }

      // Flush remainder of THIS iteration's text into the TTS queue
      const remainder = iterText.slice(this.ttsStreamPos).trim();
      if (remainder) this.enqueueTTS(remainder);

      aggregatedText += (aggregatedText ? '\n\n' : '') + iterText;
      this.aggregatedResponseText = aggregatedText;

      // Wait for all tool dispatches from this iteration to finish so we know
      // whether the agent should continue (lastDomResult will be set if any
      // DOM-affecting tool fired during this turn).
      if (this.inFlightDispatches.length > 0) {
        await Promise.all(this.inFlightDispatches);
      }

      if (this.pendingPipelineAbort || this.pendingConfirmation) break;

      // Decide whether to continue the loop:
      // - lastDomResult set => a tool fired during this iteration → continue
      // - else                 → we're done
      if (!this.lastDomResult) break;

      // Page settle delay (navigation + JS hydration take a beat)
      await new Promise((r) => setTimeout(r, this.lastDomResult?.tool === 'navigate' ? 1500 : 700));

      // Subsequent iterations are framed as "Continue." so Claude doesn't
      // re-explain the original goal; the result of the prev tool steers him.
      currentUserMessage = 'Continue.';
    }
    } finally {
      // Always flip ttsAllQueued so the processor can finalize, no matter
      // how the loop exited (abort, error, confirmation pause, etc.).
      // Without this, a half-played TTS queue can leave the processor stuck
      // polling forever and the user never hears anything.
      this.ttsAllQueued = true;
      if (this.ttsChunkQueue.length > 0 && !this.ttsProcessorPromise) {
        this.ttsProcessorPromise = this.runTTSProcessor();
      }
    }

    // Persist the FINAL assistant text (concatenation of all iter texts)
    if (aggregatedText) {
      this.conversationStore.addMessage('assistant', aggregatedText);
      this.conversationHistory.push({ role: 'assistant', content: aggregatedText });
    }
    const maxEntries = DUXY_CONFIG.maxConversationHistory * 2;
    if (this.conversationHistory.length > maxEntries) {
      this.conversationHistory = this.conversationHistory.slice(-maxEntries);
    }
    this.broadcastToAll(IPC.RESPONSE_COMPLETE);

    if (this.pendingPipelineAbort || !aggregatedText.trim()) {
      this.setState('idle');
      this.overlayManager.hideAll();
    }
    // State stays 'responding' until renderer fires TTS_COMPLETE (handled in initialize())
  }

  private setState(state: VoiceState): void {
    const prev = this.state;
    this.state = state;
    console.log(`[CompanionManager] State → ${state}`);
    this.broadcastToAll(IPC.VOICE_STATE_CHANGED, { state });
    // Phase 1C: show the numbered chrome badges in the browser only while
    // Huncho is actively listening/thinking/speaking, so they don't litter
    // the page during normal browsing.
    if (this.browser) {
      const wasActive = prev !== 'idle';
      const isActive = state !== 'idle';
      if (isActive !== wasActive) {
        this.browser.setBadgesVisible(isActive).catch(() => { /* non-fatal */ });
        if (isActive) {
          // Re-promote the diamond overlay whenever Huncho wakes up — the
          // browser surface may have taken focus while idle.
          this.overlayManager.bringToFront();
          // Start the heartbeat — while non-idle, snap the overlay back on
          // top frequently so a scroll/click-induced z-order drop recovers
          // before it's perceptible. The promote is cheap (no toggle/flicker).
          if (!this.overlayHeartbeatInterval) {
            this.overlayHeartbeatInterval = setInterval(() => {
              this.overlayManager.bringToFront();
            }, 300);
          }
        } else {
          if (this.overlayHeartbeatInterval) {
            clearInterval(this.overlayHeartbeatInterval);
            this.overlayHeartbeatInterval = null;
          }
        }
      }
    }
  }

  private broadcastToAll(channel: string, payload?: any): void {
    const wins: (BrowserWindow | null)[] = [
      this.trayManager.getPanelWindow(),
      ...this.overlayManager.getAllWindows(),
    ];

    for (const win of wins) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  setBrowserSurface(bs: BrowserSurface | null): void {
    this.browser = bs;
    // When the browser WebContentsView has focus, Chromium may intercept the hotkey
    // before Electron's globalShortcut fires. Register before-input-event as a fallback.
    const wc = bs?.getWebContents();
    if (wc) {
      wc.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown' && input.control && !input.alt && !input.shift && !input.meta && input.key.toLowerCase() === 'h') {
          this.hotkeyMonitor.handleHotkey();
        }
      });
      console.log('[CompanionManager] Registered Ctrl+H before-input-event on browser surface');

      // Page-load events on Windows often steal z-order from our overlay.
      // Re-promote the diamond immediately on every nav and finish-load event.
      const promote = () => {
        if (this.state !== 'idle') this.overlayManager.bringToFront();
      };
      wc.on('did-start-navigation', promote);
      wc.on('did-navigate', promote);
      wc.on('did-navigate-in-page', promote);
      wc.on('did-finish-load', promote);
      wc.on('did-frame-finish-load', promote);
      wc.on('dom-ready', promote);
      // Also re-promote a beat later, after the page has settled
      const promoteSoon = () => {
        if (this.state !== 'idle') setTimeout(() => this.overlayManager.bringToFront(), 250);
      };
      wc.on('did-finish-load', promoteSoon);
      wc.on('did-navigate', promoteSoon);
    }
  }

  getState(): VoiceState {
    return this.state;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  getLastTranscript(): string {
    return this.lastTranscript;
  }

  destroy(): void {
    this.hotkeyMonitor.stop();
    this.claudeClient.cancel();
    if (this.transcriptTimeoutId) {
      clearTimeout(this.transcriptTimeoutId);
      this.transcriptTimeoutId = null;
    }
    for (const channel of [
      IPC.REQUEST_CHAT_HISTORY, IPC.CLEAR_HISTORY, IPC.AUDIO_POWER_LEVEL,
      IPC.REQUEST_MODEL_CHANGE, IPC.TTS_COMPLETE, IPC.HIDE_PANEL,
      IPC.MINIMIZE_PANEL, IPC.QUIT, IPC.TOGGLE_BRIEF_MODE,
    ]) {
      ipcMain.removeAllListeners(channel);
    }
  }
}

