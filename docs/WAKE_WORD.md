# Wake word

Huncho listens for a wake word fully on-device — no API keys, no cloud. Nothing
leaves the machine until *after* the wake word fires. It's built on
[openWakeWord](https://github.com/dscripka/openWakeWord) (Apache-2.0) running as
ONNX via `onnxruntime-node`.

Say **"Jarvis"** to wake it (the shipped pretrained model). `Ctrl+H` push-to-talk
always works too.

## How detection works

The panel renderer taps its pre-warmed mic, downsamples to 16 kHz mono Int16 PCM,
and streams chunks over IPC (`WAKE_PCM_CHUNK`) to `WakeWordMonitor`, which runs a
three-model ONNX pipeline (`src/main/wake/OpenWakeWord.ts`):

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
- A score `>= 0.5` fires `'wake'`, with a **2000 ms debounce** so one utterance
  triggers once.

The three model files live in `assets/wake/`:

| File | Role |
|------|------|
| `melspectrogram.onnx` | shared feature model — PCM → mel spectrogram |
| `embedding_model.onnx` | shared feature model — Google speech-embedding |
| `hey_jarvis_v0.1.onnx` | pretrained wake model ("Jarvis") |
| `huncho.onnx` | *optional* custom wake model — wins if present |

All three shared/pretrained files come from the openWakeWord
[v0.5.1 release](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1).

## Training a custom "Huncho" model

Drop a `huncho.onnx` into `assets/wake/` and `WakeWordMonitor` uses it
automatically instead of "Jarvis" — no code change.

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

> Training itself is **not** run as part of this repo — it needs a GPU/Colab
> session. The output ONNX simply drops in.
