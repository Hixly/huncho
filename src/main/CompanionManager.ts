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

export class CompanionManager {
  private state: VoiceState = 'idle';
  private currentModel: string = DUXY_CONFIG.defaultModel;
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

  private pendingPipelineAbort = false;
  private transcriptTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private cursorTrackingInterval: ReturnType<typeof setInterval> | null = null;
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
    this.audioRecorder.setTranscriptReadyCallback((transcript: string) => {
      console.log(`[CompanionManager] Transcript received from renderer: "${transcript}"`);
      this.broadcastToAll(IPC.TRANSCRIPT_UPDATE, { transcript, isFinal: true });
      if (this.state === 'listening' || this.state === 'processing') {
        this.runPipeline(transcript);
      }
    });

    // Wire up Claude streaming events
    this.claudeClient.on('textChunk', ({ chunk, accumulated }: { chunk: string; accumulated: string }) => {
      this.broadcastToAll(IPC.RESPONSE_CHUNK, { text: chunk, accumulated });
      // Stream TTS: detect sentence boundaries and enqueue as Claude types
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

    // Forward TTS complete from panel → overlay so duck knows when to fly back
    ipcMain.on(IPC.TTS_COMPLETE, () => {
      this.overlayManager.broadcastToAll(IPC.TTS_COMPLETE);
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
    this.cursorTrackingInterval = setInterval(() => {
      const point = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(point);
      const displayIndex = displays.findIndex((d) => d.id === display.id);
      this.overlayManager.sendCursorPosition({
        x: point.x - display.bounds.x,
        y: point.y - display.bounds.y,
        displayIndex: displayIndex >= 0 ? displayIndex : 0,
      });
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
      console.log('[CompanionManager] Response interrupted — returning to idle');
      return; // Do NOT start a new recording on this press
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
    }

    this.ttsProcessorPromise = null;

    // Signal renderer all audio chunks have been sent
    if (!this.pendingPipelineAbort) {
      if (panelWin && !panelWin.isDestroyed()) {
        panelWin.webContents.send(IPC.TTS_ALL_SENT);
      }
    }
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

    // Screenshots were captured at PTT press — use them directly
    const screenshotList = this.lastScreenshots;
    console.log(`[CompanionManager] Using ${screenshotList.length} pre-captured screenshot(s)`);

    if (this.pendingPipelineAbort) {
      this.setState('idle');
      return;
    }

    this.setState('responding');

    let fullResponseText = '';

    try {
      const result = await this.claudeClient.sendMessage({
        transcript,
        screenshotBase64List: screenshotList,
        conversationHistory: this.conversationHistory,
        model: this.currentModel,
        windowContext: this.lastWindowContext,
      });

      fullResponseText = result.fullText;

      // Persist to disk
      this.conversationStore.addMessage('user', transcript);
      this.conversationStore.addMessage('assistant', fullResponseText);

      // Update in-memory Claude context
      this.conversationHistory.push({ role: 'user', content: transcript });
      this.conversationHistory.push({ role: 'assistant', content: fullResponseText });
      const maxEntries = DUXY_CONFIG.maxConversationHistory * 2;
      if (this.conversationHistory.length > maxEntries) {
        this.conversationHistory = this.conversationHistory.slice(-maxEntries);
      }

      this.broadcastToAll(IPC.RESPONSE_COMPLETE);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.log('[CompanionManager] Claude request aborted');
        this.setState('idle');
        this.trayManager.doneRecording();
        return;
      }
      console.error('[CompanionManager] Claude API error:', err);
      this.setState('idle');
      this.trayManager.doneRecording();
      return;
    }

    if (this.pendingPipelineAbort || !fullResponseText.trim()) {
      this.setState('idle');
      this.overlayManager.hideAll();
      return;
    }

    // Flush any remaining text after the last sentence boundary
    const remainder = fullResponseText.slice(this.ttsStreamPos).trim();
    if (remainder) {
      this.enqueueTTS(remainder);
    }

    // Mark queue as complete so the processor can exit and send TTS_ALL_SENT
    this.ttsAllQueued = true;

    // If no sentences were queued at all (e.g. very short response), start processor now
    if (!this.ttsProcessorPromise) {
      this.ttsProcessorPromise = this.runTTSProcessor();
    }

    // Wait for all audio chunks to be generated and sent to renderer
    if (this.ttsProcessorPromise) {
      await this.ttsProcessorPromise;
    }

    // Only transition to idle if we're still in the responding state —
    // user may have pressed PTT to interrupt, which already moved state to listening
    if (this.state === 'responding') {
      this.setState('idle');
      this.trayManager.doneRecording();
    }
  }

  private setState(state: VoiceState): void {
    this.state = state;
    console.log(`[CompanionManager] State → ${state}`);
    this.broadcastToAll(IPC.VOICE_STATE_CHANGED, { state });
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
      IPC.MINIMIZE_PANEL, IPC.QUIT,
    ]) {
      ipcMain.removeAllListeners(channel);
    }
  }
}

