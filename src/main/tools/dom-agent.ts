/**
 * Huncho's DOM agent — the "Eyes + Hands" of the browser surface.
 *
 * This file ships a self-contained content script (as a template string) that
 * Huncho injects into whatever page is loaded in the BrowserSurface. The
 * script:
 *   1. Finds every visible interactive element on the page.
 *   2. Stamps each one with a sequential number ID + draws a chrome badge.
 *   3. Exposes a tiny API on window.__huncho for the main process to call via
 *      executeJavaScript: getMap(), click(n), type(n, text, enter?), scroll,
 *      read(), keys(combo), setBadgesVisible(b).
 *
 * The script is idempotent — re-running it re-numbers + repaints. It also
 * sets up a MutationObserver so dynamic pages (React, infinite scroll, etc.)
 * stay tagged.
 *
 * The script is wrapped in an IIFE so it doesn't leak globals beyond
 * window.__huncho. It runs in the page's main world, not an isolated world,
 * so it can use document/element APIs directly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DOM_AGENT_SCRIPT = `
(function () {
  if (window.__huncho && window.__huncho.__version === 1) return; // already installed

  const STYLE_ID = 'huncho-agent-style';
  const BADGE_CLASS = 'huncho-agent-badge';
  const BADGE_HIGHLIGHT_CLASS = 'huncho-agent-highlight';
  const DATA_ATTR = 'data-huncho-id';

  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  let badgesVisible = false;
  const CURSOR_ID = 'huncho-agent-cursor';
  const CURSOR_OFFSET_X = 22;
  const CURSOR_OFFSET_Y = 14;
  const CURSOR_FOLLOW_SPEED = 0.018;

  // Shared cursor state survives DOM reinstalls (Google wiping our node, etc.)
  const CURSOR_STATE = {
    target: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    isOverPage: false,
    forcedHidden: true,
    loopStarted: false,
  };
  const VOICE_UI = { state: 'idle', level: 0, phase: 0 };
  const VOICE_BAR_CLASS = 'huncho-voice-bar';
  const VOICE_DOT_CLASS = 'huncho-voice-dot';
  const VOICE_SPINNER_CLASS = 'huncho-voice-spinner';
  const LABEL_ID = 'huncho-agent-cursor-label';
  const FLY_STATE = { mode: 'follow', progress: 1, startX: 0, startY: 0, endX: 0, endY: 0, label: '' };

  function flyEase(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function updatePointLabel(text) {
    const wrap = document.getElementById(CURSOR_ID);
    if (!wrap) return;
    let el = document.getElementById(LABEL_ID);
    if (!text) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = LABEL_ID;
      el.style.cssText = 'position:absolute;top:26px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,0.9);color:#fff;font:600 11px/1.4 ui-sans-serif,sans-serif;padding:4px 10px;border-radius:6px;border:1px solid rgba(200,200,192,0.45);pointer-events:none;';
      wrap.appendChild(el);
    }
    el.textContent = text;
  }

  function flyToPoint(x, y, label) {
    installCursor();
    numberAll();

    // Prefer the live element map over Claude's screenshot guess — adjacent
    // buttons (Google Search vs I'm Feeling Lucky) are easy to confuse in pixels.
    const matched = label ? findElementByLabel(label) : null;
    if (matched && matched.bbox) {
      x = matched.bbox.x + Math.round(matched.bbox.w / 2);
      y = matched.bbox.y + Math.round(matched.bbox.h / 2);
    }

    FLY_STATE.mode = 'flying';
    FLY_STATE.progress = 0;
    FLY_STATE.startX = CURSOR_STATE.current.x;
    FLY_STATE.startY = CURSOR_STATE.current.y;
    // Land ON the target — do not apply mouse-follow stagger offset here.
    FLY_STATE.endX = x;
    FLY_STATE.endY = y;
    FLY_STATE.label = label || '';
    CURSOR_STATE.isOverPage = true;
    updatePointLabel('');
    return { ok: true, snapped: !!matched, x, y };
  }

  function normalizeLabel(s) {
    return (s || '').toLowerCase().replace(/['"]/g, '').replace(/\\s+/g, ' ').trim();
  }

  function tokenizeLabel(s) {
    return normalizeLabel(s).split(' ').filter((w) => w.length > 2);
  }

  function findElementByLabel(label) {
    const q = normalizeLabel(label);
    if (!q) return null;
    const qw = tokenizeLabel(label);
    if (qw.length === 0) return null;
    let best = null;
    let bestScore = 0;
    for (const e of lastMap) {
      const t = normalizeLabel(e.text);
      if (!t) continue;
      const tw = tokenizeLabel(e.text);
      let score = 0;
      if (t === q) score = 10000;
      else if (t.includes(q) || q.includes(t)) {
        score = 800 + Math.min(t.length, q.length);
      } else {
        const overlap = qw.filter((w) => tw.some((token) => token.includes(w) || w.includes(token))).length;
        const ratio = overlap / qw.length;
        score = overlap * 120 + ratio * 600;
      }
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return bestScore >= 120 ? best : null;
  }

  function returnCursorToFollow() {
    FLY_STATE.mode = 'follow';
    FLY_STATE.progress = 1;
    updatePointLabel('');
    return { ok: true };
  }

  function seedCursorCenter() {
    const cx = (window.innerWidth || 800) / 2;
    const cy = (window.innerHeight || 600) / 2;
    CURSOR_STATE.target.x = cx + CURSOR_OFFSET_X;
    CURSOR_STATE.target.y = cy + CURSOR_OFFSET_Y;
    CURSOR_STATE.current.x = CURSOR_STATE.target.x;
    CURSOR_STATE.current.y = CURSOR_STATE.target.y;
  }

  function applyCursorFrame(wrap) {
    if (FLY_STATE.mode === 'flying') {
      FLY_STATE.progress = Math.min(1, FLY_STATE.progress + 0.05);
      const t = flyEase(FLY_STATE.progress);
      CURSOR_STATE.current.x = FLY_STATE.startX + (FLY_STATE.endX - FLY_STATE.startX) * t;
      CURSOR_STATE.current.y = FLY_STATE.startY + (FLY_STATE.endY - FLY_STATE.startY) * t;
      if (FLY_STATE.progress >= 1) {
        FLY_STATE.mode = 'atTarget';
        updatePointLabel(FLY_STATE.label);
      }
    } else if (FLY_STATE.mode !== 'atTarget') {
      CURSOR_STATE.current.x += (CURSOR_STATE.target.x - CURSOR_STATE.current.x) * CURSOR_FOLLOW_SPEED;
      CURSOR_STATE.current.y += (CURSOR_STATE.target.y - CURSOR_STATE.current.y) * CURSOR_FOLLOW_SPEED;
    }
    wrap.style.left = CURSOR_STATE.current.x + 'px';
    wrap.style.top = CURSOR_STATE.current.y + 'px';
    wrap.style.opacity = (CURSOR_STATE.isOverPage && !CURSOR_STATE.forcedHidden) ? '1' : '0';
  }

  function updateVoiceUi() {
    const wrap = document.getElementById(CURSOR_ID);
    if (!wrap) return;
    wrap.setAttribute('data-voice', VOICE_UI.state === 'idle' ? '' : VOICE_UI.state);
    if (VOICE_UI.state !== 'listening') return;

    VOICE_UI.phase += 0.1;
    const profile = [0.4, 0.7, 1.0, 0.7, 0.4];
    const bars = wrap.querySelectorAll('.' + VOICE_BAR_CLASS);
    bars.forEach((bar, i) => {
      const mic = Math.pow(Math.min(VOICE_UI.level * 2.85, 1), 0.76);
      const idle = (Math.sin(VOICE_UI.phase + i * 1.2) + 1) / 2 * 2;
      bar.style.height = Math.round(3 + mic * 14 * profile[i] + idle) + 'px';
    });
  }

  function ensureCursorLoop() {
    if (CURSOR_STATE.loopStarted) return;
    CURSOR_STATE.loopStarted = true;
    function tick() {
      const wrap = document.getElementById(CURSOR_ID);
      if (wrap) {
        applyCursorFrame(wrap);
        updateVoiceUi();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // --- Styles -------------------------------------------------------------
  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = \`
      .\${BADGE_CLASS} {
        position: fixed;
        z-index: 2147483646;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 4px;
        background: linear-gradient(135deg, #4a4a54 0%, #2a2a34 50%, #5a5a64 100%);
        color: #ffffff;
        font: 600 11px/18px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif;
        text-align: center;
        pointer-events: none;
        box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.4) inset;
        letter-spacing: 0.02em;
        opacity: 0.95;
      }
      .\${BADGE_HIGHLIGHT_CLASS} {
        outline: 2px solid #f59e0b !important;
        outline-offset: 1px;
      }
      #\${CURSOR_ID} {
        position: fixed;
        top: 0; left: 0;
        width: 14px; height: 22px;
        z-index: 2147483647;
        pointer-events: none;
        transform: translate(-50%, -50%);
        transition: opacity 0.2s ease;
        filter: drop-shadow(0 0 4px rgba(120,120,130,0.55)) drop-shadow(0 0 2px rgba(0,0,0,0.5));
        will-change: top, left;
        opacity: 0;
      }
      .huncho-voice-ui {
        position: absolute;
        left: 50%;
        top: -26px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .huncho-voice-bars {
        display: none;
        align-items: center;
        gap: 3px;
        height: 18px;
      }
      .huncho-voice-dots {
        display: none;
        align-items: center;
        gap: 4px;
        height: 18px;
      }
      .\${VOICE_BAR_CLASS} {
        width: 3px;
        height: 4px;
        border-radius: 2px;
        background: #22d3ee;
        box-shadow: 0 0 5px rgba(34, 211, 238, 0.85);
      }
      .\${VOICE_DOT_CLASS} {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #f59e0b;
        box-shadow: 0 0 6px rgba(245, 158, 11, 0.9);
        animation: huncho-dot-pulse 1.1s ease-in-out infinite;
      }
      .\${VOICE_DOT_CLASS}:nth-child(2) { animation-delay: 0.15s; }
      .\${VOICE_DOT_CLASS}:nth-child(3) { animation-delay: 0.3s; }
      .\${VOICE_SPINNER_CLASS} {
        display: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid transparent;
        border-top-color: #22d3ee;
        animation: huncho-spin 0.8s linear infinite;
      }
      #\${CURSOR_ID}[data-voice="listening"] .huncho-voice-bars {
        display: flex;
      }
      #\${CURSOR_ID}[data-voice="responding"] .huncho-voice-dots {
        display: flex;
      }
      #\${CURSOR_ID}[data-voice="processing"] .\${VOICE_SPINNER_CLASS} {
        display: block;
      }
      @keyframes huncho-dot-pulse {
        0%, 100% { opacity: 0.35; transform: scale(0.75); }
        50% { opacity: 1; transform: scale(1.15); }
      }
      @keyframes huncho-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    \`;
    (document.head || document.documentElement).appendChild(s);
  }

  // --- In-page chrome diamond cursor -------------------------------------
  // Rendered inside the page DOM (built with namespaced SVG DOM nodes, no
  // innerHTML) so it can NEVER fall behind the browser window — the desktop
  // overlay window loses z-order on Windows. Tracks the page's own pointer.
  function svgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function installCursor() {
    if (document.getElementById(CURSOR_ID)) return;
    seedCursorCenter();
    const wrap = document.createElement('div');
    wrap.id = CURSOR_ID;

    const voiceUi = document.createElement('div');
    voiceUi.className = 'huncho-voice-ui';
    const barsWrap = document.createElement('div');
    barsWrap.className = 'huncho-voice-bars';
    for (let i = 0; i < 5; i++) {
      const bar = document.createElement('div');
      bar.className = VOICE_BAR_CLASS;
      barsWrap.appendChild(bar);
    }
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'huncho-voice-dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = VOICE_DOT_CLASS;
      dotsWrap.appendChild(dot);
    }
    const spinner = document.createElement('div');
    spinner.className = VOICE_SPINNER_CLASS;
    voiceUi.appendChild(barsWrap);
    voiceUi.appendChild(dotsWrap);
    voiceUi.appendChild(spinner);
    wrap.appendChild(voiceUi);

    const svg = svgEl('svg', { width: '14', height: '22', viewBox: '0 0 24 40' });
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: 'hc-g', x1: '0', y1: '0', x2: '0', y2: '1' });
    [['0%', '#ffffff'], ['22%', '#e6e6e6'], ['48%', '#2a2a34'], ['62%', '#5a5a64'], ['85%', '#c8c8c0'], ['100%', '#7a7a74']]
      .forEach(([off, col]) => grad.appendChild(svgEl('stop', { offset: off, 'stop-color': col })));
    defs.appendChild(grad);
    svg.appendChild(defs);
    svg.appendChild(svgEl('path', { d: 'M12 1 L19 14 L12 39 L5 14 Z', fill: 'url(#hc-g)', stroke: '#0a0a0e', 'stroke-width': '1', 'stroke-linejoin': 'round' }));
    svg.appendChild(svgEl('path', { d: 'M12 1 L12 39', stroke: '#ffffff', 'stroke-width': '1.2', opacity: '0.9' }));
    svg.appendChild(svgEl('path', { d: 'M5 14 L12 17 L19 14', fill: 'none', stroke: '#ffffff', 'stroke-width': '0.7', opacity: '0.85' }));
    wrap.appendChild(svg);
    document.documentElement.appendChild(wrap);

    const move = (e) => {
      CURSOR_STATE.target.x = e.clientX + CURSOR_OFFSET_X;
      CURSOR_STATE.target.y = e.clientY + CURSOR_OFFSET_Y;
      CURSOR_STATE.isOverPage = true;
    };
    const enter = () => { CURSOR_STATE.isOverPage = true; };
    const leave = (e) => {
      if (e && e.relatedTarget) return;
      CURSOR_STATE.isOverPage = false;
    };
    window.addEventListener('mousemove', move, { passive: true, capture: true });
    document.documentElement.addEventListener('mouseenter', enter, { passive: true });
    document.documentElement.addEventListener('mouseleave', leave, { passive: true });
    window.addEventListener('focus', () => {
      if (!document.getElementById(CURSOR_ID)) installCursor();
      CURSOR_STATE.isOverPage = true;
    });

    // Main process pushes this when the OS cursor enters / leaves the browser
    // bounds (e.g. moves over the floating panel). When visible, treat pointer
    // as on-page even if mousemove hasn't fired since a navigation.
    window.__hunchoCursorForceHidden = (hidden) => {
      CURSOR_STATE.forcedHidden = !!hidden;
      if (!hidden) CURSOR_STATE.isOverPage = true;
    };

    ensureCursorLoop();
  }

  function removeBadges() {
    document.querySelectorAll('.' + BADGE_CLASS).forEach((n) => n.remove());
  }

  // --- Visibility check ---------------------------------------------------
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.top > (window.innerHeight || 0)) return false;
    if (r.right < 0 || r.left > (window.innerWidth || 0)) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    return true;
  }

  function getText(el) {
    const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim().slice(0, 80);
    const placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim().slice(0, 80);
    const val = el.value || '';
    if (val) return ('value: ' + val).slice(0, 80);
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 80);
  }

  function getType(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') return 'input:' + (el.type || 'text');
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const role = el.getAttribute && el.getAttribute('role');
    if (role) return 'role:' + role;
    return tag;
  }

  // --- Numbering + badges -------------------------------------------------
  let lastMap = [];

  function numberAll() {
    installStyles();
    removeBadges();
    const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    const visible = all.filter(isVisible);
    // Sort visually: top to bottom, then left to right
    visible.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      if (Math.abs(ra.top - rb.top) > 12) return ra.top - rb.top;
      return ra.left - rb.left;
    });
    const map = [];
    visible.forEach((el, i) => {
      const n = i + 1;
      el.setAttribute(DATA_ATTR, String(n));
      const r = el.getBoundingClientRect();
      const entry = {
        n,
        type: getType(el),
        text: getText(el),
        bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      };
      map.push(entry);
      if (badgesVisible) {
        const badge = document.createElement('div');
        badge.className = BADGE_CLASS;
        badge.textContent = String(n);
        // Position at top-left corner of the element
        badge.style.left = Math.max(0, r.left) + 'px';
        badge.style.top = Math.max(0, r.top - 8) + 'px';
        document.documentElement.appendChild(badge);
      }
    });
    lastMap = map;
    return map;
  }

  function findByNumber(n) {
    return document.querySelector('[' + DATA_ATTR + '="' + n + '"]');
  }

  // --- Actions ------------------------------------------------------------
  function highlight(el) {
    if (!el || !el.classList) return;
    el.classList.add(BADGE_HIGHLIGHT_CLASS);
    setTimeout(() => el.classList.remove(BADGE_HIGHLIGHT_CLASS), 800);
  }

  function clickN(n) {
    const el = findByNumber(n);
    if (!el) return { ok: false, error: 'no_element_for_number_' + n };
    highlight(el);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const tag = (el.tagName || '').toLowerCase();
    const target = (tag === 'a' && el.href) ? el : (el.closest && el.closest('a[href]'));
    if (target && target.href && !String(target.href).startsWith('javascript:')) {
      const startHref = location.href;
      const dest = target.href;
      target.focus();
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
      // Google SERP and some SPAs ignore synthetic clicks — navigate directly.
      setTimeout(function () {
        if (location.href === startHref && dest) {
          window.location.assign(dest);
        }
      }, 80);
      return { ok: true, n, text: getText(target), href: dest };
    }
    if (typeof el.click === 'function') {
      el.click();
    } else {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(ev);
    }
    return { ok: true, n, text: getText(el) };
  }

  function setNativeValue(el, value) {
    const tag = (el.tagName || '').toLowerCase();
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function typeN(n, text, pressEnter) {
    const el = findByNumber(n);
    if (!el) return { ok: false, error: 'no_element_for_number_' + n };
    highlight(el);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const tag = (el.tagName || '').toLowerCase();
    const isField = tag === 'input' || tag === 'textarea' || el.isContentEditable;
    if (!isField) return { ok: false, error: 'element_not_typable' };
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      setNativeValue(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (pressEnter) {
      const evDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      const evUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      el.dispatchEvent(evDown);
      el.dispatchEvent(evUp);
      // If element is a form input, also submit the form
      const form = el.closest && el.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        try { form.requestSubmit(); } catch (_) { /* some frameworks block this */ }
      }
    }
    return { ok: true, n, text };
  }

  function scrollPage(direction, amount) {
    const root = document.scrollingElement || document.documentElement || document.body;
    const viewport = window.innerHeight || 600;
    const step = typeof amount === 'number' ? amount : Math.max(240, Math.floor(viewport * 0.72));
    const startY = root.scrollTop;
    let endY = startY;

    if (direction === 'down') endY = startY + step;
    else if (direction === 'up') endY = startY - step;
    else if (direction === 'top') endY = 0;
    else if (direction === 'bottom') endY = Math.max(0, root.scrollHeight - viewport);
    else endY = startY + step;

    const maxY = Math.max(0, root.scrollHeight - viewport);
    endY = Math.max(0, Math.min(endY, maxY));
    const delta = endY - startY;

    if (Math.abs(delta) < 2) {
      return Promise.resolve({ ok: true, dy: 0, scrollY: startY, skipped: true });
    }

    // Eased animation — ~320–650ms depending on distance (feels like a natural page scroll).
    const duration = Math.min(650, Math.max(320, Math.abs(delta) * 0.45));
    const t0 = performance.now();

    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        root.scrollTop = Math.round(startY + delta * eased);
        if (t < 1) requestAnimationFrame(frame);
        else resolve({ ok: true, dy: delta, scrollY: root.scrollTop, durationMs: Math.round(duration) });
      }
      requestAnimationFrame(frame);
    });
  }

  function readPage() {
    // Get visible text only — strip scripts/styles
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
    const text = (clone.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    return { ok: true, text: text.slice(0, 12000), title: document.title, url: location.href };
  }

  // --- Reactivity ---------------------------------------------------------
  let pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; numberAll(); }, 250);
  }

  const mo = new MutationObserver(() => {
    schedule();
    // Pages like Google rewrite the DOM on results load and can wipe our
    // injected diamond element. Re-install it if it vanished.
    if (!document.getElementById(CURSOR_ID)) installCursor();
    if (!document.getElementById(STYLE_ID)) installStyles();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: false });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);

  // --- Public API ---------------------------------------------------------
  window.__huncho = {
    __version: 1,
    getMap: () => numberAll(),
    lastMap: () => lastMap,
    click: (n) => clickN(n),
    findByLabel: (label) => {
      numberAll();
      const m = findElementByLabel(label);
      return m ? { n: m.n, text: m.text, type: m.type } : null;
    },
    type: (n, text, enter) => typeN(n, text, enter),
    scroll: (dir, amt) => scrollPage(dir, amt),
    read: () => readPage(),
    setBadgesVisible: (v) => {
      // Visual badges stay off — Claude uses the internal numbered map only.
      badgesVisible = false;
      numberAll();
      return { ok: true, v: false };
    },
    showCursor: (v) => {
      installCursor();
      const c = document.getElementById(CURSOR_ID);
      if (c) c.style.opacity = v ? '1' : '0';
      return { ok: true };
    },
    // Main process pushes this when the OS-level cursor enters / leaves the
    // browser surface bounds (e.g. moves over the floating panel). Reliable
    // even when the browser's own mouseleave doesn't fire across windows.
    setCursorOnPage: (v) => {
      if (window.__hunchoCursorForceHidden) window.__hunchoCursorForceHidden(!v);
      return { ok: true };
    },
    setVoiceState: (s) => {
      const allowed = { listening: 1, processing: 1, responding: 1, idle: 1 };
      VOICE_UI.state = (s && allowed[s]) ? s : 'idle';
      if (VOICE_UI.state === 'idle') VOICE_UI.level = 0;
      updateVoiceUi();
      return { ok: true, state: VOICE_UI.state };
    },
    setAudioLevel: (l) => {
      VOICE_UI.level = Math.max(0, Math.min(1, Number(l) || 0));
      return { ok: true };
    },
    flyToPoint: (x, y, label) => flyToPoint(Number(x), Number(y), label),
    returnCursorToFollow: () => returnCursorToFollow(),
    info: () => ({
      url: location.href,
      title: document.title,
      scrollY: window.scrollY,
      scrollH: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }),
  };
  installStyles();
  installCursor();
  numberAll();
})();
`;

/** Tool schemas for Claude's tools[] array. */
export const DOM_TOOLS = [
  {
    name: 'click',
    description:
      'Click an interactive element on the current page by its numbered badge. Use the element map provided in the most recent screenshot. The reason field should quote distinctive visible text from the target element (e.g. the article headline) so Huncho snaps to the correct link on dense pages. Returns the text of the element that was clicked.',
    input_schema: {
      type: 'object',
      properties: {
        n: { type: 'integer', description: 'The number of the element to click (from the element map).' },
        reason: { type: 'string', description: 'Why you are clicking — include distinctive visible text from the element map entry (headline, button label, etc.).' },
      },
      required: ['n', 'reason'],
    },
  },
  {
    name: 'type_text',
    description:
      'Type text into an input or textarea by its numbered badge. Set submit=true to press Enter after typing (e.g. for search boxes). Use the element map to pick the right number.',
    input_schema: {
      type: 'object',
      properties: {
        n: { type: 'integer', description: 'The number of the input/textarea to type into.' },
        text: { type: 'string', description: 'The text to type.' },
        submit: { type: 'boolean', description: 'If true, press Enter after typing (submit the form).' },
        reason: { type: 'string', description: 'Short reason — e.g. "type the search query".' },
      },
      required: ['n', 'text'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page. direction is up/down/top/bottom. Optional amount in pixels (default: ~70% of viewport).',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
        amount: { type: 'integer', description: 'Pixels to scroll. Omit for default.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'read_page',
    description:
      "Return the current page's visible text content, title, and URL. Use when you need to read an article, compare prices, or summarize what's on screen.",
    input_schema: { type: 'object', properties: {} },
  },
];

/** Words that trigger a verbal confirmation before executing a click. */
const DANGER_PATTERNS = [
  /\bbuy\b/i, /\bpurchase\b/i, /\bpay\b/i, /\bcheckout\b/i, /\border\b/i,
  /\bdelete\b/i, /\bremove\b/i, /\btrash\b/i, /\bdestroy\b/i,
  /\bsend\b/i, /\bsubmit\b/i, /\bpost\b/i, /\bpublish\b/i,
  /\bsign\s?up\b/i, /\bsubscribe\b/i, /\bregister\b/i,
  /\bconfirm\b/i, /\bagree\b/i, /\bi\s+accept\b/i,
  /\bunsubscribe\b/i, /\blog\s?out\b/i, /\bsign\s?out\b/i,
];

export function isDangerousAction(elementText: string, reason?: string): boolean {
  const haystack = (elementText + ' ' + (reason || '')).toLowerCase();
  return DANGER_PATTERNS.some((re) => re.test(haystack));
}

export interface DomToolResult {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

export interface ElementMapEntry {
  n: number;
  type: string;
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
}
