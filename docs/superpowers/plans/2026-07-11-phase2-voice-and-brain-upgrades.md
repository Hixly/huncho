# Huncho Phase 2 — Voice & Brain Upgrades

Four upgrades, in dependency order. Each phase: implement → vitest → typecheck → commit → push.

## P1 — Keyless wake word (openWakeWord runtime, replaces Porcupine)

**Why:** Phase 2C blocker. Porcupine needs a PICOVOICE_ACCESS_KEY that was never obtained. openWakeWord is Apache-2.0, fully local ONNX, no keys ever.

- New `src/main/wake/OpenWakeWord.ts`: ONNX pipeline (melspectrogram.onnx → embedding_model.onnx → wake model) via `onnxruntime-node`. Input: 16kHz Int16 PCM frames (1280 samples / 80ms per openWakeWord spec), buffered features, sigmoid score, threshold ~0.5, 2s debounce.
- Models in `assets/wake/`: `melspectrogram.onnx`, `embedding_model.onnx`, `hey_jarvis_v0.1.onnx` (pretrained, from dscripka/openWakeWord HF/GitHub releases). Custom `huncho.onnx` wins if present (trained later via LiveKit wakeword pipeline — document the one-command training in docs/WAKE_WORD.md, do NOT run training).
- Rewrite `WakeWordMonitor.ts` to use OpenWakeWord, keep public contract: `start(): boolean`, IPC `WAKE_PCM_CHUNK` ingest, `emit('wake')`, `destroy()`. Remove `@picovoice/porcupine-node` dep.
- Tests: frame buffering, debounce, threshold logic (mock ort session).

## P2 — Local streaming-class STT (Moonshine via transformers.js)

**Why:** kills mic → Cloudflare Worker → Whisper API round-trip (~seconds) for ~100ms-class local transcription. AssemblyAI streaming path stays as config fallback.

- New `src/main/stt/MoonshineTranscriber.ts` using existing dep `@huggingface/transformers`: `pipeline('automatic-speech-recognition', 'onnx-community/moonshine-base-ONNX')` (tiny as low-VRAM fallback), fp32/q8 per availability; models cached to `userData/models`.
- Wire into the voice flow where Whisper-proxy transcription happens today (trace from AudioRecorder/CompanionManager): push-to-talk & wake-word utterances transcribe locally; config flag `sttEngine: 'moonshine' | 'assemblyai'` (default moonshine) in config.ts.
- Tests: transcriber wrapper (mocked pipeline), engine selection, PCM float conversion.

## P3 — Action caching (Stagehand v3 pattern, no new deps)

**Why:** repeat commands ("open YouTube") replay instantly without Gemini round-trips; cheaper + dramatically faster daily driving.

- New `src/main/tools/action-cache.ts`: `{ intentKey → { steps: ToolCall[], startUrl, elementFingerprints, hits, lastOk } }` persisted to `userData/action-cache.json`. Intent key = normalized transcript (lowercase, strip fillers) — exact-match first; keep it deterministic and simple.
- CompanionManager agent loop: on new voice command, check cache → if hit, replay steps through existing tool executor, verifying each click/type target still resolves (element map text fingerprint match) → any mismatch aborts replay, invalidates entry, falls through to normal Gemini loop. On successful model-driven task completion (≥1 tool, ended cleanly, no confirmation-gated actions), record the step list.
- Never cache: confirmation-gated actions (buy/pay/send/delete), read_page-only answers, failed runs.
- Tests: key normalization, record/replay decision, invalidation on fingerprint mismatch, no-cache rules.

## P4 — Local memory (Mem0 pattern, local-first — builds on src/main/memory/embeddings.ts)

**Why:** the personal in "personal JARVIS": remembers preferences, routines, frequent sites across sessions.

- New `src/main/memory/MemoryStore.ts`: JSON at `userData/memories.json`; entries `{ id, text, kind: preference|fact|routine, embedding, createdAt, lastUsedAt, uses }`. Embeddings via existing embeddings.ts infra.
- Extraction: after each completed conversation turn-pair, a cheap Gemini call ("extract durable user facts/preferences worth remembering, else NONE") → dedupe by cosine similarity ≥0.9 (update instead of insert).
- Recall: on each new user command, top-k (3) memories above similarity threshold injected as a `[Huncho memory]` block ahead of the user message; system prompt gets a short MEMORY section explaining it.
- Tests: store CRUD, dedupe, top-k recall, prompt injection formatting.

## Non-goals (this phase)
- Custom "Huncho" model training run (documented, not executed — needs GPU/Colab session)
- True word-by-word streaming STT UI; Kokoro TTS; OS-level control.

## Live-mic caveat
Wake word + STT end-to-end need a human speaking; automated tests cover logic, Hix does the final voice check.
