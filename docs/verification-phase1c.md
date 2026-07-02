# Huncho Phase 1C — Verification & experiments

Run dev: `npm run dev` (4 Vite servers + tsc watch). In a second terminal: `npm run start:dev`.

Watch logs in the Electron/main process console for `[Agent]` lines.

---

## A — Diamond follower (in-page)

### What was wrong
After navigate/click tasks, the in-page diamond stayed at **opacity 0** until you moved the mouse.

Three gates controlled visibility; **`hasMoved`** blocked show until the first `mousemove` on that page load. Agent tasks often navigate without you moving the mouse → diamond “vanished.”

### What we fixed
- Removed the **`hasMoved`** requirement.
- Moved cursor state to **`CURSOR_STATE`** at script scope so reinstalling the DOM node (Google wiping it) does not reset everything.
- **`setCursorOnPage(true)`** from main process now sets `isOverPage = true` — diamond shows when OS cursor is over the browser, even post-navigation.
- Removed **`window.blur → hide`** (programmatic clicks briefly steal focus and were hiding the diamond).

### How to verify (2 min)
1. Start Huncho, open browser surface, move mouse over the page → diamond trails behind cursor.
2. **Ctrl+H** → “Go to google.com” → let Huncho navigate **without moving your mouse**.
3. Diamond should stay visible on the Google page.
4. Run a second task (“search for cats”) → after results load, diamond still visible without wiggling mouse.
5. Move cursor to the floating panel → diamond hides. Back to browser → shows again.

**Pass:** Diamond visible through steps 2–4 without manual mouse wiggle.

---

## B — Model experiment (Sonnet vs Opus)

### What model is used
- **Default:** `claude-sonnet-4-5` (`src/main/config.ts`)
- **Switch:** Panel footer → **Sonnet** / **Opus** toggles
- **Path:** Panel → `CompanionManager` → `ClaudeAPIClient` → Cloudflare worker → Anthropic API

Every request logs: `[ClaudeAPIClient] Sending request with model …`

Agent loop logs (added):
- `[Agent] iter=1/5 model=… elements=142 viewportH=900`
- `[Agent] tool=click model=… input={"n":3,…}`
- `[Agent] iter=1 done model=… spokenChars=42 ttsQueue=1`

### Same-task A/B (10 min)
Run **the same voice command twice** — once on Sonnet, once on Opus:

> “Open Google, search for Wikipedia, click the first Wikipedia result.”

| Watch for | Sonnet | Opus |
|-----------|--------|------|
| Correct search box `#` from map | | |
| Wrong click / off-by-one | | |
| Extra useless iterations | | |
| Spoken step narration each iter | | |

**Interpretation**
- **Opus better, same diamond/TTS:** model upgrade helps reasoning; keep Opus for hard pages.
- **Both wrong on element #:** fix map (C), not model.
- **Silent mid-task:** TTS pipeline issue (see D checklist § TTS).

**Recommendation:** Default **Sonnet** for daily dev (faster/cheaper). **Opus** for dense UIs after 1C passes.

---

## C — Element map (spatial hints)

### What was wrong
Claude only saw `[n] type: text` for the **first 80** elements. No coordinates, no region context, no truncation notice → wrong picks on busy pages.

### What we fixed
- New formatter: `src/main/tools/element-map-format.ts`
- Lines now look like: `[3] button @480,120: Sign in`
- Grouped by viewport band: `[top]`, `[mid]`, `[bottom]`
- If >80 elements: footer tells Claude to **scroll** then **Continue**
- System prompt updated to reference `@x,y` coords
- Viewport height from `window.__huncho.info().innerHeight`

### How to verify (3 min)
1. Navigate to Google results or Amazon (many links).
2. **Ctrl+H** → ask something that needs a mid-page link.
3. In main logs, confirm `elements=N` where N may be >80.
4. In DevTools on browser page (optional): numbered badges only while Huncho is active.

**Pass:** Claude picks elements that match screenshot position; fewer “random” high numbers.

---

## D — Phase 1C end-to-end checklist

Run all three tasks in one session. Check each box.

### Task 1 — Navigate + search
**Say:** “Go to Google and search for cats.”

| Step | Expected | ✓ |
|------|----------|---|
| Huncho speaks between steps | Short sentence each iteration | |
| Browser navigates to Google | URL bar updates | |
| Types in search box, submits | Results page | |
| TTS through entire loop | Voice until final line finishes | |
| Diamond visible on browser | No vanish after nav | |

### Task 2 — Read page
**Say:** “Read me the title of the first result.”

| Step | Expected | ✓ |
|------|----------|---|
| Uses `read_page` or describes from screenshot | Spoken summary | |
| No spurious tool loop | Stops after answer | |

### Task 3 — Interrupt
**Mid-speech, press Ctrl+H**

| Step | Expected | ✓ |
|------|----------|---|
| TTS stops immediately | Kill-switch | |
| State returns idle | Can ask new question | |

### Log grep (while testing)
```
[Agent] iter=
[Agent] tool=
[ClaudeAPIClient] Sending request with model
```

### If something fails
| Symptom | Likely cause | Next fix |
|---------|--------------|----------|
| Diamond gone after task | Re-test A; check cursor over browser not panel | |
| No voice on step 2+ | TTS queue / tool-only turns | Enqueue tool summaries |
| Wrong element # | Map truncation | scroll + Continue, or raise cap |
| API 4xx | Worker / model id | Check worker logs |

---

## After D passes
Safe to start **2A (awareness)** or **2C (wake word)** — not before.
