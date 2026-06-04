import { app, BrowserWindow, session, ipcMain } from 'electron';
import * as path from 'path';
import { DUXY_CONFIG } from './config';
import { TrayManager } from './TrayManager';
import { OverlayManager } from './OverlayManager';
import { GlobalHotkeyMonitor } from './GlobalHotkeyMonitor';
import { CompanionManager } from './CompanionManager';

// Quit handler — registered early so it works regardless of init state
ipcMain.on('DUXY_QUIT', () => {
  app.quit();
  setTimeout(() => process.exit(0), 800);
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[Duxy] Another instance is already running. Exiting.');
  app.quit();
}

// App user model ID for Windows (required for tray to work correctly)
app.setAppUserModelId('com.duxy.app');

// Allow audio autoplay in hidden/inactive windows (needed for TTS playback)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Disable hardware acceleration to prevent overlay rendering issues on some Windows configs
// app.disableHardwareAcceleration();

let trayManager: TrayManager | null = null;
let overlayManager: OverlayManager | null = null;
let hotkeyMonitor: GlobalHotkeyMonitor | null = null;
let companionManager: CompanionManager | null = null;

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
  console.log('[Duxy] App ready, initializing...');

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

  // Create managers
  trayManager = new TrayManager(panelHtmlPath, DUXY_CONFIG.panelWidth, DUXY_CONFIG.panelHeight);
  overlayManager = new OverlayManager(overlayHtmlPath);
  hotkeyMonitor = new GlobalHotkeyMonitor();
  companionManager = new CompanionManager(hotkeyMonitor, overlayManager, trayManager);

  // Initialize UI
  trayManager.create();
  overlayManager.createOverlays();

  // Initialize companion (connects to services)
  await companionManager.initialize();

  // Start global hotkey monitor
  hotkeyMonitor.start();

  console.log('[Duxy] Ready — press Ctrl+Alt to speak');

  // Handle second-instance (focus panel)
  app.on('second-instance', () => {
    trayManager?.showPanel();
  });
});

app.on('will-quit', () => {
  console.log('[Duxy] Shutting down...');
  hotkeyMonitor?.stop();
  companionManager?.destroy();
  overlayManager?.destroy();
  trayManager?.destroy();
});

// Prevent app from quitting when all windows are closed (tray-only app)
app.on('window-all-closed', () => {
  // Do nothing — Duxy is a tray-only app, keep running when windows are closed
});

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error('[Duxy] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Duxy] Unhandled rejection:', reason);
});
