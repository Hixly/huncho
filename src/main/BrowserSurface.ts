import { WebContentsView, BaseWindow, session } from 'electron';
import { EventEmitter } from 'events';
import { normalizeNavigateUrl } from './tools/navigate-tool';
import { DOM_AGENT_SCRIPT, DomToolResult, ElementMapEntry } from './tools/dom-agent';

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

    // Re-inject the DOM agent (Huncho's Eyes + Hands) after every navigation
    // and after dynamic SPA route changes. The agent itself is idempotent.
    wc.on('did-finish-load', () => { this.injectAgent(); });
    wc.on('did-frame-finish-load', (_e, isMain) => { if (isMain) this.injectAgent(); });

    // Default landing page — chrome / off-white to match the new theme.
    wc.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<!doctype html><html><head><meta charset="utf-8"><title>Huncho</title>
           <link rel="preconnect" href="https://fonts.googleapis.com"/>
           <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
           <link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
           <style>
             :root{
               --bg:#f4f3ee;
               --bg-soft:#eae9e4;
               --ink:#1a1a1e;
               --ink-2:#3a3a3e;
               --mute:#7a7a74;
               --border:#d8d8d0;
               --chrome:linear-gradient(135deg,#4a4a54 0%,#2a2a34 38%,#7a7a82 55%,#3a3a44 78%,#5a5a64 100%);
             }
             *{box-sizing:border-box;}
             html,body{
               height:100%;margin:0;
               background:
                 radial-gradient(1100px 700px at 50% 38%, rgba(255,255,255,0.95) 0%, rgba(244,243,238,0) 70%),
                 radial-gradient(900px 700px at 50% 100%, rgba(216,216,208,0.55) 0%, rgba(234,233,228,0) 65%),
                 var(--bg);
               color:var(--ink);
               font-family:'Inter',-apple-system,'Segoe UI',sans-serif;
               display:flex;align-items:center;justify-content:center;
               -webkit-font-smoothing:antialiased;
               overflow:hidden;
             }
             /* Faint hairline crosshair so the canvas reads as a "surface", not a blank tab */
             body::before{
               content:'';position:absolute;inset:0;pointer-events:none;
               background:
                 linear-gradient(to right, rgba(58,58,62,0.06) 1px, transparent 1px) 50% 0/1px 100% no-repeat,
                 linear-gradient(to bottom, rgba(58,58,62,0.05) 1px, transparent 1px) 0 50%/100% 1px no-repeat;
             }
             .wrap{
               position:relative;text-align:center;max-width:640px;padding:40px 32px;
               display:flex;flex-direction:column;align-items:center;gap:18px;
             }
             /* Chrome diamond mark */
             .gem{
               width:34px;height:54px;filter:drop-shadow(0 6px 14px rgba(0,0,0,0.10)) drop-shadow(0 1px 1px rgba(0,0,0,0.25));
             }
             /* Wordmark — Cinzel display with a polished chrome gradient */
             .mark{
               font-family:'Cinzel Decorative',serif;
               font-weight:900;
               font-size:34px;
               letter-spacing:0.42em;
               line-height:1;
               background:var(--chrome);
               -webkit-background-clip:text;background-clip:text;
               -webkit-text-fill-color:transparent;color:transparent;
               padding-left:0.42em; /* compensate trailing letter-spacing for visual center */
               text-shadow:0 1px 0 rgba(255,255,255,0.4);
             }
             .rule{
               width:120px;height:1px;
               background:linear-gradient(90deg, transparent 0%, rgba(58,58,62,0.45) 50%, transparent 100%);
               margin:2px 0 6px;
             }
             .h{
               font-family:'Inter',sans-serif;
               font-size:42px;font-weight:300;letter-spacing:-0.03em;
               line-height:1.05;color:var(--ink);
               margin:0;
             }
             .h em{
               font-style:normal;font-weight:600;
               background:var(--chrome);
               -webkit-background-clip:text;background-clip:text;
               -webkit-text-fill-color:transparent;color:transparent;
             }
             .sub{
               font-size:15px;line-height:1.65;color:var(--mute);
               font-weight:400;max-width:480px;
             }
             kbd{
               font-family:'JetBrains Mono','Cascadia Code',ui-monospace,monospace;
               font-size:11.5px;font-weight:500;
               background:linear-gradient(180deg,#ffffff 0%, #ebebe5 100%);
               border:1px solid #c8c8c0;border-bottom:1.5px solid #a8a8a0;
               border-radius:5px;padding:1.5px 7px;color:var(--ink);
               box-shadow:0 1px 0 rgba(255,255,255,0.9) inset, 0 1px 2px rgba(0,0,0,0.06);
               margin:0 2px;
             }
             .tag{
               margin-top:10px;
               font-family:'JetBrains Mono',monospace;
               font-size:10.5px;letter-spacing:0.22em;color:var(--mute);
               text-transform:uppercase;opacity:0.7;
             }
           </style></head>
           <body>
             <div class="wrap">
               <svg class="gem" viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg">
                 <defs>
                   <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="0%"  stop-color="#ffffff"/>
                     <stop offset="22%" stop-color="#e6e6e6"/>
                     <stop offset="48%" stop-color="#2a2a34"/>
                     <stop offset="62%" stop-color="#5a5a64"/>
                     <stop offset="85%" stop-color="#c8c8c0"/>
                     <stop offset="100%" stop-color="#7a7a74"/>
                   </linearGradient>
                 </defs>
                 <path d="M12 1 L19 14 L12 39 L5 14 Z" fill="url(%23g)" stroke="%230a0a0e" stroke-width="0.9" stroke-linejoin="round"/>
                 <path d="M12 1 L12 39" stroke="%23ffffff" stroke-width="1" opacity="0.85"/>
                 <path d="M5 14 L12 17 L19 14" fill="none" stroke="%23ffffff" stroke-width="0.6" opacity="0.85"/>
               </svg>
               <div class="mark">HUNCHO</div>
               <div class="rule"></div>
               <h1 class="h">I'm up. <em>Where we headed?</em></h1>
               <div class="sub">
                 Hit <kbd>Ctrl</kbd>+<kbd>H</kbd>, name a site, and I'll get us in.<br/>
                 Anything else on your mind — just talk. I got you.
               </div>
               <div class="tag">Standing by · Hixly Research Project</div>
             </div>
           </body></html>`,
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

  getWebContents(): import('electron').WebContents | null {
    return this.view?.webContents ?? null;
  }

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  // ── DOM agent (Eyes + Hands) ────────────────────────────────────────────

  /** Inject the content script into the current page. Idempotent. */
  private async injectAgent(): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(DOM_AGENT_SCRIPT, true);
    } catch (err) {
      console.warn('[BrowserSurface] agent injection failed:', err);
    }
  }

  /** Re-scan the page and return the current element map. */
  async getElementMap(): Promise<ElementMapEntry[]> {
    await this.injectAgent();
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return [];
    try {
      const result = await wc.executeJavaScript('window.__huncho && window.__huncho.getMap()');
      return Array.isArray(result) ? (result as ElementMapEntry[]) : [];
    } catch (err) {
      console.warn('[BrowserSurface] getElementMap failed:', err);
      return [];
    }
  }

  /** Tell the in-page diamond to show/hide. Used by the main-process cursor
   *  tracker so the diamond hides instantly when the OS cursor is over the
   *  floating Huncho panel (which the in-page mouseleave can't detect). */
  setCursorOnPage(visible: boolean): void {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    // Fire-and-forget; never throw across the IPC boundary
    wc.executeJavaScript(
      `window.__huncho && window.__huncho.setCursorOnPage && window.__huncho.setCursorOnPage(${visible ? 'true' : 'false'})`,
    ).catch(() => { /* non-fatal */ });
  }

  /** Show or hide the numbered chrome badges on the page. */
  async setBadgesVisible(visible: boolean): Promise<void> {
    await this.injectAgent();
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(`window.__huncho && window.__huncho.setBadgesVisible(${visible ? 'true' : 'false'})`);
    } catch (err) {
      console.warn('[BrowserSurface] setBadgesVisible failed:', err);
    }
  }

  /** Click element by its number. */
  async clickByNumber(n: number): Promise<DomToolResult> {
    return this.callAgent(`window.__huncho.click(${JSON.stringify(n)})`);
  }

  /** Type into element by its number. */
  async typeByNumber(n: number, text: string, submit = false): Promise<DomToolResult> {
    return this.callAgent(`window.__huncho.type(${JSON.stringify(n)}, ${JSON.stringify(text)}, ${submit ? 'true' : 'false'})`);
  }

  /** Scroll the page. */
  async scrollPage(direction: 'up' | 'down' | 'top' | 'bottom', amount?: number): Promise<DomToolResult> {
    const amt = typeof amount === 'number' ? amount : 'undefined';
    return this.callAgent(`window.__huncho.scroll(${JSON.stringify(direction)}, ${amt})`);
  }

  /** Return the visible text of the current page. */
  async readPage(): Promise<DomToolResult> {
    return this.callAgent('window.__huncho.read()');
  }

  /** Capture a JPEG screenshot of the current browser surface. */
  async captureScreenshotBase64(): Promise<string | null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      const img = await wc.capturePage();
      return img.toJPEG(72).toString('base64');
    } catch (err) {
      console.warn('[BrowserSurface] capturePage failed:', err);
      return null;
    }
  }

  private async callAgent(expr: string): Promise<DomToolResult> {
    await this.injectAgent();
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'no_webcontents' };
    try {
      const out = await wc.executeJavaScript(expr);
      return (out as DomToolResult) ?? { ok: false, error: 'no_result' };
    } catch (err: any) {
      return { ok: false, error: 'eval_error: ' + (err?.message ?? String(err)) };
    }
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
