# Huncho

> **Talk to your computer — and watch it actually do the thing.**
> Huncho is a voice-driven AI for Windows that operates your browser for you: say what you want, and it navigates, clicks, types, scrolls, and reads pages back to you out loud.

Most AI assistants just *talk*. Huncho **acts**. Ask it to "pull up the cheapest flight to Denver next weekend" or "play lo-fi on YouTube" or "read me this article," and a glowing diamond flies across its built-in browser doing the work while you watch — hands-free after a single keypress.

Free. Runs on your machine. Bring your own Google Gemini key (also free). Nothing about your browsing leaves your computer except the words you speak to the AI.

---

## What it can do

- **Operate a real browser by voice** — navigate to sites, click links and buttons, fill and submit forms, scroll, and search, all from natural speech ("open Amazon and search for a standing desk").
- **Read the web back to you** — "read me this page," "what's the price on that," "summarize this article."
- **See the screen** — ask about anything visible ("what breed is that dog?", "how much is that jacket?") and it answers from what's on screen.
- **Its own always-signed-in browser** — sign in to your sites once inside Huncho and it stays logged in, so it can act as you.
- **Remembers you** — learns your preferences and routines across sessions, locally.
- **Gets faster the more you use it** — repeated commands ("open YouTube") replay instantly without calling the AI again.
- **Asks before spending money** — it acts freely on everything except purchases/payments, which always require your confirmation.

## How it works (under the hood)

1. **You press `Ctrl+H`** and speak. (One tap to start, tap again to stop — or just stop talking and it ends the turn on its own.)
2. **Your speech is transcribed locally** on your machine (Moonshine, an on-device model — no cloud, no audio upload).
3. **Google Gemini** (your key) decides what to do and drives the browser through a small set of tools: navigate, click, type, scroll, read.
4. **Huncho talks back** with a free system voice (Microsoft Edge TTS), and the diamond cursor flies to whatever it's interacting with so you can follow along.
5. **Memory + action cache** run entirely on-device to personalize and speed up repeat tasks.

The only thing that ever leaves your computer is the text of your command (sent to Google's Gemini API with your own key). Audio, browsing, logins, and memory stay local.

## Best use cases

Huncho shines when your **hands or eyes are busy**, or when you'd rather *say it* than click through it:

- **Hands-busy moments** — cooking with a recipe up, eating, working at a bench, holding a baby. "Scroll down." "Next step." "Play the next video."
- **Accessibility** — a genuinely useful daily driver if a mouse and keyboard are hard (RSI, limited mobility, a temporary injury). Voice in, actions out.
- **Media & background** — "put on a nature documentary," "play lo-fi beats," "open Netflix."
- **Quick lookups without stopping** — "what's the weather this weekend," "how much is this on Amazon," "define quixotic," "read me the top result."
- **Repetitive web chores** — the sites you open every day, checked by voice instead of a dozen clicks.
- **Casual research & reading** — pull up references, skim articles read aloud, ask follow-ups about what's on screen.

Where it's **not** the right tool (being honest):

- Pixel-precise work (design tools, spreadsheets, drag-and-drop) — use your mouse.
- Canvas-only apps (the insides of Google Docs, Figma) where there's no real page structure to act on.
- Anything on a site it isn't signed in to — sign in once inside Huncho's browser first.

## Requirements

- **Windows 10/11**
- A free **Google Gemini API key** — get one in 30 seconds at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- A microphone

## Install & first run

1. Download the latest installer from the [Releases page](https://github.com/Hixly/huncho/releases) and run it.
2. On first launch, Huncho shows a short setup screen asking for your **Gemini API key**. Paste it in and hit **Save & Start** — the key is stored **only on your computer** and is never displayed back or sent anywhere except Google's API. (Change or rotate it anytime from the ⚙ gear in the panel header.)
3. That's it. Press **`Ctrl+H`**, say something like *"open YouTube and play lo-fi,"* and watch it go.

First launch also downloads the small local speech model (one time, a minute or two).

## Privacy

- **Your voice never leaves your machine** — transcription is fully local.
- **Your browsing and logins stay local** — Huncho's browser lives on your computer.
- **The only outbound data** is the text of your commands, sent to Google Gemini using **your** key under **your** Google account/terms.
- **Your API key** is stored locally and never displayed back or transmitted anywhere but Google.

## Building from source (developers)

```bash
git clone https://github.com/Hixly/huncho
cd huncho
npm install
npm run build       # compile main + all renderer targets
npm start           # launch
npm test            # 160+ vitest tests
npm run dist        # produce a Windows installer (electron-builder)
```

For development, a `GEMINI_API_KEY` in a local `.env` is used as a fallback if no key is set in the app.

## Under active development

Huncho is a real, working daily-driver, but still evolving. Hands-free wake-word ("just say its name") is built but disabled by default — general speech-to-text can't reliably hear a made-up word, so **`Ctrl+H` push-to-talk is the primary trigger** and works perfectly. See the landing page at [huncho.tech](https://huncho.tech) for more.

---

*Built by [Hixly](https://github.com/Hixly). Huncho drives your browser with your permission and your API key — it's your assistant, on your machine.*
