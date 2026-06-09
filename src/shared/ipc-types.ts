// IPC Channel names
export const IPC = {
  VOICE_STATE_CHANGED: 'DUXY_VOICE_STATE_CHANGED',
  TRANSCRIPT_UPDATE: 'DUXY_TRANSCRIPT_UPDATE',
  RESPONSE_CHUNK: 'DUXY_RESPONSE_CHUNK',
  AUDIO_POWER_LEVEL: 'DUXY_AUDIO_POWER_LEVEL',
  CURSOR_POINT_AT: 'DUXY_CURSOR_POINT_AT',
  PERMISSIONS_STATUS: 'DUXY_PERMISSIONS_STATUS',
  MODEL_CHANGED: 'DUXY_MODEL_CHANGED',
  PTT_PRESS: 'DUXY_PTT_PRESS',
  PTT_RELEASE: 'DUXY_PTT_RELEASE',
  MIC_PCM_CHUNK: 'DUXY_MIC_PCM_CHUNK',
  TTS_PLAY_AUDIO: 'DUXY_TTS_PLAY_AUDIO',
  QUIT: 'DUXY_QUIT',
  RESPONSE_COMPLETE: 'DUXY_RESPONSE_COMPLETE',
  REQUEST_MODEL_CHANGE: 'DUXY_REQUEST_MODEL_CHANGE',
  TTS_SPEAK_TEXT: 'DUXY_TTS_SPEAK_TEXT',
  CURSOR_POSITION: 'DUXY_CURSOR_POSITION',
  TTS_COMPLETE: 'DUXY_TTS_COMPLETE',
  // Chat history
  REQUEST_CHAT_HISTORY: 'DUXY_REQUEST_CHAT_HISTORY',
  CHAT_HISTORY: 'DUXY_CHAT_HISTORY',
  CLEAR_HISTORY: 'DUXY_CLEAR_HISTORY',
  // Panel visibility
  HIDE_PANEL: 'DUXY_HIDE_PANEL',
  MINIMIZE_PANEL: 'DUXY_MINIMIZE_PANEL',
  // TTS streaming
  TTS_ALL_SENT: 'DUXY_TTS_ALL_SENT',
  TTS_STOP: 'DUXY_TTS_STOP',
} as const;

export type VoiceState = 'idle' | 'listening' | 'processing' | 'responding';

export interface VoiceStateChangedPayload {
  state: VoiceState;
}

export interface TranscriptUpdatePayload {
  transcript: string;
  isFinal: boolean;
}

export interface ResponseChunkPayload {
  text: string;
  accumulated: string;
}

export interface AudioPowerLevelPayload {
  level: number; // 0–1 float
}

export interface CursorPointAtPayload {
  x: number;
  y: number;
  label: string;
  displayIndex: number;
}

export interface PermissionsStatusPayload {
  hasMicrophone: boolean;
}

export interface ModelChangedPayload {
  model: string;
}

export interface MicPcmChunkPayload {
  pcmBase64: string;
}

export interface TtsPlayAudioPayload {
  audioBase64: string;
}

export interface TtsSpeakTextPayload {
  text: string;
}

export interface RequestModelChangePayload {
  model: string;
}

export interface CursorPositionPayload {
  x: number;
  y: number;
  displayIndex: number;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface ChatHistoryPayload {
  messages: StoredMessage[];
}

// Electron API exposed via contextBridge
export interface ElectronAPI {
  // Main → Renderer
  onVoiceStateChanged: (cb: (payload: VoiceStateChangedPayload) => void) => () => void;
  onTranscriptUpdate: (cb: (payload: TranscriptUpdatePayload) => void) => () => void;
  onResponseChunk: (cb: (payload: ResponseChunkPayload) => void) => () => void;
  onAudioPowerLevel: (cb: (payload: AudioPowerLevelPayload) => void) => () => void;
  onCursorPointAt: (cb: (payload: CursorPointAtPayload) => void) => () => void;
  onCursorPosition: (cb: (payload: CursorPositionPayload) => void) => () => void;
  onPermissionsStatus: (cb: (payload: PermissionsStatusPayload) => void) => () => void;
  onModelChanged: (cb: (payload: ModelChangedPayload) => void) => () => void;
  onTtsPlayAudio: (cb: (payload: TtsPlayAudioPayload) => void) => () => void;
  onTtsSpeakText: (cb: (payload: TtsSpeakTextPayload) => void) => () => void;
  onResponseComplete: (cb: () => void) => () => void;
  onTtsComplete: (cb: () => void) => () => void;
  onTtsAllSent: (cb: () => void) => () => void;
  onTtsStop: (cb: () => void) => () => void;
  onChatHistory: (cb: (payload: ChatHistoryPayload) => void) => () => void;
  onHistoryCleared: (cb: () => void) => () => void;

  // Renderer → Main
  sendMicPcmChunk: (payload: MicPcmChunkPayload) => void;
  sendAudioPowerLevel: (payload: AudioPowerLevelPayload) => void;
  requestModelChange: (payload: RequestModelChangePayload) => void;
  notifyTtsComplete: () => void;
  quit: () => void;
  hidePanel: () => void;
  minimizePanel: () => void;
  requestChatHistory: () => void;
  clearHistory: () => void;

  // Utilities
  getDisplayIndex: () => number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

