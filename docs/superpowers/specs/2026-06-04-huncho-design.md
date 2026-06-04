# Huncho — Design Spec

**Date:** 2026-06-04
**Status:** Design approved in brainstorming; pending final user review before planning.
**One-liner:** A personal, hands-free AI assistant for the laptop — a real "JARVIS" — that you talk to and that *does things for you* in a web browser (opens pages, clicks, types, fills forms, answers questions), confirming only the irreversible.

---

## 1. Background & Lineage

Huncho is a **new project**, not a modification of Duxy. Duxy is being preserved untouched for a future **kids' education tool**. Huncho is a personal daily-driver for the owner's own laptop.

Code lineage: **farzaa/clicky → Duxy → Huncho.** Clicky (macOS) and Duxy (Windows) both *see, talk, and point* but deliberately **never click or type**. As of April 2026 clicky's open development went private. **Huncho's defining leap is actuation** — it actually performs actions — which takes it past where the public clicky/Duxy lineage stops. There is no public blueprint for this layer, so it is built carefully and proven incrementally.

We **fork and reuse** Duxy's proven guts rather than rebuild them.

---

## 2. Goals & Non-Goals

### Goals
- One click to launch; then it's always there, summoned hands-free by voice.
- Talk to it naturally; it talks back and **does** web tasks: email replies, browsing/searching YouTube & Netflix, taking notes, answering genuine questions.
- Feels **alive**: low latency, natural turn-taking, interruptible (barge-in).
- **Single brain: Claude.** No second model / no handoff seam.
- Acts freely on essentially everything; **confirms ONLY purchase / payment transactions** (spending money) by reading the action back and waiting for a spoken "yes." Sending email, posting, deleting, clicking videos, etc. all just happen — no nagging.

### Non-Goals (for now)
- Native/OS-level app control (Photoshop, Excel, games) — explicitly **deferred to a later phase**; browser-first is the on-ramp.
- Speech-to-speech emotional understanding (hearing tone/sarcasm) — accepted loss; near-irrelevant for a productivity assistant.
- Shipping/distribution to other users — this is a personal tool.

---

## 3. Locked Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Control scope | Browser now, OS later | Reliable where it matters; covers the stated use cases |
| Where browsing happens | Huncho's **own in-app browser** (Electron) with a **persistent login profile** | One program, one click; sign into Gmail/YouTube/Netflix once, stays logged in; contained, safer surface than hijacking daily Chrome |
| Autonomy / trust | Acts freely; **confirms ONLY purchase/payment transactions** | Money is the one thing it must check; everyday actions (incl. sending email, clicking videos) just happen |
| Activation | **Hands-free wake word** ("Huncho") | "No keyboard" requirement |
| Brain | **Claude 4.6**, single brain, **routed**: Sonnet for talk, Opus for hard tasks (Phase 1 = all-Sonnet) | Best agent brain; routing preserves snappy voice + reliable hands |
| Voice realtime feel | Assembled around Claude (STT+VAD+wake+streaming TTS+orchestrator) | ~90% of GPT-Realtime-2's feel with no second brain |
| Notes (first version) | Huncho's **own local notepad** it can read back | Always works, no extra login |

---

## 4. Architecture Overview

Two stacks sit on top of the reused Duxy foundation: the **Voice Stack** (how Huncho hears and speaks) and the **Capability Stack** (how Huncho perceives and acts).

### 4.1 Reused from Duxy (forked, not rebuilt)
- Electron shell, multi-window architecture, IPC plumbing, `preload` context bridge
- The character/overlay renderer + narration states (character art may be restyled away from a duck later)
- Conversation memory (`ConversationStore`, persisted to disk)
- Cloudflare Worker proxy pattern (holds API credentials; app never calls providers directly)
- Claude streaming SSE client + the `[POINT:x,y]` coordinate-pointing mechanism (now augmented with actions)

### 4.2 Voice Stack (the "alive" feel, single-brain)
The realtime feel is four independent ingredients assembled around Claude:

1. **Wake word** — on-device custom keyword "Huncho" (Picovoice **Porcupine**, or open-source **openWakeWord**). Replaces the Ctrl+Shift+Space push-to-talk.
2. **Streaming STT + endpointing** — **Deepgram Nova-3** or **AssemblyAI** streaming, plus **Silero VAD** for voice-activity / turn detection. The system decides when you've finished talking (no key to hold).
3. **Streaming brain output** — Claude streams tokens (already in place); sentence chunks are fed to TTS as they complete so Huncho starts speaking before the full answer is generated.
4. **Streaming TTS + barge-in** — **ElevenLabs Flash v2.5** (already in stack) or **Cartesia Sonic**. Barge-in is a control rule: when VAD detects the user speaking, immediately stop playback, flush the TTS queue, and abort the current turn.

**Orchestration:** an open-source voice-agent framework that supports a Claude/Anthropic brain — **Pipecat** or **LiveKit Agents** — to get interruption handling, endpointing, and streaming transport without hand-rolling. (Fallback: extend Duxy's existing state machine + sentence-streaming TTS, which already covers ~70% of this.)

**Realistic latency target:** ~0.8–1.5s to first audio (vs native speech-to-speech ~0.3–0.8s). Same ballpark; the hard problem (driving the browser) stays on the brain best at it.

### 4.3 Capability Stack (the JARVIS part — net-new)
1. **A browser it owns** — an in-app, fully controllable web surface (Electron **WebContentsView/BrowserView**) with a **persistent session partition** so logins stick forever. The character overlay floats above it.
2. **Eyes (perception)** — turns the live page into something Claude can reason about: a compact, **numbered index of interactive elements** (buttons/links/inputs) extracted from the DOM/accessibility tree, plus a screenshot when needed. Claude refers to elements by index, not guessed pixels → reliable clicks. Screenshots remain a fallback for oddities (video scrubbers, canvas).
3. **Hands (actions)** — a fixed tool set Claude can call, executed against the browser surface: `navigate(url)`, `click(elementId)`, `type(elementId, text)`, `scroll(direction)`, `read_page()`, `press_key(key)`, `wait(ms)`. Retires the old "Huncho can never click" rule.
4. **The agent loop** — perceive → decide → act → observe → repeat until the task is done, narrating progress aloud ("opening Gmail… clicking Compose…"). This is Claude tool-use in a loop, replacing single-shot Q&A.
5. **The purchase-confirmation gate** — intercepts only **purchase / payment** actions (anything that spends money: place order, buy now, checkout, pay, subscribe, confirm payment). On those, Huncho **pauses**, reads the action back via TTS ("I'm about to buy this for $49.99 on Amazon. Say 'confirm' to go ahead."), and waits for a spoken yes/no before executing. Everything else — including sending email — passes straight through.

### 4.4 Model strategy
- Brain: **Claude 4.6**, configurable per job.
- **Conversational turns / questions / simple commands → Sonnet 4.6** (fast, cheap, keeps voice snappy).
- **Heavy multi-step browser tasks → Opus 4.6** (better judgment, fewer wrong clicks where it's costly).
- **Phase 1 ships all-Sonnet**; Opus routing is added after real usage reveals where Sonnet trips. Routing keyed off whether the turn is a chat answer vs an executing task.

---

## 5. Data Flow — one full interaction

```
"Huncho…"  → wake word fires → mic opens
   ↓
you speak → streaming STT (partial transcript) → VAD/endpointing decides you're done
   ↓
transcript (+ current page index + screenshot if needed) → Claude (routed Sonnet/Opus), streaming
   ↓
Claude either:
   (a) ANSWERS → sentence chunks → streaming TTS → spoken (interruptible via barge-in)
   (b) ACTS → emits tool calls → agent loop:
         perceive page → click/type/navigate → re-perceive → … → done
         (narrates each step via TTS)
         IF a tool call is a purchase/payment → CONFIRM GATE: read back, await spoken "yes"
   ↓
result spoken; turn persisted to ConversationStore; return to idle/listening
```

Interruption at any point: VAD hears you → TTS stops, in-flight Claude turn/agent action aborts cleanly → new turn begins.

---

## 6. Component Boundaries (each unit: purpose / interface / depends on)

- **WakeWordService** — purpose: fire an event on "Huncho". interface: `onWake(cb)`. depends: Porcupine.
- **VoicePipeline** — purpose: STT + endpointing + barge-in. interface: `onUtterance(text)`, `onSpeechStart()` (for barge-in), `stopSpeaking()`. depends: Deepgram/AssemblyAI, Silero VAD, orchestrator.
- **TTSPlayer** — purpose: speak streamed sentence chunks, support instant stop/flush. interface: `enqueue(text)`, `flush()`. depends: ElevenLabs/Cartesia.
- **BrowserSurface** — purpose: own + drive the in-app browser. interface: `navigate`, `click`, `type`, `scroll`, `pressKey`, `readPageIndex()`, `screenshot()`. depends: Electron WebContentsView + persistent partition.
- **Perception** — purpose: produce the numbered interactive-element index. interface: `getIndex(): Element[]`. depends: BrowserSurface (DOM/AX extraction).
- **AgentLoop** — purpose: run perceive→act→observe until done; route model by task type. interface: `runTask(intent, context)`. depends: ClaudeClient, Perception, BrowserSurface, TrustGate.
- **PurchaseGate** — purpose: detect + gate purchase/payment actions only. interface: `isPurchase(toolCall)`, `confirm(actionSummary): Promise<bool>`. depends: VoicePipeline (spoken yes/no), TTSPlayer (read-back).
- **ClaudeClient** — purpose: streaming Claude calls + tool use, model routing. interface: `sendTurn(...)`, `runTools(...)`. depends: Cloudflare Worker proxy.
- **NotesStore** — purpose: local notes Huncho can write/read back. interface: `add`, `list`, `read`. depends: disk.
- **ConversationStore** (reused) — persisted history.
- **OverlayController** (reused) — character + narration states.

---

## 7. Error Handling & Safety

- **Purchase/payment detection** is the safety backbone. Default-deny posture: if unsure whether an action spends money, confirm. Detect via explicit signals (buttons like "Buy now / Place order / Checkout / Pay / Subscribe / Confirm payment", payment forms, price + purchase context). Non-money actions (send email, post, delete, navigate, click) are NOT gated.
- **Spoken confirmation** must be unambiguous (require a clear "yes"/"send it"/"confirm"; anything else cancels).
- **Barge-in mid-task**: aborting must leave the page in a safe state — never abort *between* the read-back and execution of a purchase (the confirm gate already serializes these).
- **Login persistence**: sessions stored in the Electron partition; first-run sign-in per site; never scripted credential entry.
- **Stuck/looping agent**: cap agent-loop steps per task; on cap or repeated failed perception, stop and report aloud ("I couldn't finish that — here's where I got stuck").
- **Provider failure**: STT/TTS/Claude errors degrade gracefully (e.g., fall back to browser speechSynthesis as Duxy does; surface a spoken error).

### Known risks / open caveats
- **Netflix DRM**: Widevine playback inside a custom Electron browser is finicky. Browsing/searching Netflix is fine; *playing* a title may need a workaround. Known risk, not a blocker. (YouTube is fine.)
- **Anti-bot / login friction** on some sites; mitigated by using a real browser engine + the user's own persistent session.
- **Cost/latency** of the agent loop (vision tokens × steps); mitigated by Sonnet-first, Opus only where needed, prompt caching, capped steps.
- **Wake-word tuning** (false triggers / misses) — accept iteration.

---

## 8. Testing Strategy
- **Action primitives**: unit-test each `BrowserSurface` action against a known local test page (click/type/scroll/read index).
- **Perception**: snapshot tests that the element index correctly enumerates interactive elements on representative pages.
- **Purchase gate**: tests that every detected purchase/payment action is blocked pending confirmation, that non-money actions are NOT gated, and that confirmation parsing only accepts an explicit yes.
- **Agent loop**: scripted end-to-end tasks on stable sites (e.g., "search YouTube for X and play the first result") with assertions on the final state.
- **Barge-in**: simulated speech-start during TTS halts playback within target latency.
- **Manual daily-driver dogfooding**: the real acceptance test — the owner uses it daily and logs failures to feed Opus-routing and prompt tuning.

---

## 9. Phased Roadmap

- **Phase 1 — The hands (genuinely new, prove it first).** Fork Duxy → Huncho. Build BrowserSurface + Perception + Hands + AgentLoop + TrustGate. Reuse Duxy's *existing* voice pipeline as-is (push-to-talk OK at first). All-**Sonnet 4.6**. **Milestone:** talk → it actually does a real web task end-to-end (e.g., "search YouTube for lo-fi and play the first video"). Purchase-confirmation gate built and tested separately (no purchase needed to hit the core milestone).
- **Phase 2 — The alive voice.** Add wake word ("Huncho") + streaming STT/endpointing + barge-in + orchestrator. Drop the keyboard. Now it *feels* like JARVIS.
- **Phase 3 — Headline jobs, hardened.** Email reply with confirm-before-send (Gmail), YouTube/Netflix browsing, local notes, polished spoken confirmations. Add **Opus 4.6 routing** for the hard task-paths based on Phase-1/2 failure data.
- **Phase 4 — (later) OS-level control.** The full JARVIS: native-app control beyond the browser.

---

## 10. Open Questions
1. **Project location** — default chosen: `C:\Users\oHixo\Noxservo Coding\huncho`. Confirm or redirect.
2. **Orchestrator** — Pipecat vs LiveKit Agents vs extending Duxy's own state machine. Decide at Phase 2 (doesn't block Phase 1).
3. **STT provider** — Deepgram vs AssemblyAI (carry-over from Duxy) — decide at Phase 2.
4. **Character** — keep a duck, restyle, or go abstract? Cosmetic; decide anytime.
5. **Git** — initialize a repo for Huncho and commit this spec? (Not done automatically.)
