import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// ── MIC CAPTURE (MediaRecorder → Groq Whisper) ──
// Stream is pre-warmed on load and kept alive — recording starts instantly on PTT press
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let warmedStream: MediaStream | null = null;  // kept alive between recordings
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let animationFrameId: number | null = null;

// Pre-warm microphone: request permission and keep the stream open
async function prewarmMic(): Promise<void> {
  try {
    warmedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    console.log('[Panel] Mic pre-warmed and ready');
    startWakeWordTap();
  } catch (err) {
    console.error('[Panel] Mic pre-warm failed:', err);
  }
}

// ── ALWAYS-ON WAKE WORD TAP ──
// Taps the pre-warmed stream at 16kHz and streams Int16 PCM to the main
// process, where Porcupine listens for the wake word fully on-device.
// Runs alongside MediaRecorder (multiple consumers of one stream are fine).
let wakeContext: AudioContext | null = null;

function startWakeWordTap(): void {
  if (!warmedStream || wakeContext) return;
  try {
    wakeContext = new AudioContext({ sampleRate: 16000 });
    const source = wakeContext.createMediaStreamSource(warmedStream);
    // 2048 samples @16kHz = one IPC message every ~128ms — cheap and steady.
    const processor = wakeContext.createScriptProcessor(2048, 1, 1);
    source.connect(processor);
    processor.connect(wakeContext.destination); // required for onaudioprocess to fire
    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const b64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
      (window.electronAPI as any).sendWakePcmChunk?.({ pcmBase64: b64 });
    };
    console.log('[Panel] Wake word mic tap running (16kHz)');
  } catch (err) {
    console.error('[Panel] Wake word tap failed:', err);
    wakeContext = null;
  }
}

async function startAudioCapture(): Promise<void> {
  // Re-warm if stream was lost (device disconnected, permission revoked, etc.)
  if (!warmedStream || warmedStream.getTracks().some(t => t.readyState === 'ended')) {
    console.log('[Panel] Mic stream stale, re-requesting...');
    await prewarmMic();
  }
  if (!warmedStream) {
    console.error('[Panel] No mic stream available');
    return;
  }

  // Waveform analyser
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(warmedStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const sendLevel = () => {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    window.electronAPI.sendAudioPowerLevel({ level: avg / 255 });
    animationFrameId = requestAnimationFrame(sendLevel);
  };
  animationFrameId = requestAnimationFrame(sendLevel);

  // Start recording immediately — no getUserMedia round-trip
  audioChunks = [];
  mediaRecorder = new MediaRecorder(warmedStream);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };
  mediaRecorder.start();
  console.log('[Panel] MediaRecorder started (pre-warmed stream)');
}

function stopAudioCapture(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (analyser) analyser = null;
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  mediaRecorder.onstop = () => {
    const mimeType = mediaRecorder?.mimeType || 'audio/webm';
    const blob = new Blob(audioChunks, { type: mimeType });
    console.log('[Panel] Audio captured, size:', blob.size, 'bytes');

    if (blob.size < 100) {
      console.warn('[Panel] Audio too small, skipping transcription');
      mediaRecorder = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      window.electronAPI.sendMicPcmChunk({ pcmBase64: '__AUDIO__:' + base64 });
      console.log('[Panel] Audio sent to main process for transcription');
    };
    reader.readAsDataURL(blob);

    // Do NOT stop the stream tracks — keep warmedStream alive for next press
    mediaRecorder = null;
  };

  mediaRecorder.stop();
}

// Pre-warm mic immediately on page load
prewarmMic();

// Listen for voice state changes
window.electronAPI.onVoiceStateChanged(({ state }) => {
  if (state === 'listening') {
    startAudioCapture();
  } else {
    stopAudioCapture();
  }
});

// ── TTS audio queue — plays chunks in order, fires notifyTtsComplete after all done ──
const ttsAudioQueue: string[] = [];
let ttsPlaying = false;
let ttsAllSent = false;
let currentAudioEl: HTMLAudioElement | null = null;

function playNextTTSChunk(): void {
  if (ttsAudioQueue.length === 0) {
    ttsPlaying = false;
    if (ttsAllSent) {
      ttsAllSent = false;
      window.electronAPI.notifyTtsComplete();
    }
    return;
  }

  ttsPlaying = true;
  const audioBase64 = ttsAudioQueue.shift()!;
  const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
  currentAudioEl = audio;
  audio.onended = () => { currentAudioEl = null; playNextTTSChunk(); };
  audio.onerror = () => {
    console.error('[Panel] Audio chunk playback error, skipping');
    currentAudioEl = null;
    playNextTTSChunk();
  };
  audio.play().catch((err) => {
    console.error('[Panel] Audio play() failed:', err);
    currentAudioEl = null;
    playNextTTSChunk();
  });
}

window.electronAPI.onTtsPlayAudio(({ audioBase64 }) => {
  ttsAudioQueue.push(audioBase64);
  if (!ttsPlaying) playNextTTSChunk();
});

window.electronAPI.onTtsStop(() => {
  // Hard stop — clear queue and kill current playback immediately.
  // Also cancel speechSynthesis: the fallback voice path speaks through it
  // and is NOT tracked by ttsAudioQueue, so without this an interrupt (or a
  // new listen) leaves Huncho talking over the user.
  ttsAudioQueue.length = 0;
  ttsAllSent = false;
  ttsPlaying = false;
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl.src = '';
    currentAudioEl = null;
  }
  speechSynthesis.cancel();
  console.log('[Panel] TTS stopped by interrupt');
});

window.electronAPI.onTtsAllSent(() => {
  ttsAllSent = true;
  // If queue is already drained, fire immediately
  if (!ttsPlaying && ttsAudioQueue.length === 0) {
    ttsAllSent = false;
    window.electronAPI.notifyTtsComplete();
  }
});

// ── TTS (Browser speechSynthesis — primary voice) ──
// Pick the best available voice: prefer natural "Online" neural voices on Windows
let cachedVoice: SpeechSynthesisVoice | null = null;

function pickBestVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Priority list: natural-sounding male voices (warm, friendly = Huncho vibe)
  const preferenceOrder = [
    'Microsoft Ryan Online',    // Neural, natural male
    'Microsoft Guy Online',     // Neural, natural male
    'Microsoft Mark Online',    // Neural male
    'Google US English',        // Good quality
    'Microsoft David',          // Classic clear male
    'Microsoft Mark',           // Fallback male
  ];

  for (const name of preferenceOrder) {
    const match = voices.find((v) => v.name.includes(name));
    if (match) return match;
  }

  // Fallback: any English voice
  const english = voices.find((v) => v.lang.startsWith('en'));
  return english || voices[0];
}

function ensureVoice(callback: (voice: SpeechSynthesisVoice | null) => void): void {
  if (cachedVoice) {
    callback(cachedVoice);
    return;
  }
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) {
    cachedVoice = pickBestVoice();
    console.log('[Panel] Selected TTS voice:', cachedVoice?.name || 'default');
    callback(cachedVoice);
  } else {
    speechSynthesis.onvoiceschanged = () => {
      cachedVoice = pickBestVoice();
      console.log('[Panel] Selected TTS voice:', cachedVoice?.name || 'default');
      callback(cachedVoice);
    };
  }
}

window.electronAPI.onTtsSpeakText(({ text }) => {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  utterance.onend = () => window.electronAPI.notifyTtsComplete();

  ensureVoice((voice) => {
    if (voice) utterance.voice = voice;
    console.log('[Panel] Speaking via speechSynthesis:', text.slice(0, 60));
    speechSynthesis.speak(utterance);
  });
});

// ── MOUNT REACT APP ──
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

