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
