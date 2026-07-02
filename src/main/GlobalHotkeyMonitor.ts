import { EventEmitter } from 'events';
import { globalShortcut } from 'electron';

/** Ignore duplicate Ctrl+H within this window (globalShortcut + before-input-event). */
const HOTKEY_DEDUPE_MS = 180;
/** Minimum gap between accepted toggles. */
const HOTKEY_TOGGLE_MS = 320;

export class GlobalHotkeyMonitor extends EventEmitter {
  private pttActive = false;
  private started = false;
  private lastToggle = 0;
  private lastHandledAt = 0;

  constructor() {
    super();
  }

  start(): void {
    if (this.started) return;

    const registered = globalShortcut.register('Ctrl+H', () => {
      this.handleHotkey();
    });

    if (registered) {
      this.started = true;
      console.log('[GlobalHotkeyMonitor] Ready — press Ctrl+H to toggle listening');
    } else {
      console.error('[GlobalHotkeyMonitor] Failed to register Ctrl+H — another app may have it');
    }
  }

  stop(): void {
    if (!this.started) return;
    globalShortcut.unregisterAll();
    this.started = false;
  }

  resetPttState(): void {
    this.pttActive = false;
    this.lastToggle = Date.now();
    this.lastHandledAt = Date.now();
  }

  /**
   * Single entry for Ctrl+H — globalShortcut and before-input-event fallbacks
   * must all call this so double-fires are deduped.
   */
  handleHotkey(): void {
    const now = Date.now();
    if (now - this.lastHandledAt < HOTKEY_DEDUPE_MS) {
      return;
    }
    if (now - this.lastToggle < HOTKEY_TOGGLE_MS) {
      return;
    }

    this.lastHandledAt = now;
    this.lastToggle = now;

    if (!this.pttActive) {
      this.pttActive = true;
      console.log('[GlobalHotkeyMonitor] Ctrl+H → START listening');
      this.emit('pttPress');
    } else {
      this.pttActive = false;
      console.log('[GlobalHotkeyMonitor] Ctrl+H → STOP listening');
      this.emit('pttRelease');
    }
  }

  /** @deprecated use handleHotkey() */
  handleAltD(): void {
    this.handleHotkey();
  }

  simulatePttPress(): void {
    if (!this.pttActive) {
      this.pttActive = true;
      this.emit('pttPress');
    }
  }

  simulatePttRelease(): void {
    if (this.pttActive) {
      this.pttActive = false;
      this.emit('pttRelease');
    }
  }
}
