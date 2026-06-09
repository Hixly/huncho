import { BaseWindow, screen, app } from 'electron';
import * as path from 'path';
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
  private urlbarView: import('electron').WebContentsView | null = null;

  async create(): Promise<void> {
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

  getUrlbarWebContents(): import('electron').WebContents | null {
    return this.urlbarView?.webContents ?? null;
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
    this.urlbarView?.webContents.close();
    this.urlbarView = null;
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
    this.urlbarView?.setBounds({ x: 0, y: 0, width: w, height: URLBAR_HEIGHT });
  }
}
