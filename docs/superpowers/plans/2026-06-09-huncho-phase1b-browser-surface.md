# Huncho Phase 1B — BrowserSurface + First Tool Use — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Huncho a real, controllable in-app web browser with persistent logins, restructure the window so the browser is full-screen with the chat panel floating as a HUD (tray-minimizable), and wire the **first voice-driven action**: saying "open YouTube" makes Huncho navigate its browser to youtube.com.

**Architecture:** A new `BrowserSurface` (Electron `WebContentsView` with a persistent `partition: 'persist:huncho-browser'` session) is mounted full-screen inside Huncho's main window. The existing `panelWindow` becomes a small HUD floated on top, with the existing tray-minimize behavior. `ClaudeAPIClient` is upgraded to declare ONE Anthropic tool — `navigate(url: string)` — and `CompanionManager` routes tool calls to `BrowserSurface`. The pointing/POINT-tag pipeline stays exactly as it is (no behavior change to the existing voice loop except the new navigate capability).

**Tech Stack:** Electron 32 (`WebContentsView`, `BaseWindow`, `session.fromPartition`), TypeScript, React 18, Vitest, Anthropic Messages API tool-use (single tool).

**Repo:** `C:\Users\oHixo\Noxservo Coding\huncho`. Start on `main` (Phase 1A merged, tagged `phase-1a-complete`). All work on a fresh branch `phase-1b-browser-surface`.

**Out of scope (defer):** clicking, typing, scrolling, reading the page DOM, the agent loop, the purchase gate. Those land in Plans 1C and 1D.

---

## File Structure (after this plan)

```
huncho/
├─ src/
│  ├─ main/
│  │  ├─ BrowserSurface.ts          # NEW — wraps a WebContentsView with sticky-login partition
│  │  ├─ MainWindow.ts              # NEW — owns the full-screen BaseWindow that hosts the browser
│  │  ├─ ClaudeAPIClient.ts         # MODIFIED — declare `navigate` tool + emit toolUse event
│  │  ├─ CompanionManager.ts        # MODIFIED — handle navigate tool call -> BrowserSurface
│  │  ├─ TrayManager.ts             # MODIFIED — panel positions over MainWindow; tray toggles HUD only
│  │  ├─ config.ts                  # MODIFIED — system prompt declares navigate capability
│  │  └─ index.ts                   # MODIFIED — boot MainWindow + BrowserSurface
│  ├─ shared/
│  │  ├─ ipc-types.ts               # MODIFIED — add BROWSER_NAVIGATE, BROWSER_DID_NAVIGATE
│  │  └─ __tests__/
│  │     ├─ config.test.ts          # (unchanged)
│  │     └─ navigate-tool.test.ts   # NEW — assert tool spec shape + url validation
│  └─ renderer/
│     └─ urlbar/                    # NEW — tiny dev URL bar overlaid on the browser
│        ├─ App.tsx
│        ├─ main.tsx
│        └─ index.html
├─ vite.config.urlbar.ts            # NEW
└─ docs/superpowers/plans/2026-06-09-huncho-phase1b-browser-surface.md  (this file)
```

Responsibilities:
- **`BrowserSurface`** — purpose: own + drive the in-app browser. Methods: `mount(parentWindow, bounds)`, `navigate(url)`, `getCurrentUrl()`, `setBounds(bounds)`. Persists login via `partition: 'persist:huncho-browser'`. Knows nothing about voice or Claude.
- **`MainWindow`** — purpose: a frameless `BaseWindow` sized to the work area. Holds the `BrowserSurface` view. Knows nothing about voice or panel.
- **`ClaudeAPIClient`** — extended to declare and parse the `navigate` tool. Emits a new `toolUse` event next to the existing `textChunk` / `cursorPoint` events.
- **`CompanionManager`** — gains one handler: on `toolUse` for `navigate`, validate url and call `BrowserSurface.navigate`.
- **`TrayManager`** — unchanged in behavior, but the panel now lives on top of `MainWindow`. Existing `minimizePanel()` already hides the panel and keeps the diamond — exactly what the user asked for.
- **URL bar renderer** — a thin, ~32px-tall React surface fixed at the top of the browser pane for manual navigation during dev/testing.

---

### Task 1: Create the phase-1b branch and confirm Phase 1A baseline

**Files:** none (git only)

- [ ] **Step 1: Branch + verify clean**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d checkout main
git -C $d pull --ff-only 2>$null  # no-op if no remote; safe
git -C $d checkout -b phase-1b-browser-surface
git -C $d status
```
Expected: branch is `phase-1b-browser-surface`, working tree clean.

- [ ] **Step 2: Confirm Phase 1A green**

```powershell
npm test --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: 2 tests pass (the existing `config.test.ts`).

---

### Task 2: Write a failing test for the navigate tool spec

We define the tool spec before any UI work so the shape is locked.

**Files:**
- Create: `src/main/tools/navigate-tool.ts`
- Create: `src/shared/__tests__/navigate-tool.test.ts`

- [ ] **Step 1: Write the failing test FIRST**

Create `src/shared/__tests__/navigate-tool.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NAVIGATE_TOOL, normalizeNavigateUrl } from '../../main/tools/navigate-tool';

describe('navigate tool spec', () => {
  it('declares an Anthropic tool named "navigate" with a url string input', () => {
    expect(NAVIGATE_TOOL.name).toBe('navigate');
    expect(NAVIGATE_TOOL.description).toMatch(/url|navigate|browser/i);
    expect(NAVIGATE_TOOL.input_schema.type).toBe('object');
    expect(NAVIGATE_TOOL.input_schema.properties.url.type).toBe('string');
    expect(NAVIGATE_TOOL.input_schema.required).toContain('url');
  });
});

describe('normalizeNavigateUrl', () => {
  it('passes through a full https url', () => {
    expect(normalizeNavigateUrl('https://youtube.com')).toBe('https://youtube.com');
  });
  it('upgrades http to https', () => {
    expect(normalizeNavigateUrl('http://youtube.com')).toBe('https://youtube.com');
  });
  it('adds https:// to a bare domain', () => {
    expect(normalizeNavigateUrl('youtube.com')).toBe('https://youtube.com');
    expect(normalizeNavigateUrl('gmail.com')).toBe('https://gmail.com');
  });
  it('treats a single word with no dot as a google search', () => {
    expect(normalizeNavigateUrl('weather')).toBe('https://www.google.com/search?q=weather');
  });
  it('trims whitespace', () => {
    expect(normalizeNavigateUrl('  youtube.com  ')).toBe('https://youtube.com');
  });
  it('rejects javascript: and file: urls (returns null)', () => {
    expect(normalizeNavigateUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeNavigateUrl('file:///etc/passwd')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```powershell
npm test --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: FAIL — `Cannot find module '../../main/tools/navigate-tool'`.

- [ ] **Step 3: Implement to pass**

Create `src/main/tools/navigate-tool.ts`:
```ts
// The single tool exposed to Claude in Phase 1B. Defines the exact JSON shape
// Anthropic's Messages API expects in the `tools` array, plus a strict
// normalizer that turns whatever the model emits into a safe https URL.

export const NAVIGATE_TOOL = {
  name: 'navigate',
  description:
    "Navigate Huncho's in-app browser to a URL. Use this whenever the user asks " +
    "to open, go to, or visit a website (e.g. 'open YouTube', 'go to Gmail'). " +
    "The 'url' argument can be a full URL ('https://youtube.com'), a bare domain " +
    "('youtube.com'), or a search term (which becomes a Google search).",
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        description: 'URL, bare domain, or search query to navigate to.',
      },
    },
    required: ['url'],
  },
} as const;

export type NavigateToolInput = { url: string };

const FORBIDDEN_PROTOCOLS = ['javascript:', 'file:', 'data:', 'vbscript:'];

/**
 * Turn whatever the model emits into a safe https URL — or null if it's
 * something we refuse to navigate to. Rules:
 *  - trim
 *  - reject javascript:/file:/data:/vbscript:
 *  - http://  -> https://
 *  - already https://  -> pass through
 *  - contains a dot, no protocol  -> prepend https://
 *  - no dot, no protocol  -> wrap as google search
 */
export function normalizeNavigateUrl(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  for (const bad of FORBIDDEN_PROTOCOLS) {
    if (lower.startsWith(bad)) return null;
  }

  if (lower.startsWith('https://')) return trimmed;
  if (lower.startsWith('http://')) return 'https://' + trimmed.slice('http://'.length);

  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return 'https://' + trimmed;
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(trimmed);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```powershell
npm test --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: 9 tests pass (2 existing + 7 new).

- [ ] **Step 5: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add src/main/tools/navigate-tool.ts src/shared/__tests__/navigate-tool.test.ts
git -C $d commit -m "Add navigate tool spec + URL normalizer (TDD: 7 tests)"
```

---

### Task 3: Build the `BrowserSurface` class (no UI yet, just the module)

**Files:**
- Create: `src/main/BrowserSurface.ts`

- [ ] **Step 1: Write the module**

```ts
import { WebContentsView, BaseWindow, session } from 'electron';
import { EventEmitter } from 'events';
import { normalizeNavigateUrl } from './tools/navigate-tool';

/**
 * Huncho's owned in-app browser. Wraps an Electron WebContentsView and
 * persists its session under a named partition so logins (Gmail, YouTube,
 * Netflix, etc.) stick across restarts.
 *
 * Knows nothing about voice, Claude, or the chat panel.
 * Emits 'didNavigate' { url } whenever the page commits a new URL.
 */
export class BrowserSurface extends EventEmitter {
  private view: WebContentsView | null = null;
  private currentUrl = 'about:blank';

  /** Create the view and attach it to a BaseWindow. */
  mount(parent: BaseWindow, bounds: { x: number; y: number; width: number; height: number }): void {
    if (this.view) return;

    this.view = new WebContentsView({
      webPreferences: {
        // Dedicated partition -> persistent cookies + localStorage scoped to Huncho
        partition: 'persist:huncho-browser',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    parent.contentView.addChildView(this.view);
    this.view.setBounds(bounds);

    // Use a recent Chrome UA so sites don't refuse the embedded engine
    const wc = this.view.webContents;
    wc.setUserAgent(
      wc.getUserAgent().replace(/Electron\/[^ ]+ /, '').replace(/huncho\/[^ ]+ /i, ''),
    );

    wc.on('did-navigate', (_e, url) => this.handleNavigate(url));
    wc.on('did-navigate-in-page', (_e, url) => this.handleNavigate(url));

    // Default landing page — a benign blank dark page so the surface isn't ugly white
    wc.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<!doctype html><html><head><meta charset="utf-8"><title>Huncho</title>
           <style>html,body{height:100%;margin:0;background:#0B0B0D;color:#C9A24B;
           font-family:-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;
           justify-content:center;}</style></head>
           <body><div>Huncho ready — say "open &lt;site&gt;" to begin.</div></body></html>`,
        ),
    );
  }

  /** Resize the browser view (call from MainWindow on resize). */
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view?.setBounds(bounds);
  }

  /**
   * Navigate to a URL. Accepts raw model output — runs it through the same
   * normalizer the tests cover. Returns the URL it actually went to, or null
   * if it was rejected as unsafe.
   */
  navigate(rawUrl: string): string | null {
    const safe = normalizeNavigateUrl(rawUrl);
    if (!safe) {
      console.warn(`[BrowserSurface] Refused to navigate to unsafe url: ${rawUrl}`);
      return null;
    }
    if (!this.view) {
      console.warn('[BrowserSurface] navigate() called before mount()');
      return null;
    }
    console.log(`[BrowserSurface] navigate -> ${safe}`);
    this.view.webContents.loadURL(safe);
    return safe;
  }

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  /** Wipe all persistent state — useful for "log out of everything" later. */
  static async clearPersistentSession(): Promise<void> {
    const s = session.fromPartition('persist:huncho-browser');
    await s.clearStorageData();
  }

  destroy(): void {
    if (this.view) {
      this.view.webContents.close();
      this.view = null;
    }
  }

  private handleNavigate(url: string): void {
    this.currentUrl = url;
    this.emit('didNavigate', { url });
  }
}
```

- [ ] **Step 2: Confirm it compiles**

```powershell
npm run build:main --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: clean tsc build, no errors.

- [ ] **Step 3: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add src/main/BrowserSurface.ts
git -C $d commit -m "Add BrowserSurface (WebContentsView + persistent login partition)"
```

---

### Task 4: Add `MainWindow` — full-screen `BaseWindow` that hosts the browser

**Files:**
- Create: `src/main/MainWindow.ts`

- [ ] **Step 1: Write the module**

```ts
import { BaseWindow, screen, app } from 'electron';
import { BrowserSurface } from './BrowserSurface';

const URLBAR_HEIGHT = 36; // px — reserves space for the dev URL bar at the top

/**
 * The full-screen frameless host window. Owns a BrowserSurface that fills it
 * (minus a thin strip at the top for the URL bar, added in a later task).
 * The chat panel (TrayManager.panelWindow) floats on top of this window as
 * a HUD; this class is intentionally unaware of the panel.
 */
export class MainWindow {
  private window: BaseWindow | null = null;
  private browser: BrowserSurface | null = null;

  create(): void {
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;

    this.window = new BaseWindow({
      x, y, width, height,
      frame: false,
      backgroundColor: '#0B0B0D',
      show: true,
      title: 'Huncho',
    });

    this.browser = new BrowserSurface();
    this.browser.mount(this.window, {
      x: 0,
      y: URLBAR_HEIGHT,
      width,
      height: height - URLBAR_HEIGHT,
    });

    this.window.on('resize', () => this.layoutChildren());
    this.window.on('close', (e) => {
      // Don't actually close — Huncho is a long-running tray app. Hide instead.
      e.preventDefault();
      this.window?.hide();
    });
    app.on('before-quit', () => {
      this.window?.removeAllListeners('close');
    });

    console.log('[MainWindow] Created full-screen window with browser surface');
  }

  getBrowserSurface(): BrowserSurface | null {
    return this.browser;
  }

  getWindow(): BaseWindow | null {
    return this.window;
  }

  show(): void {
    this.window?.show();
  }

  hide(): void {
    this.window?.hide();
  }

  destroy(): void {
    this.browser?.destroy();
    this.browser = null;
    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners('close');
      this.window.destroy();
    }
    this.window = null;
  }

  private layoutChildren(): void {
    if (!this.window || !this.browser) return;
    const [w, h] = this.window.getSize();
    this.browser.setBounds({
      x: 0,
      y: URLBAR_HEIGHT,
      width: w,
      height: h - URLBAR_HEIGHT,
    });
  }
}
```

- [ ] **Step 2: Wire into boot in `src/main/index.ts`**

In `src/main/index.ts`, find the block that creates managers (`trayManager = new TrayManager(...)` etc.) and add a `MainWindow` ABOVE the tray creation. Modify the relevant section to look like this (the existing lines stay; only the `MainWindow` lines are new):

```ts
import { MainWindow } from './MainWindow';

let mainWindow: MainWindow | null = null;
// ... existing manager declarations stay ...

// Inside app.whenReady().then(async () => { ... }):
mainWindow = new MainWindow();
mainWindow.create();

// existing trayManager.create(); overlayManager.createOverlays(); etc stay as-is

// In the 'will-quit' handler, add:
mainWindow?.destroy();
```

> NOTE FOR IMPLEMENTER: the existing `index.ts` has a fixed structure (`whenReady` callback, `will-quit` handler). Do not move existing lines; only insert the new ones.

- [ ] **Step 3: Build and smoke-launch**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
npm run build:main --prefix $d
# kill any running instance first
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*Noxservo Coding\huncho*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 1000
npm start --prefix $d
```
Expected:
- Full-screen dark window appears with a small "Huncho ready — say 'open <site>'…" message centered.
- The chat panel still pops to the bottom-right corner ON TOP of the main window (existing behavior).
- The gold diamond still follows the cursor.

- [ ] **Step 4: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add src/main/MainWindow.ts src/main/index.ts
git -C $d commit -m "Add MainWindow (full-screen frameless host) + boot BrowserSurface"
```

---

### Task 5: Add a tiny dev URL bar (renderer) on top of the browser

**Files:**
- Create: `src/renderer/urlbar/index.html`
- Create: `src/renderer/urlbar/main.tsx`
- Create: `src/renderer/urlbar/App.tsx`
- Create: `vite.config.urlbar.ts`
- Modify: `package.json` (add `build:urlbar` script; chain into `build`)
- Modify: `src/main/MainWindow.ts` (mount the urlbar as a second WebContentsView in the top 36px strip)
- Modify: `src/shared/ipc-types.ts` (add `BROWSER_NAVIGATE`, `BROWSER_DID_NAVIGATE`)
- Modify: `src/main/preload.ts` (expose `navigate(url)` + `onBrowserDidNavigate(cb)` to the urlbar renderer)

- [ ] **Step 1: IPC channels**

In `src/shared/ipc-types.ts`, add to the `IPC` const:
```ts
  BROWSER_NAVIGATE: 'DUXY_BROWSER_NAVIGATE',
  BROWSER_DID_NAVIGATE: 'DUXY_BROWSER_DID_NAVIGATE',
```
> The `DUXY_` prefix is an internal wire string — we deliberately preserved this naming convention in Plan 1A. Don't rename.

In the `ElectronAPI` interface in the same file, add:
```ts
  browserNavigate: (url: string) => void;
  onBrowserDidNavigate: (cb: (payload: { url: string }) => void) => () => void;
```

- [ ] **Step 2: Expose via preload**

In `src/main/preload.ts`, inside the `contextBridge.exposeInMainWorld('electronAPI', { ... })` object, add:
```ts
  browserNavigate: (url: string) => ipcRenderer.send(IPC.BROWSER_NAVIGATE, { url }),
  onBrowserDidNavigate: (cb: (p: { url: string }) => void) => {
    const h = (_e: any, payload: { url: string }) => cb(payload);
    ipcRenderer.on(IPC.BROWSER_DID_NAVIGATE, h);
    return () => ipcRenderer.removeListener(IPC.BROWSER_DID_NAVIGATE, h);
  },
```

- [ ] **Step 3: URL bar renderer**

Create `src/renderer/urlbar/index.html`:
```html
<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>Huncho URL Bar</title>
<style>html,body,#root{height:100%;margin:0;background:#0B0B0D;color:#EDEDED;
font-family:-apple-system,Segoe UI,sans-serif;}</style>
</head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

Create `src/renderer/urlbar/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App />);
```

Create `src/renderer/urlbar/App.tsx`:
```tsx
import React, { useEffect, useState } from 'react';

export const App: React.FC = () => {
  const [url, setUrl] = useState('');

  useEffect(() => {
    return window.electronAPI.onBrowserDidNavigate(({ url }) => setUrl(url));
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!v) return;
    window.electronAPI.browserNavigate(v);
  };

  return (
    <form onSubmit={submit} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', height: 36, boxSizing: 'border-box',
      borderBottom: '1px solid #1F1F22', background: '#0F0F12',
    }}>
      <span style={{ color: '#C9A24B', fontSize: 12, letterSpacing: 0.5 }}>HUNCHO</span>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        spellCheck={false}
        placeholder="type a URL or say 'open <site>'"
        style={{
          flex: 1, height: 24, padding: '0 8px',
          background: '#1A1A1E', border: '1px solid #2A2A2F', borderRadius: 4,
          color: '#EDEDED', fontSize: 12, outline: 'none',
        }}
      />
    </form>
  );
};
```

- [ ] **Step 4: Vite config for the new renderer**

Create `vite.config.urlbar.ts` (copy of `vite.config.panel.ts` with the paths swapped):
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer/urlbar',
  base: './',
  resolve: {
    alias: {
      '../../shared': path.resolve(__dirname, 'src/shared'),
      '../../../shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer/urlbar'),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, 'src/renderer/urlbar/index.html') },
  },
  server: { port: 5175, strictPort: true },
});
```

- [ ] **Step 5: Add the build script**

In `package.json`, in `"scripts"`:
- Change `"build"` from `"npm run build:main && npm run build:panel && npm run build:overlay"` to `"npm run build:main && npm run build:panel && npm run build:overlay && npm run build:urlbar"`.
- Add `"dev:urlbar": "vite --config vite.config.urlbar.ts"`.
- Add `"build:urlbar": "vite build --config vite.config.urlbar.ts"`.

- [ ] **Step 6: Mount the URL bar in `MainWindow`**

In `src/main/MainWindow.ts`, add another `WebContentsView` for the URL bar:

At the top of the class, add a new private field:
```ts
  private urlbarView: import('electron').WebContentsView | null = null;
```

Inside `create()`, after `this.browser.mount(...)`, add:
```ts
    // URL bar in the top strip
    const { WebContentsView } = await import('electron');
    this.urlbarView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.window.contentView.addChildView(this.urlbarView);
    this.urlbarView.setBounds({ x: 0, y: 0, width, height: URLBAR_HEIGHT });

    const urlbarHtml = process.env.NODE_ENV === 'development'
      ? 'http://localhost:5175'
      : path.join(__dirname, '../../dist/renderer/urlbar/index.html');
    if (urlbarHtml.startsWith('http')) this.urlbarView.webContents.loadURL(urlbarHtml);
    else this.urlbarView.webContents.loadFile(urlbarHtml);
```
> Add `import * as path from 'path';` at the top of `MainWindow.ts`. Convert the `create()` method's signature to `async create(): Promise<void>` to use the dynamic import safely, AND update `index.ts` to `await mainWindow.create();`.

Update `layoutChildren()` to also resize the urlbar:
```ts
    this.urlbarView?.setBounds({ x: 0, y: 0, width: w, height: URLBAR_HEIGHT });
```

Update `destroy()` to close the urlbar too:
```ts
    this.urlbarView?.webContents.close();
    this.urlbarView = null;
```

Add a getter so the boot wiring (Task 6) can read it:
```ts
  getUrlbarWebContents(): import('electron').WebContents | null {
    return this.urlbarView?.webContents ?? null;
  }
```

- [ ] **Step 7: Wire the IPC in `index.ts`**

In `src/main/index.ts`, inside `app.whenReady().then(async () => { ... })`, AFTER `await mainWindow.create();` and AFTER the existing `companionManager.initialize()`, add:

```ts
  // Bridge: urlbar form submit -> BrowserSurface.navigate -> urlbar address update
  const browser = mainWindow.getBrowserSurface();
  ipcMain.on(IPC.BROWSER_NAVIGATE, (_e, payload: { url: string }) => {
    browser?.navigate(payload.url);
  });
  browser?.on('didNavigate', ({ url }: { url: string }) => {
    mainWindow?.getUrlbarWebContents()?.send(IPC.BROWSER_DID_NAVIGATE, { url });
  });
```
Add `IPC` to the existing import at the top: `import { IPC } from '../shared/ipc-types';`.

- [ ] **Step 8: Build everything, smoke-test**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
npm run build --prefix $d
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*Noxservo Coding\huncho*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 1000
npm start --prefix $d
```
Expected:
- Top strip shows the URL bar with the gold "HUNCHO" label + empty input.
- Type `youtube.com` and press Enter → the browser pane navigates to YouTube and the URL bar input updates to the final URL.
- **Sticky login proof:** sign into YouTube/Gmail/whatever. Close Huncho. Relaunch. The URL bar input updates to `https://youtube.com/...` and you are STILL LOGGED IN. (Persistent partition working.)

- [ ] **Step 9: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add -A
git -C $d commit -m "Add dev URL bar (manual navigation + sticky-login smoke test path)"
```

---

### Task 6: Upgrade `ClaudeAPIClient` to support Anthropic tool-use (one tool: navigate)

**Files:**
- Modify: `src/main/ClaudeAPIClient.ts`

Anthropic's Messages API supports tool use when you include a `tools` array in the request and listen for `tool_use` content blocks in the streamed response. We add exactly one tool here.

- [ ] **Step 1: Read ClaudeAPIClient to find the request and SSE-parsing sections**

```powershell
Get-Content "C:\Users\oHixo\Noxservo Coding\huncho\src\main\ClaudeAPIClient.ts" | Select-Object -First 60
```
You're looking for (a) the place where the JSON body is built for the Anthropic call, (b) the place where SSE events are parsed into `textChunk` / `cursorPoint`.

- [ ] **Step 2: Add the tool to the request body**

Import the spec at the top:
```ts
import { NAVIGATE_TOOL } from './tools/navigate-tool';
```

In the request-body builder (where `model`, `system`, `messages`, `max_tokens` are set), add:
```ts
  tools: [NAVIGATE_TOOL],
```

- [ ] **Step 3: Emit a `toolUse` event when Anthropic streams a `tool_use` block**

In the SSE handler, the streaming API sends content blocks of two relevant types: `text` (already handled) and `tool_use`. A `tool_use` block has a `name` and progressively-streamed `input` (delta JSON). The minimal correct handling for ONE tool:

1. When you see `content_block_start` with `content_block.type === 'tool_use'`, remember `{ id, name, inputBuf: '' }`.
2. When you see `content_block_delta` with `delta.type === 'input_json_delta'`, append `delta.partial_json` to `inputBuf`.
3. When you see `content_block_stop` for that block, parse `inputBuf` as JSON and emit:
   ```ts
   this.emit('toolUse', { id, name, input });
   ```
4. The existing text handler stays exactly as it is.

If `ClaudeAPIClient.ts` already has a switch/if-chain on event type, add the new branches inside it. If it has a dispatcher for content_block events, add the tool_use branch alongside the existing text branch. Do NOT rewrite the whole streaming loop — surgically add the tool_use handling alongside what's there.

- [ ] **Step 4: Add a TypeScript export for the new event payload**

Near the other exported event types in `ClaudeAPIClient.ts`:
```ts
export interface ToolUseEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
```

- [ ] **Step 5: Build + run the existing tests (smoke that we didn't break compilation)**

```powershell
npm run build:main --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
npm test --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: clean build; 9 tests still pass.

- [ ] **Step 6: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add src/main/ClaudeAPIClient.ts
git -C $d commit -m "ClaudeAPIClient: declare navigate tool + emit toolUse event"
```

---

### Task 7: Route tool calls through `CompanionManager` to `BrowserSurface`

**Files:**
- Modify: `src/main/CompanionManager.ts`

- [ ] **Step 1: Pass `BrowserSurface` (or `MainWindow`) into the manager**

In `src/main/index.ts`, change the `CompanionManager` construction so it can reach the browser. Smallest-blast-radius approach: give `CompanionManager` a setter, called right after `mainWindow.create()`:

In `src/main/index.ts`:
```ts
companionManager.setBrowserSurface(mainWindow.getBrowserSurface());
```

In `src/main/CompanionManager.ts`:
- Add a private field: `private browser: BrowserSurface | null = null;`
- Add an import: `import { BrowserSurface } from './BrowserSurface';`
- Add: `setBrowserSurface(bs: BrowserSurface | null): void { this.browser = bs; }`

- [ ] **Step 2: Handle the `toolUse` event**

Inside `CompanionManager.initialize()`, where the existing `this.claudeClient.on('textChunk', ...)` and `this.claudeClient.on('cursorPoint', ...)` listeners are registered, add:

```ts
this.claudeClient.on('toolUse', (event: { id: string; name: string; input: Record<string, unknown> }) => {
  if (event.name !== 'navigate') {
    console.warn(`[CompanionManager] Unknown tool: ${event.name}`);
    return;
  }
  const url = typeof event.input.url === 'string' ? event.input.url : '';
  if (!url) {
    console.warn('[CompanionManager] navigate called without a url');
    return;
  }
  if (!this.browser) {
    console.warn('[CompanionManager] navigate called but no BrowserSurface attached');
    return;
  }
  const final = this.browser.navigate(url);
  console.log(`[CompanionManager] tool navigate("${url}") -> ${final ?? 'REJECTED'}`);
});
```

- [ ] **Step 3: Update the system prompt so Claude actually uses the tool**

In `src/main/config.ts`, modify the `systemPrompt`:

REMOVE the old hard-limit sentences:
> HARD LIMIT — WHAT HUNCHO CANNOT DO: You have no ability to click, type, press keys, scroll, drag, or interact with anything on screen in any way. Never offer to click, press, or perform any action on the user's behalf. You can only look at the screen and point. If a user asks you to click something, explain you can only show them where it is.

REPLACE with:
> CAPABILITIES: You have ONE tool available: `navigate(url)`. Use it whenever the user asks to open, go to, visit, pull up, or load any website (e.g. "open YouTube", "go to Gmail", "pull up amazon"). You can also pass a search query and it will become a Google search. You CANNOT yet click, type, or scroll on the page that loads — that capability arrives in a later update. For anything other than navigation, you can still SEE the user's screen and POINT at things (use POINT tags as before).

- [ ] **Step 4: Build and run the existing config test (it'll catch any prompt-rebrand breakage)**

```powershell
npm run build:main --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
npm test --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: clean build; 9 tests pass.

- [ ] **Step 5: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add src/main/CompanionManager.ts src/main/index.ts src/main/config.ts
git -C $d commit -m "CompanionManager: route navigate tool calls to BrowserSurface; system prompt declares capability"
```

---

### Task 8: Confirm tray-minimize still hides the panel cleanly with the new layout

No code changes — the existing `TrayManager.minimizePanel()` already calls `panelWindow.hide()` without touching the overlay. With the new MainWindow underneath, this should "just work."

- [ ] **Step 1: Manually verify**

Run `npm start`. With the app running:
1. The panel is in the bottom-right of the screen, over the full-screen browser.
2. Click the `−` (minimize) button on the panel header.
3. Expected: panel disappears; the full-screen browser is now unobstructed; the gold diamond still follows your cursor; the tray icon still shows.
4. Click the tray icon → panel reappears.

- [ ] **Step 2: If anything is broken**, file a defect under DONE_WITH_CONCERNS — don't fix it in this task (different surface area).

---

### Task 9: Milestone — voice "open YouTube" navigates the browser end-to-end

No code changes. This is the acceptance test for Plan 1B.

- [ ] **Step 1: Sign in once (sticky-login smoke)**

Run `npm start`. In the URL bar, type `youtube.com` → Enter. Sign in (if not already). Quit Huncho. Relaunch.
Expected: you are still signed in. (Persistent partition confirmed.)

- [ ] **Step 2: Voice navigation**

With Huncho running, **tap Alt+D** and say *"Huncho, open YouTube."* **Tap Alt+D** again to send.
Expected:
- Console logs: `[CompanionManager] tool navigate("youtube.com") -> https://youtube.com` (or similar).
- The browser pane navigates to https://youtube.com.
- URL bar updates.

Then try variations:
- *"Open Gmail."* → gmail.com
- *"Go to amazon."* → amazon.com
- *"Pull up the weather."* → google search for "weather"

- [ ] **Step 3: Tag the milestone**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d tag phase-1b-complete
```

- [ ] **Step 4: Merge to main**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d checkout main
git -C $d merge phase-1b-browser-surface --no-ff -m "Merge Phase 1B: BrowserSurface + first tool use (navigate)"
```

**Done when:** saying "open <site>" makes Huncho's own browser navigate there, logins stick across restarts, and the chat panel still minimizes cleanly to the tray.

---

## Self-Review

**Spec coverage (vs §4.3 #1 + #3 of the design doc):**
- "Browser it owns" with persistent partition ✓ (Tasks 3, 4) — `partition: 'persist:huncho-browser'`.
- First "Hands" action — `navigate` ✓ (Tasks 2, 6, 7). Click/type/scroll/read/pressKey deliberately deferred to Plan 1C — design §4.3 lists the full set but 1B was explicitly scoped to navigate-only.
- Full-screen browser with HUD chat panel + tray-minimizable ✓ (Tasks 4, 8) — design decision recorded with the user 2026-06-09.
- Voice-driven navigation in 1B ✓ (Tasks 6, 7, 9) — pulled forward from 1D per user request.

**Placeholder scan:** No "TBD" steps. Every code step has the actual code; every shell step has the actual command and the expected output. Task 6 Steps 3 is the only step that asks the implementer to graft into existing SSE logic rather than rewrite it — that's deliberate (rewriting the whole streaming loop is high-risk), and the four-step recipe inside that step is specific.

**Type/name consistency:** `NAVIGATE_TOOL` (Task 2), `BrowserSurface` (Task 3), `MainWindow` (Task 4), `toolUse` event payload `{ id, name, input }` (Task 6), `setBrowserSurface` (Task 7) — names match across tasks. IPC channel string `DUXY_BROWSER_NAVIGATE` matches the established convention from Plan 1A.

**Out-of-scope items (deferred, documented):** click/type/scroll/read_page → Plan 1C. Agent loop + purchase gate → Plan 1D. Replacing the dev URL bar with a sleeker design → cosmetic, anytime.
