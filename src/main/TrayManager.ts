import { Tray, Menu, BrowserWindow, screen, nativeImage, app } from 'electron';
import * as path from 'path';
import { OverlayManager } from './OverlayManager';

export class TrayManager {
  private tray: Tray | null = null;
  private panelWindow: BrowserWindow | null = null;
  private panelHtmlPath: string;
  private panelWidth: number;
  private panelHeight: number;
  private keepVisible = false;
  private hasPositioned = false;
  private offScreenForRecording = false;
  private overlayManager: OverlayManager | null = null;
  private mainWindow: { show(): void; hide(): void; getWindow(): import('electron').BaseWindow | null } | null = null;

  constructor(panelHtmlPath: string, panelWidth: number, panelHeight: number) {
    this.panelHtmlPath = panelHtmlPath;
    this.panelWidth = panelWidth;
    this.panelHeight = panelHeight;
  }

  setOverlayManager(om: OverlayManager): void {
    this.overlayManager = om;
  }

  setMainWindow(mw: { show(): void; hide(): void; getWindow(): import('electron').BaseWindow | null }): void {
    this.mainWindow = mw;
  }

  create(): void {
    this.createTray();
    this.createPanel();
  }

  private createTray(): void {
    const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
    let icon: Electron.NativeImage;
    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) icon = nativeImage.createEmpty();
    } catch {
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('Huncho — Your Windows AI Companion\nCtrl+H to speak');

    this.tray.on('click', () => this.togglePanel());
    this.tray.on('double-click', () => this.togglePanel());

    this.tray.on('right-click', () => {
      const menu = Menu.buildFromTemplate([
        { label: 'Open Huncho', click: () => this.showPanel() },
        { label: 'Reset Position', click: () => this.resetPosition() },
        { type: 'separator' },
        { label: 'Quit Huncho', click: () => app.quit() },
      ]);
      this.tray!.popUpContextMenu(menu);
    });

    console.log('[TrayManager] Tray icon created');
  }

  private createPanel(): void {
    this.panelWindow = new BrowserWindow({
      width: this.panelWidth,
      height: this.panelHeight,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: false,
      movable: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    if (this.panelHtmlPath.startsWith('http')) {
      this.panelWindow.loadURL(this.panelHtmlPath);
    } else {
      this.panelWindow.loadFile(this.panelHtmlPath);
    }

    this.panelWindow.webContents.on('console-message', (_event, _level, message) => {
      console.log(`[Panel-Renderer] ${message}`);
    });

    // Clamp to screen after every drag so the panel can never go off-screen
    this.panelWindow.on('moved', () => {
      if (!this.offScreenForRecording) {
        this.clampToScreen();
      }
    });

    // Intercept close (Alt+F4 etc.) — hide instead of destroying
    this.panelWindow.on('close', (e) => {
      e.preventDefault();
      this.panelWindow?.hide();
    });

    // When restored from the taskbar, re-assert always-on-top + focus so the
    // frameless/transparent panel comes back cleanly above other windows.
    this.panelWindow.on('restore', () => {
      if (!this.panelWindow || this.panelWindow.isDestroyed()) return;
      this.panelWindow.setAlwaysOnTop(true);
      this.panelWindow.focus();
    });

    // On app quit: remove the close guard so the window can actually close
    app.on('before-quit', () => {
      if (this.panelWindow && !this.panelWindow.isDestroyed()) {
        this.panelWindow.removeAllListeners('close');
      }
    });

    console.log('[TrayManager] Panel window created');
  }

  /** Clamp the panel position so it's always fully visible on screen */
  private clampToScreen(): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) return;

    const [x, y] = this.panelWindow.getPosition();
    const mid = { x: x + this.panelWidth / 2, y: y + this.panelHeight / 2 };
    const display = screen.getDisplayNearestPoint(mid);
    const area = display.workArea;

    const clampedX = Math.max(area.x, Math.min(x, area.x + area.width - this.panelWidth));
    const clampedY = Math.max(area.y, Math.min(y, area.y + area.height - this.panelHeight));

    if (Math.round(clampedX) !== Math.round(x) || Math.round(clampedY) !== Math.round(y)) {
      this.panelWindow.setPosition(Math.round(clampedX), Math.round(clampedY));
    }
  }

  /** Position panel above the tray icon, anchored to bottom-right */
  private positionPanelAboveTray(): void {
    if (!this.tray || !this.panelWindow) return;

    const trayBounds = this.tray.getBounds();
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    const area = display.workArea;

    const x = Math.max(area.x, Math.min(
      trayBounds.x - this.panelWidth / 2 + trayBounds.width / 2,
      area.x + area.width - this.panelWidth
    ));
    const y = area.y + area.height - this.panelHeight - 8;

    this.panelWindow.setPosition(Math.round(x), Math.round(y));
  }

  /** Force panel back to default position (tray right-click → Reset Position) */
  resetPosition(): void {
    this.positionPanelAboveTray();
    if (!this.panelWindow?.isVisible()) this.showPanel();
  }

  showPanel(): void {
    if (!this.panelWindow) return;
    this.positionPanelAboveTray();
    this.hasPositioned = true;
    this.mainWindow?.show();
    this.panelWindow.show();
    this.panelWindow.focus();
    this.overlayManager?.showAll();
  }

  hidePanel(): void {
    if (!this.panelWindow) return;
    this.panelWindow.hide();
    this.mainWindow?.hide();
    this.overlayManager?.hideAll();
  }

  minimizePanel(): void {
    if (!this.panelWindow) return;
    // Use minimize() (not hide()) so the panel keeps a Windows taskbar button
    // and can be restored with a click. hide() removes it from the taskbar
    // entirely, leaving the tray icon as the only way back.
    this.panelWindow.minimize();
    // Duck stays visible — overlay not hidden
  }

  togglePanel(): void {
    if (!this.panelWindow) return;
    if (this.panelWindow.isVisible()) {
      this.hidePanel();
    } else {
      this.showPanel();
    }
  }

  /** Show panel off-screen so getUserMedia works in the renderer (recording) */
  showForRecording(): void {
    if (!this.panelWindow) return;
    this.keepVisible = true;
    this.offScreenForRecording = true;
    if (!this.panelWindow.isVisible()) {
      this.panelWindow.setPosition(-9999, -9999);
      this.panelWindow.showInactive();
    }
  }

  /** Allow panel to settle after recording ends — move it back on-screen */
  doneRecording(): void {
    this.keepVisible = false;
    this.offScreenForRecording = false;
    // If the window is still off-screen from recording, bring it back
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      const [x] = this.panelWindow.getPosition();
      if (x < -500) {
        this.positionPanelAboveTray();
      }
    }
  }

  getPanelWindow(): BrowserWindow | null {
    return this.panelWindow;
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.removeAllListeners('close'); // allow actual destroy
      this.panelWindow.destroy();
      this.panelWindow = null;
    }
  }
}

