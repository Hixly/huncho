import { app, BrowserWindow, session, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC } from '../shared/ipc-types';
import { DUXY_CONFIG } from './config';
import { TrayManager } from './TrayManager';
import { OverlayManager } from './OverlayManager';
import { GlobalHotkeyMonitor } from './GlobalHotkeyMonitor';
import { CompanionManager } from './CompanionManager';
import { MainWindow } from './MainWindow';
import { WakeWordMonitor } from './WakeWordMonitor';

// Load huncho/.env into process.env (no dotenv dependency). Values already in
// the environment win. Used for GEMINI_API_KEY and any future local secrets.
(() => {
  try {
    const envPath = path.join(app.getAppPath(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const key = m[1];
      const value = m[2].replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
    console.log('[Huncho] Loaded .env');
  } catch (err) {
    console.warn('[Huncho] Failed to load .env:', err);
  }
})();

// Quit handler — registered early so it works regardless of init state
ipcMain.on('DUXY_QUIT', () => {
  app.quit();
  setTimeout(() => process.exit(0), 800);
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[Huncho] Another instance is already running. Exiting.');
  app.exit(0); // hard-exit so this duplicate does NOT continue to initialize
}

// App user model ID for Windows (required for tray to work correctly)
app.setAppUserModelId('com.huncho.app');

// Allow audio autoplay in hidden/inactive windows (needed for TTS playback)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Disable hardware acceleration to prevent overlay rendering issues on some Windows configs
// app.disableHardwareAcceleration();

let mainWindow: MainWindow | null = null;
let trayManager: TrayManager | null = null;
let overlayManager: OverlayManager | null = null;
let hotkeyMonitor: GlobalHotkeyMonitor | null = null;
let companionManager: CompanionManager | null = null;
let wakeWordMonitor: WakeWordMonitor | null = null;

function getPanelHtmlPath(): string {
  // In dev mode: use Vite dev server; in prod: use built file
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:5173'; // Vite dev server for panel
  }
  return path.join(__dirname, '../../dist/renderer/panel/index.html');
}

function getOverlayHtmlPath(): string {
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:5174'; // Vite dev server for overlay
  }
  return path.join(__dirname, '../../dist/renderer/overlay/index.html');
}

app.whenReady().then(async () => {
  console.log('[Huncho] App ready, initializing...');

  // Grant microphone permission so Web Speech API can access the mic
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'media') {
      return true;
    }
    return false;
  });

  const panelHtmlPath = getPanelHtmlPath();
  const overlayHtmlPath = getOverlayHtmlPath();

  // Create the full-screen main window with the in-app browser
  mainWindow = new MainWindow();
  await mainWindow.create();

  // Create managers
  trayManager = new TrayManager(panelHtmlPath, DUXY_CONFIG.panelWidth, DUXY_CONFIG.panelHeight);
  overlayManager = new OverlayManager(overlayHtmlPath);
  hotkeyMonitor = new GlobalHotkeyMonitor();
  companionManager = new CompanionManager(hotkeyMonitor, overlayManager, trayManager);

  // Initialize UI
  trayManager.create();
  trayManager.setMainWindow(mainWindow);
  overlayManager.createOverlays();

  // Initialize companion (connects to services)
  await companionManager.initialize();
  companionManager.setBrowserSurface(mainWindow.getBrowserSurface());

  // Bridge: urlbar form submit -> BrowserSurface.navigate -> urlbar address update
  const browser = mainWindow.getBrowserSurface();
  ipcMain.on(IPC.BROWSER_NAVIGATE, (_e, payload: { url: string }) => {
    browser?.navigate(payload.url).catch((err) => {
      console.warn('[Main] urlbar navigate failed:', err);
    });
  });
  browser?.on('didNavigate', ({ url }: { url: string }) => {
    mainWindow?.getUrlbarWebContents()?.send(IPC.BROWSER_DID_NAVIGATE, { url });
  });

  // Belt-and-suspenders: also catch Ctrl+H via before-input-event on the urlbar webContents.
  // The urlbar is a WebContentsView; when it has focus, Chromium can intercept the
  // keystroke before the OS globalShortcut fires.
  const urlbarWc = mainWindow.getUrlbarWebContents();
  if (urlbarWc) {
    urlbarWc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && !input.alt && !input.shift && !input.meta && input.key.toLowerCase() === 'h') {
        event.preventDefault();
        hotkeyMonitor!.handleHotkey();
      }
    });
  }

  const panelWin = trayManager.getPanelWindow();
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && !input.alt && !input.shift && !input.meta && input.key.toLowerCase() === 'h') {
        event.preventDefault();
        hotkeyMonitor!.handleHotkey();
      }
    });
  }

  // Start global hotkey monitor
  hotkeyMonitor.start();

  // Wake word ("Jarvis" pretrained / custom "Huncho" ONNX) — fully local and
  // keyless via openWakeWord. Ctrl+H always remains available.
  wakeWordMonitor = new WakeWordMonitor();
  if (wakeWordMonitor.start()) {
    wakeWordMonitor.on('wake', () => companionManager?.handleWake());
  }

  console.log('[Huncho] Ready — press Ctrl+H to talk (toggle: tap to start, tap to stop)');

  // Show the panel + overlay on launch so Huncho is visible immediately
  // (otherwise it's a tray-only app and the window stays hidden until the tray icon is clicked)
  trayManager.showPanel();

  // Handle second-instance (focus panel)
  app.on('second-instance', () => {
    trayManager?.showPanel();
  });
});

app.on('will-quit', () => {
  console.log('[Huncho] Shutting down...');
  hotkeyMonitor?.stop();
  wakeWordMonitor?.destroy();
  companionManager?.destroy();
  overlayManager?.destroy();
  trayManager?.destroy();
  mainWindow?.destroy();
});

// Prevent app from quitting when all windows are closed (tray-only app)
app.on('window-all-closed', () => {
  // Do nothing — Huncho is a tray-only app, keep running when windows are closed
});

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error('[Huncho] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Huncho] Unhandled rejection:', reason);
});

