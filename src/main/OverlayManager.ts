import { BrowserWindow, screen, ipcMain, app } from 'electron';
import * as path from 'path';
import { IPC, CursorPointAtPayload, CursorPositionPayload } from '../shared/ipc-types';

export class OverlayManager {
  private overlayWindows: Map<number, BrowserWindow> = new Map();
  private overlayHtmlPath: string;
  private visible = false;

  constructor(overlayHtmlPath: string) {
    this.overlayHtmlPath = overlayHtmlPath;
  }

  createOverlays(): void {
    const displays = screen.getAllDisplays();
    console.log(`[OverlayManager] Creating overlays for ${displays.length} display(s)`);

    for (let i = 0; i < displays.length; i++) {
      const display = displays[i];
      this.createOverlayForDisplay(display, i);
    }

    // Destroy all overlay windows immediately when app is quitting
    // (closable:false prevents app.quit() from closing them normally)
    app.on('before-quit', () => this.destroy());
  }

  private createOverlayForDisplay(display: Electron.Display, displayIndex: number): void {
    const { x, y, width, height } = display.bounds;

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, 'screen-saver');

    // Load overlay HTML with display index as query param
    if (this.overlayHtmlPath.startsWith('http')) {
      win.loadURL(`${this.overlayHtmlPath}?displayIndex=${displayIndex}`);
    } else {
      win.loadFile(this.overlayHtmlPath, {
        query: { displayIndex: String(displayIndex) },
      });
    }

    this.overlayWindows.set(displayIndex, win);
    console.log(`[OverlayManager] Created overlay for display ${displayIndex}: ${width}x${height} at (${x},${y})`);
  }

  showAll(): void {
    this.visible = true;
    for (const win of this.overlayWindows.values()) {
      if (!win.isDestroyed()) {
        win.show();
      }
    }
  }

  /**
   * Re-assert the overlay's always-on-top status. On Windows, the OS can
   * re-stack windows when another (full-screen) window takes focus — e.g.
   * after a browser navigation — pushing this transparent overlay BELOW
   * the browser surface. The diamond mascot then disappears from view.
   * Call this whenever a focus-stealing action might have just happened.
   */
  bringToFront(): void {
    for (const win of this.overlayWindows.values()) {
      if (win.isDestroyed() || !win.isVisible()) continue;
      try {
        // Re-assert the highest practical always-on-top level, then moveTop()
        // to put us above siblings. We deliberately DON'T toggle off-then-on
        // or call showInactive() on a hot path — both create a brief frame
        // where the overlay can flicker/drop. Re-setting the level + moveTop
        // is idempotent and cheap enough to run many times per second.
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
      } catch {
        /* non-fatal */
      }
    }
  }

  hideAll(): void {
    this.visible = false;
    for (const win of this.overlayWindows.values()) {
      if (!win.isDestroyed()) {
        win.hide();
      }
    }
  }

  forwardCursorPointAt(payload: CursorPointAtPayload): void {
    const win = this.overlayWindows.get(payload.displayIndex);
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.CURSOR_POINT_AT, payload);
    } else {
      // Fallback: send to display 0 if target display not found
      const fallback = this.overlayWindows.get(0);
      if (fallback && !fallback.isDestroyed()) {
        fallback.webContents.send(IPC.CURSOR_POINT_AT, payload);
      }
    }
  }

  sendCursorPosition(payload: CursorPositionPayload): void {
    const win = this.overlayWindows.get(payload.displayIndex);
    if (win && !win.isDestroyed() && this.visible) {
      win.webContents.send(IPC.CURSOR_POSITION, payload);
    }
  }

  broadcastToAll(channel: string, payload?: any): void {
    for (const win of this.overlayWindows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.overlayWindows.values()).filter((w) => !w.isDestroyed());
  }

  destroy(): void {
    for (const win of this.overlayWindows.values()) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
    this.overlayWindows.clear();
  }
}

