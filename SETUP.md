# Duxy — Setup Guide

## 1. Deploy the Cloudflare Worker

The worker proxies all API calls (Claude, ElevenLabs, AssemblyAI). You need a free Cloudflare account.

**Install Wrangler CLI:**
```bash
npm install -g wrangler
wrangler login
```

**Create a wrangler.toml in the worker/ folder:**
```toml
name = "duxy-proxy"
main = "src/index.ts"
compatibility_date = "2024-01-01"
```

**Deploy the worker:**
```bash
cd worker
npx wrangler deploy
```

**Set your API keys as Cloudflare secrets** (never commit these):
```bash
npx wrangler secret put ANTHROPIC_API_KEY
# Paste your Anthropic API key when prompted

npx wrangler secret put ELEVENLABS_API_KEY
# Paste your ElevenLabs API key

npx wrangler secret put ELEVENLABS_VOICE_ID
# Paste your ElevenLabs Voice ID (e.g. "21m00Tcm4TlvDq8ikWAM" for Rachel)

npx wrangler secret put ASSEMBLYAI_API_KEY
# Paste your AssemblyAI API key
```

After deploying, Wrangler will print your worker URL like:
`https://duxy-proxy.YOUR-SUBDOMAIN.workers.dev`

---

## 2. Set the Worker URL in config.ts

Edit `src/main/config.ts` and replace the placeholder:

```typescript
workerBaseURL: 'https://duxy-proxy.YOUR-SUBDOMAIN.workers.dev',
```

---

## 3. Add Tray Icon Assets

See `assets/TRAY_ICON_NOTE.txt` for instructions on creating:
- `assets/tray-icon.png` — 16x16 or 32x32 PNG for system tray
- `assets/icon.ico` — 256x256 ICO for installer

---

## 4. Install Dependencies and Run

```bash
cd duxy
npm install
```

**Development mode** (hot reload):
```bash
npm run build:main        # Compile main process TypeScript once
npm run start:dev         # Start Electron in dev mode

# In separate terminals:
npm run dev:panel         # Vite dev server for panel (port 5173)
npm run dev:overlay       # Vite dev server for overlay (port 5174)
```

Or use the combined dev command (runs all watchers):
```bash
npm run dev
# Then in a separate terminal:
npm run start:dev
```

**Production build:**
```bash
npm run build
npm start
```

**Create Windows installer:**
```bash
npm run dist
# Output: release/Duxy Setup X.X.X.exe
```

---

## 5. Usage

1. Launch Duxy — it appears in the **system tray** (bottom-right), not the taskbar
2. Click the tray icon to open the control panel
3. Press **Ctrl+Alt** and hold to speak
4. Release **Ctrl+Alt** when done speaking
5. Duxy will:
   - Capture your voice via AssemblyAI transcription
   - Take a screenshot of all monitors
   - Send both to Claude for analysis
   - Stream the response to the overlay and read it aloud

---

## 6. API Keys Required

| Service | Purpose | Get key at |
|---------|---------|------------|
| Anthropic | Claude AI responses | console.anthropic.com |
| ElevenLabs | Text-to-speech | elevenlabs.io |
| AssemblyAI | Speech-to-text | assemblyai.com |

All keys are stored securely as Cloudflare Worker secrets and never exposed to the client.

---

## 7. Troubleshooting

**Ctrl+Alt not triggering:**
- `uiohook-napi` may need to be rebuilt for your Node/Electron version
- Run: `npm run build:main` and try again
- Check if antivirus is blocking the global keyboard hook

**Blank tray icon:**
- Add `assets/tray-icon.png` (see step 3)

**"Cannot connect to worker":**
- Verify your worker URL in `src/main/config.ts`
- Test the worker: `curl -X POST https://your-worker.workers.dev/chat -d '{}'`

**Microphone not working:**
- Windows may require mic permission for Electron apps
- Check Settings → Privacy → Microphone → Allow apps to access microphone
