import { WebContentsView, BaseWindow, session } from 'electron';
import { EventEmitter } from 'events';
import { VoiceState } from '../shared/ipc-types';
import { normalizeNavigateUrl } from './tools/navigate-tool';
import { DOM_AGENT_SCRIPT, DomToolResult, ElementMapEntry } from './tools/dom-agent';

export interface BrowserScreenshot {
  base64: string;
  width: number;
  height: number;
}

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
    wc.on('did-fail-load', (_e, code, desc, url) => {
      console.warn(`[BrowserSurface] did-fail-load ${code} ${desc} — ${url}`);
    });

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
           <link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Inter:wght@200;300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
           <style>
             :root{
               --bg:#f4f3ee; --ink:#1a1a1e; --ink-2:#3a3a3e; --mute:#8a8a80;
               --line:rgba(58,58,62,0.14); --line-soft:rgba(58,58,62,0.07);
               --chrome:linear-gradient(135deg,#4a4a54 0%,#2a2a34 38%,#7a7a82 55%,#3a3a44 78%,#5a5a64 100%);
             }
             *{box-sizing:border-box;margin:0;}
             html,body{height:100%;overflow:hidden;-webkit-font-smoothing:antialiased;
               font-family:'Inter',-apple-system,'Segoe UI',sans-serif;color:var(--ink);
               background:
                 radial-gradient(1200px 800px at 50% 34%, rgba(255,255,255,0.96) 0%, rgba(244,243,238,0) 68%),
                 radial-gradient(1000px 700px at 50% 108%, rgba(210,210,202,0.5) 0%, rgba(234,233,228,0) 60%),
                 var(--bg);}
             /* Blueprint micro-grid */
             body::before{content:'';position:fixed;inset:0;pointer-events:none;opacity:0.5;
               background:
                 linear-gradient(to right, var(--line-soft) 1px, transparent 1px) 0 0/56px 56px,
                 linear-gradient(to bottom, var(--line-soft) 1px, transparent 1px) 0 0/56px 56px;
               mask-image:radial-gradient(900px 640px at 50% 44%, black 30%, transparent 78%);
               -webkit-mask-image:radial-gradient(900px 640px at 50% 44%, black 30%, transparent 78%);}
             /* HUD corner brackets */
             .corner{position:fixed;width:34px;height:34px;border:1px solid var(--line);pointer-events:none;}
             .c-tl{top:22px;left:22px;border-right:0;border-bottom:0;}
             .c-tr{top:22px;right:22px;border-left:0;border-bottom:0;}
             .c-bl{bottom:52px;left:22px;border-right:0;border-top:0;}
             .c-br{bottom:52px;right:22px;border-left:0;border-top:0;}
             /* Edge tick labels */
             .edge{position:fixed;font-family:'JetBrains Mono',monospace;font-size:9px;
               letter-spacing:0.34em;color:var(--mute);opacity:0.55;pointer-events:none;text-transform:uppercase;}
             .e-left{left:30px;top:50%;transform:rotate(180deg) translateY(50%);writing-mode:vertical-rl;}
             .e-right{right:30px;top:50%;transform:translateY(-50%);writing-mode:vertical-rl;}

             .stage{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
               gap:0;position:relative;padding-bottom:44px;}

             /* ── Diamond core w/ orbital rings ── */
             .core{position:relative;width:220px;height:220px;display:flex;align-items:center;justify-content:center;
               margin-bottom:6px;animation:rise 0.9s cubic-bezier(0.2,0.8,0.2,1) both;}
             .ring{position:absolute;inset:0;border-radius:50%;pointer-events:none;}
             .ring svg{width:100%;height:100%;overflow:visible;}
             .r1{animation:spin 26s linear infinite;}
             .r2{inset:24px;animation:spinRev 18s linear infinite;}
             .r3{inset:52px;animation:spin 40s linear infinite;opacity:0.5;}
             @keyframes spin{to{transform:rotate(360deg);}}
             @keyframes spinRev{to{transform:rotate(-360deg);}}
             .gemwrap{position:relative;animation:breathe 4.5s ease-in-out infinite;}
             @keyframes breathe{0%,100%{transform:translateY(0) scale(1);}50%{transform:translateY(-4px) scale(1.03);}}
             .gem{width:44px;height:70px;
               filter:drop-shadow(0 10px 22px rgba(0,0,0,0.14)) drop-shadow(0 1px 1px rgba(0,0,0,0.3));}
             .halo{position:absolute;inset:-34px;border-radius:50%;pointer-events:none;
               background:radial-gradient(circle, rgba(120,120,130,0.20) 0%, rgba(120,120,130,0) 62%);
               animation:halo 4.5s ease-in-out infinite;}
             @keyframes halo{0%,100%{opacity:0.55;transform:scale(1);}50%{opacity:1;transform:scale(1.12);}}

             /* ── Wordmark w/ chrome shimmer sweep ── */
             .mark{position:relative;font-family:'Cinzel Decorative',serif;font-weight:900;font-size:40px;
               letter-spacing:0.44em;line-height:1;padding-left:0.44em;
               background:var(--chrome);-webkit-background-clip:text;background-clip:text;
               -webkit-text-fill-color:transparent;color:transparent;
               animation:rise 0.9s 0.1s cubic-bezier(0.2,0.8,0.2,1) both;}
             .mark::after{content:'HUNCHO';position:absolute;inset:0;padding-left:0.44em;
               background:linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.9) 50%, transparent 60%) no-repeat;
               background-size:220% 100%;
               -webkit-background-clip:text;background-clip:text;
               -webkit-text-fill-color:transparent;color:transparent;
               animation:shimmer 5.5s ease-in-out infinite;}
             @keyframes shimmer{0%,64%{background-position:130% 0;}88%,100%{background-position:-40% 0;}}

             .rule{width:150px;height:1px;margin:20px 0 22px;
               background:linear-gradient(90deg, transparent, rgba(58,58,62,0.5), transparent);
               animation:rise 0.9s 0.18s cubic-bezier(0.2,0.8,0.2,1) both;}

             .h{font-size:34px;font-weight:200;letter-spacing:-0.02em;color:var(--ink-2);
               animation:rise 0.9s 0.26s cubic-bezier(0.2,0.8,0.2,1) both;}
             .h em{font-style:normal;font-weight:600;
               background:var(--chrome);-webkit-background-clip:text;background-clip:text;
               -webkit-text-fill-color:transparent;color:transparent;}

             .sub{margin-top:14px;font-size:14px;line-height:1.7;color:var(--mute);text-align:center;
               animation:rise 0.9s 0.34s cubic-bezier(0.2,0.8,0.2,1) both;}
             kbd{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:500;
               background:linear-gradient(180deg,#ffffff, #ebebe5);
               border:1px solid #c8c8c0;border-bottom:1.5px solid #a8a8a0;border-radius:5px;
               padding:1.5px 7px;color:var(--ink);margin:0 2px;
               box-shadow:0 1px 0 rgba(255,255,255,0.9) inset, 0 1px 2px rgba(0,0,0,0.06);}

             @keyframes rise{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}

             /* ── Bottom HUD status bar ── */
             .hud{position:fixed;left:0;right:0;bottom:0;height:34px;
               display:flex;align-items:center;justify-content:space-between;
               padding:0 26px;border-top:1px solid var(--line);
               background:linear-gradient(180deg, rgba(255,255,255,0.55), rgba(244,243,238,0.9));
               backdrop-filter:blur(4px);
               font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:0.22em;
               color:var(--mute);text-transform:uppercase;}
             .hud .grp{display:flex;align-items:center;gap:10px;}
             .dot{width:6px;height:6px;border-radius:50%;background:#22c55e;
               box-shadow:0 0 6px rgba(34,197,94,0.8);animation:pulse 2.4s ease-in-out infinite;}
             @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.35;}}
             .sep{opacity:0.35;}
           </style></head>
           <body>
             <div class="corner c-tl"></div><div class="corner c-tr"></div>
             <div class="corner c-bl"></div><div class="corner c-br"></div>
             <div class="edge e-left">Voice Link Active</div>
             <div class="edge e-right">Agent Systems Online</div>

             <div class="stage">
               <div class="core">
                 <div class="ring r1"><svg viewBox="0 0 100 100">
                   <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(58,58,62,0.28)" stroke-width="0.5"
                     stroke-dasharray="50 28 8 28 50 143" stroke-linecap="round"/>
                 </svg></div>
                 <div class="ring r2"><svg viewBox="0 0 100 100">
                   <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(58,58,62,0.4)" stroke-width="0.8"
                     stroke-dasharray="20 55 90 143" stroke-linecap="round"/>
                 </svg></div>
                 <div class="ring r3"><svg viewBox="0 0 100 100">
                   <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(58,58,62,0.5)" stroke-width="0.5"
                     stroke-dasharray="2 10" stroke-linecap="round"/>
                 </svg></div>
                 <div class="gemwrap">
                   <div class="halo"></div>
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
                 </div>
               </div>

               <div class="mark">HUNCHO</div>
               <div class="rule"></div>
               <h1 class="h">I'm up. <em>Where we headed?</em></h1>
               <div class="sub">
                 Hit <kbd>Ctrl</kbd>+<kbd>H</kbd> or just say the word — name a site, I'll get us in.<br/>
                 Anything else on your mind, talk to me. I got you.
               </div>
             </div>

             <div class="hud">
               <div class="grp"><span class="dot"></span><span>Standing By</span></div>
               <div class="grp"><span id="hud-date"></span><span class="sep">/</span><span id="hud-clock"></span></div>
               <div class="grp"><span>Hixly Research Project</span></div>
             </div>

             <script>
               (function(){
                 var pad=function(n){return (n<10?'0':'')+n;};
                 var tick=function(){
                   var d=new Date();
                   var h=d.getHours(); var ampm=h>=12?'PM':'AM'; h=h%12; if(h===0)h=12;
                   document.getElementById('hud-clock').textContent=pad(h)+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+' '+ampm;
                   var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
                   document.getElementById('hud-date').textContent=mo+' '+pad(d.getDate())+' '+d.getFullYear();
                 };
                 tick(); setInterval(tick,1000);
               })();
             </script>
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
  async navigate(rawUrl: string): Promise<string | null> {
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
    const wc = this.view.webContents;
    try {
      await wc.loadURL(safe);
      const loaded = await this.waitForMainLoad(wc, 15000);
      if (!loaded) {
        console.warn(`[BrowserSurface] Timed out waiting for load: ${safe}`);
      }
    } catch (err) {
      console.warn('[BrowserSurface] loadURL failed:', err);
      return null;
    }
    return safe;
  }

  /** Wait for the main frame to finish loading (or fail). */
  private waitForMainLoad(wc: import('electron').WebContents, timeoutMs: number): Promise<boolean> {
    if (wc.isDestroyed()) return Promise.resolve(false);
    if (!wc.isLoading()) return Promise.resolve(true);

    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        wc.removeListener('did-finish-load', onLoad);
        wc.removeListener('did-fail-load', onFail);
      };
      const onLoad = () => {
        cleanup();
        resolve(true);
      };
      const onFail = () => {
        cleanup();
        resolve(false);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      wc.once('did-finish-load', onLoad);
      wc.once('did-fail-load', onFail);
    });
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

  /** Page metadata from the injected DOM agent (viewport size, scroll, URL). */
  async getPageInfo(): Promise<{ innerWidth: number; innerHeight: number; url: string } | null> {
    await this.injectAgent();
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      const result = await wc.executeJavaScript('window.__huncho && window.__huncho.info()');
      if (!result || typeof result !== 'object') return null;
      const info = result as { innerWidth?: number; innerHeight?: number; url?: string };
      return {
        innerWidth: info.innerWidth ?? 0,
        innerHeight: info.innerHeight ?? 900,
        url: info.url ?? '',
      };
    } catch (err) {
      console.warn('[BrowserSurface] getPageInfo failed:', err);
      return null;
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

  /** Push Huncho voice state to the in-page diamond (waveform / spinner). */
  setVoiceState(state: VoiceState): void {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript(
      `window.__huncho && window.__huncho.setVoiceState && window.__huncho.setVoiceState(${JSON.stringify(state)})`,
    ).catch(() => { /* non-fatal */ });
  }

  /** Mic level for reactive waveform bars on the in-page diamond. */
  setAudioLevel(level: number): void {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const clamped = Math.max(0, Math.min(1, level));
    wc.executeJavaScript(
      `window.__huncho && window.__huncho.setAudioLevel && window.__huncho.setAudioLevel(${clamped})`,
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

  /** Resolve an element by visible label text (fuzzy match against the live map). */
  async findElementByLabel(label: string): Promise<{ n: number; text: string; type: string } | null> {
    await this.injectAgent();
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      const out = await wc.executeJavaScript(
        `window.__huncho && window.__huncho.findByLabel && window.__huncho.findByLabel(${JSON.stringify(label)})`,
      );
      return out && typeof out.n === 'number' ? out : null;
    } catch {
      return null;
    }
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
  async captureScreenshotBase64(): Promise<BrowserScreenshot | null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    try {
      const img = await wc.capturePage();
      const { width, height } = img.getSize();
      return {
        base64: img.toJPEG(72).toString('base64'),
        width,
        height,
      };
    } catch (err) {
      console.warn('[BrowserSurface] capturePage failed:', err);
      return null;
    }
  }

  /** Fly the in-page diamond to a page coordinate (from browser screenshot POINT tags). */
  async flyCursorTo(x: number, y: number, label: string): Promise<void> {
    await this.injectAgent();
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    await wc.executeJavaScript(
      `window.__huncho && window.__huncho.flyToPoint(${Math.round(x)}, ${Math.round(y)}, ${JSON.stringify(label)})`,
    );
  }

  /** Resume cursor-follow after a POINT flight completes. */
  async returnCursorToFollow(): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    await wc.executeJavaScript(
      'window.__huncho && window.__huncho.returnCursorToFollow && window.__huncho.returnCursorToFollow()',
    ).catch(() => { /* non-fatal */ });
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
