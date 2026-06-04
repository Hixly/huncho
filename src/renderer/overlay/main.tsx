import React from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayView } from './OverlayView';

// Handle TTS audio playback in overlay renderer
window.electronAPI.onTtsPlayAudio(({ audioBase64 }) => {
  const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
  audio.play().catch((err) => console.error('[OverlayRenderer] Audio playback error:', err));
});

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<OverlayView />);
}
