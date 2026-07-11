# Huncho

> A personal hands-free AI assistant that drives the browser by voice. Say it, watch it happen.

Huncho is a JARVIS-style desktop assistant for Windows. It listens for a wake word, transcribes what you say, and acts — navigating, clicking, and reading pages in its own embedded browser, answering out loud through TTS, and remembering context across conversations.

## What it does

- **Wake word → voice command → action**, fully hands-free (Porcupine wake word, AssemblyAI transcription)
- **Drives a real browser** — an embedded browser surface it can navigate, read, and act on
- **Talks back** — Edge TTS by default, ElevenLabs optional
- **Two AI engines** — Gemini 2.5 Flash as the default engine with Claude as fallback
- **Screen awareness** — screen capture + window context so it knows what you're looking at
- **Memory + personality** — conversation store and a configurable persona

## Architecture

Electron app with four separate build targets:

| Target | What it is | Built with |
|--------|-----------|------------|
| `main` | Electron main process — audio, wake word, AI clients, browser control | `tsc` |
| `panel` | Side panel UI | Vite (`vite.config.panel.ts`) |
| `overlay` | On-screen overlay UI | Vite (`vite.config.overlay.ts`) |
| `urlbar` | URL bar UI | Vite (`vite.config.urlbar.ts`) |

API calls are proxied through a Cloudflare Worker so no keys ship in the app — see [SETUP.md](./SETUP.md).

## Stack

Electron 32 · TypeScript · React 18 · Vite · Porcupine (wake word) · AssemblyAI (STT) · msedge-tts / ElevenLabs (TTS) · Gemini + Claude · Vitest

## Develop

```bash
npm install
npm run dev      # watch-builds all four targets
npm start        # launch Electron
npm test         # Vitest
npm run dist     # package with electron-builder
```
