import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  VoiceStateChangedPayload,
  TranscriptUpdatePayload,
  ResponseChunkPayload,
  AudioPowerLevelPayload,
  CursorPointAtPayload,
  CursorPositionPayload,
  PermissionsStatusPayload,
  ModelChangedPayload,
  TtsPlayAudioPayload,
  TtsSpeakTextPayload,
  MicPcmChunkPayload,
  RequestModelChangePayload,
  ChatHistoryPayload,
} from '../shared/ipc-types';

// Helper: register an IPC listener and return a cleanup function
function onChannel<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function onChannelNoPayload(channel: string, cb: () => void): () => void {
  const handler = () => cb();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Get display index from URL query params (set by OverlayManager)
function getDisplayIndex(): number {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const idx = params.get('displayIndex');
    if (idx !== null) return parseInt(idx, 10);
  }
  return 0;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Main → Renderer listeners
  onVoiceStateChanged: (cb: (payload: VoiceStateChangedPayload) => void) =>
    onChannel<VoiceStateChangedPayload>(IPC.VOICE_STATE_CHANGED, cb),

  onTranscriptUpdate: (cb: (payload: TranscriptUpdatePayload) => void) =>
    onChannel<TranscriptUpdatePayload>(IPC.TRANSCRIPT_UPDATE, cb),

  onResponseChunk: (cb: (payload: ResponseChunkPayload) => void) =>
    onChannel<ResponseChunkPayload>(IPC.RESPONSE_CHUNK, cb),

  onAudioPowerLevel: (cb: (payload: AudioPowerLevelPayload) => void) =>
    onChannel<AudioPowerLevelPayload>(IPC.AUDIO_POWER_LEVEL, cb),

  onCursorPointAt: (cb: (payload: CursorPointAtPayload) => void) =>
    onChannel<CursorPointAtPayload>(IPC.CURSOR_POINT_AT, cb),

  onCursorPosition: (cb: (payload: CursorPositionPayload) => void) =>
    onChannel<CursorPositionPayload>(IPC.CURSOR_POSITION, cb),

  onPermissionsStatus: (cb: (payload: PermissionsStatusPayload) => void) =>
    onChannel<PermissionsStatusPayload>(IPC.PERMISSIONS_STATUS, cb),

  onModelChanged: (cb: (payload: ModelChangedPayload) => void) =>
    onChannel<ModelChangedPayload>(IPC.MODEL_CHANGED, cb),

  onTtsPlayAudio: (cb: (payload: TtsPlayAudioPayload) => void) =>
    onChannel<TtsPlayAudioPayload>(IPC.TTS_PLAY_AUDIO, cb),

  onTtsSpeakText: (cb: (payload: TtsSpeakTextPayload) => void) =>
    onChannel<TtsSpeakTextPayload>(IPC.TTS_SPEAK_TEXT, cb),

  onResponseComplete: (cb: () => void) =>
    onChannelNoPayload(IPC.RESPONSE_COMPLETE, cb),

  onTtsComplete: (cb: () => void) =>
    onChannelNoPayload(IPC.TTS_COMPLETE, cb),

  onTtsAllSent: (cb: () => void) =>
    onChannelNoPayload(IPC.TTS_ALL_SENT, cb),

  onTtsStop: (cb: () => void) =>
    onChannelNoPayload(IPC.TTS_STOP, cb),

  onChatHistory: (cb: (payload: ChatHistoryPayload) => void) =>
    onChannel<ChatHistoryPayload>(IPC.CHAT_HISTORY, cb),

  onHistoryCleared: (cb: () => void) =>
    onChannelNoPayload(IPC.CLEAR_HISTORY, cb),

  // Renderer → Main senders
  sendMicPcmChunk: (payload: MicPcmChunkPayload) =>
    ipcRenderer.send(IPC.MIC_PCM_CHUNK, payload),

  sendAudioPowerLevel: (payload: AudioPowerLevelPayload) =>
    ipcRenderer.send(IPC.AUDIO_POWER_LEVEL, payload),

  requestModelChange: (payload: RequestModelChangePayload) =>
    ipcRenderer.send(IPC.REQUEST_MODEL_CHANGE, payload),

  quit: () => ipcRenderer.send(IPC.QUIT),
  hidePanel: () => ipcRenderer.send(IPC.HIDE_PANEL),
  minimizePanel: () => ipcRenderer.send(IPC.MINIMIZE_PANEL),
  notifyTtsComplete: () => ipcRenderer.send(IPC.TTS_COMPLETE),
  requestChatHistory: () => ipcRenderer.send(IPC.REQUEST_CHAT_HISTORY),
  clearHistory: () => ipcRenderer.send(IPC.CLEAR_HISTORY),

  // Utilities
  getDisplayIndex,
});

