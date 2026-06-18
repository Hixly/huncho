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
        /* Center the diamond on (left,top); offset is applied in JS to match
           the desktop overlay duck's down-right stagger from the cursor tip. */
        transform: translate(-50%, -50%);
        transition: opacity 0.2s ease;
        filter: drop-shadow(0 0 4px rgba(120,120,130,0.55)) drop-shadow(0 0 2px rgba(0,0,0,0.5));
        will-change: top, left;
        opacity: 0;
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
    const wrap = document.createElement('div');
    wrap.id = CURSOR_ID;

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

    // Target (where the cursor is, with stagger offset) vs current (where the
    // diamond actually is). The render loop lerps current → target so the
    // diamond trails behind the cursor — same lazy-follow feel as the
    // desktop overlay duck.
    const OFFSET_X = 22;
    const OFFSET_Y = 14;
    const FOLLOW_SPEED = 0.018; // Matches the desktop overlay duck — heavy trail
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const current = { x: target.x, y: target.y };
    let hasMoved = false;
    let isOverPage = false;      // boolean state — set via mouseenter / mouseleave
    let forcedHidden = false;    // set by main process via setCursorOnPage(false)

    const move = (e) => {
      target.x = e.clientX + OFFSET_X;
      target.y = e.clientY + OFFSET_Y;
      if (!hasMoved) {
        hasMoved = true;
        current.x = target.x;
        current.y = target.y;
      }
      isOverPage = true;
    };
    const enter = () => { isOverPage = true; };
    const leave = (e) => {
      // Ignore "fake" mouseleave events that fire when the cursor moves to a
      // child element with relatedTarget === null is the page boundary.
      if (e && e.relatedTarget) return;
      isOverPage = false;
    };
    window.addEventListener('mousemove', move, { passive: true, capture: true });
    document.documentElement.addEventListener('mouseenter', enter, { passive: true });
    document.documentElement.addEventListener('mouseleave', leave, { passive: true });
    window.addEventListener('blur', () => { isOverPage = false; });
    window.addEventListener('focus', () => { if (!document.getElementById(CURSOR_ID)) installCursor(); });

    // Main process pushes this to forcibly hide while the OS cursor is over
    // the floating panel — even if the browser's own mouseleave didn't fire.
    window.__hunchoCursorForceHidden = (v) => { forcedHidden = !!v; };

    // Render loop — lerps toward target, opacity is purely based on a boolean
    // "is the OS cursor over this page" state (NOT idle timing). That way the
    // diamond stays visible when you stop moving on the page, but hides
    // instantly when you cross onto the panel or another window.
    function tick() {
      current.x += (target.x - current.x) * FOLLOW_SPEED;
      current.y += (target.y - current.y) * FOLLOW_SPEED;
      wrap.style.left = current.x + 'px';
      wrap.style.top = current.y + 'px';
      wrap.style.opacity = (isOverPage && !forcedHidden && hasMoved) ? '1' : '0';
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
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
    // Scroll into view first
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Native click
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
    const px = typeof amount === 'number' ? amount : Math.max(200, Math.floor(window.innerHeight * 0.7));
    const map = { up: -px, down: px, top: -1e9, bottom: 1e9 };
    const dy = map[direction] != null ? map[direction] : px;
    window.scrollBy({ top: dy, behavior: 'smooth' });
    return { ok: true, dy };
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
    type: (n, text, enter) => typeN(n, text, enter),
    scroll: (dir, amt) => scrollPage(dir, amt),
    read: () => readPage(),
    setBadgesVisible: (v) => { badgesVisible = !!v; numberAll(); return { ok: true, v: badgesVisible }; },
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
    info: () => ({ url: location.href, title: document.title, scrollY: window.scrollY, scrollH: document.documentElement.scrollHeight }),
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
      'Click an interactive element on the current page by its numbered badge. Use the element map provided in the most recent screenshot. Returns the text of the element that was clicked.',
    input_schema: {
      type: 'object',
      properties: {
        n: { type: 'integer', description: 'The number of the element to click (from the element map).' },
        reason: { type: 'string', description: 'Short human-readable reason — e.g. "click the search button".' },
      },
      required: ['n'],
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
