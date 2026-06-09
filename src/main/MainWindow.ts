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
