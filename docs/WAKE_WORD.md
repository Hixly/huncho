# Wake word

Huncho listens for a wake word fully on-device — no API keys, no cloud. Nothing
leaves the machine until *after* the wake word fires.

Say **"Huncho"** to wake it. `Ctrl+H` push-to-talk always works too.

There are two engines, selected by `DUXY_CONFIG.wakeEngine` in
`src/main/config.ts`:

| Engine | Default | Trains a model? | CPU | Recognizes |
|--------|---------|-----------------|-----|------------|
| `'phrase'` | ✅ | no | ~ASR pass per short utterance | "Huncho" (+ tunable mishears) |
| `'onnx'` | | yes (or ships trademarked "Jarvis") | near-zero | whatever the model was trained on |

---

## `'phrase'` — the default engine

**Why it exists.** The `'onnx'` engine needs a model trained for the exact
phrase. The only pretrained model that fits an assistant is **"hey jarvis"** —
and *Jarvis* is Marvel/Disney IP, so it cannot ship in a public build. Training a
"Huncho" model needs a GPU/Colab session and a round of data synthesis. The
phrase engine sidesteps both: it recognizes **any** phrase with **zero
training**, using components Huncho already ships.

**How it works.**

```
16kHz PCM ──▶ PhraseWakeDetector ──▶ candidate segment ──▶ Moonshine (tiny) ──▶ matchesWake() ──▶ 'wake'
   (mic tap)    RMS segmenter           ~0.3–2.5s audio      local ASR, keyless    variant match
```

1. **Segment** (`src/main/wake/PhraseWakeDetector.ts`) — the panel renderer taps
   its pre-warmed mic, downsamples to 16 kHz mono Int16 PCM, and streams chunks
   over IPC (`WAKE_PCM_CHUNK`). The detector slices that continuous stream into
   short *candidate utterances* using the same RMS + adaptive-noise-floor logic
   as the endpointer (`frameRms`, EMA floor, `max(absoluteFloor, floor × factor)`
   speech line — a steady hum lifts the floor instead of registering as speech).

   Defaults: 80 ms frames, ≥250 ms of speech required, closed by 400 ms of
   trailing silence, hard-capped at 2500 ms, with **300 ms of pre-roll**. The
   pre-roll matters: by the time the RMS threshold trips, the first phoneme is
   already in the past, and without it the transcriber reliably hears "uncho".

2. **Transcribe** — each segment goes to a dedicated `MoonshineTranscriber`
   using the **`tiny`** model (cheaper and faster than the `base` model used for
   real commands; matching one known word doesn't need the accuracy). Local,
   keyless, warmed up in the background at start.

3. **Match** (`src/main/wake/wake-phrase.ts`) — the transcript is normalized
   (lowercased, diacritics and punctuation stripped, whitespace collapsed) and
   checked against `wakeVariants` as whole-word matches that must **start within
   the first 3 words**. So "Huncho, open YouTube" wakes, but "…and then I was
   wearing a poncho" does not.

A match emits `'wake'`, with the same **2000 ms debounce** as the ONNX path so
one utterance triggers once.

### Tuning the variants

"Huncho" isn't a dictionary word, so a small ASR model renders it as the nearest
real ones. `DEFAULT_WAKE_VARIANTS` is therefore a list of accepted **mishears**,
not aliases:

```
huncho · hey huncho · honcho · hey honcho · head honcho · hun cho
hunch oh · huncha · hunchoe · uncho · poncho · hey poncho · hunter cho
```

Tune them in one place — `DUXY_CONFIG.wakeVariants` in `src/main/config.ts`:

- **False wakes?** Remove the loosest entries. `poncho`, `uncho` and
  `head honcho` are the most likely culprits.
- **Not waking?** Say the word, watch the console for
  `[WakeWordMonitor] no wake in "<transcript>"`, and add whatever your voice
  actually transcribes as.
- **Different name entirely?** Set `wakePhrase` and replace `wakeVariants`.
  No model, no retraining.

### Cost and trade-offs

This is the honest downside versus the ONNX engine: **it runs a (small) ASR pass
on every short utterance the mic picks up**, instead of a fixed, tiny amount of
math per frame. Mitigations, all already in place:

- **Silence is free.** No segment closes, so nothing is transcribed. The RMS
  gate is a few multiplies per 80 ms frame.
- **`tiny`, not `base`.** Roughly a third of the compute of the main STT model.
- **One at a time.** Transcriptions are serialized through a promise queue, and
  a segment arriving while one is in flight is **dropped**, not queued — an
  unbounded queue would fall further and further behind live audio and
  eventually wake on stale speech.
- **Paused whenever Huncho is awake.** `WakeWordMonitor.setPaused(true)` drops
  incoming PCM on the floor entirely. `CompanionManager` pauses on every
  departure from `idle` and resumes on every return (a single hook in
  `setState`, so error/abort/interrupt paths can't strand it off). Besides
  saving CPU, this is what stops **Huncho's own TTS** — playing out of the
  speakers, straight into the always-on mic tap while state is `'responding'` —
  from waking itself, and stops the user's actual command from re-triggering a
  wake mid-turn.

If CPU ever becomes a problem in a noisy room, raise `minSpeechMs` /
`trailingSilenceMs` in `PhraseWakeDetector`, or train a model and switch to
`'onnx'`.

---

## `'onnx'` — the openWakeWord engine (optional)

Set `wakeEngine: 'onnx'` to use
[openWakeWord](https://github.com/dscripka/openWakeWord) (Apache-2.0) running as
ONNX via `onnxruntime-node`. Near-zero CPU, but it only recognizes the phrase
its wake model was trained on.

```
raw 16kHz PCM ──▶ melspectrogram.onnx ──▶ embedding_model.onnx ──▶ <wake>.onnx ──▶ score 0..1
                  32 mel bins/frame       76 mel frames → 96-dim     16 rolling
                  (~10 ms per frame)       speech embedding           embeddings
```

- Audio is processed in **1280-sample (80 ms) frames**. Features are only
  computed when the accumulated sample count is a multiple of 1280; odd-sized
  incoming chunks are buffered and the remainder carried to the next call.
- Each 1280-sample chunk yields **8 new mel frames** (hop 160) and **1 new
  96-dim embedding** (a 76-frame mel window, stepped by 8 frames per chunk).
- The wake model consumes a rolling window of the **last 16 embeddings** and
  emits a probability in `0..1` (already sigmoid'd — no extra activation).
- A score `>= 0.5` fires `'wake'`, with a **2000 ms debounce**.

The model files live in `assets/wake/`:

| File | Role |
|------|------|
| `melspectrogram.onnx` | shared feature model — PCM → mel spectrogram |
| `embedding_model.onnx` | shared feature model — Google speech-embedding |
| `huncho.onnx` | custom wake model — **used if present** |
| `hey_jarvis_v0.1.onnx` | pretrained fallback — ⚠️ **trademarked, do not ship** |

The shared/pretrained files come from the openWakeWord
[v0.5.1 release](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1).

> ⚠️ If `wakeEngine` is `'onnx'` and no `huncho.onnx` exists, Huncho falls back
> to `hey_jarvis_v0.1.onnx` **and logs a warning**: "Jarvis" is a Marvel/Disney
> trademark and must not be shipped in a public build. Either train a custom
> model or stay on the default `'phrase'` engine.

### Training a custom "Huncho" model

Drop a `huncho.onnx` into `assets/wake/` and the ONNX engine uses it
automatically — no code change.

The easiest path is LiveKit's synthetic-data wake-word trainer, which needs no
recorded audio: it generates the training set with TTS and outputs an
openWakeWord-compatible ONNX model. See
[**LiveKit — Train a custom wake word**](https://livekit.com/blog/livekit-wakeword)
and the referenced notebook/repo. In short:

1. Open the trainer notebook (Colab GPU recommended).
2. Set the target phrase to `Huncho` (or `Hey Huncho`).
3. Run the one training pass — it synthesizes samples and trains a small
   classifier on top of the frozen `embedding_model`.
4. Export ONNX and save it as `assets/wake/huncho.onnx`.
5. Set `wakeEngine: 'onnx'` in `src/main/config.ts`.

> Training itself is **not** run as part of this repo — it needs a GPU/Colab
> session. The output ONNX simply drops in.

---

## Files

| Path | Role |
|------|------|
| `src/main/WakeWordMonitor.ts` | engine selection, IPC ingest, debounce, `setPaused` |
| `src/main/wake/PhraseWakeDetector.ts` | RMS segmenter with pre-roll (pure) |
| `src/main/wake/wake-phrase.ts` | normalization + variant matching (pure) |
| `src/main/wake/OpenWakeWord.ts` | ONNX feature/wake pipeline |
| `src/main/config.ts` | `wakeEngine`, `wakePhrase`, `wakeVariants`, `wakeMoonshineModel` |
