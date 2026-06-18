import { EventEmitter } from 'events';
import { globalShortcut } from 'electron';

export class GlobalHotkeyMonitor extends EventEmitter {
  private pttActive = false;
  private started = false;
  private lastToggle = 0;

  constructor() {
    super();
  }

  start(): void {
    if (this.started) return;

    // Use Electron's built-in globalShortcut — much more reliable than uiohook
    const registered = globalShortcut.register('Ctrl+H', () => {
      // Debounce: ignore if toggled less than 600ms ago
      const now = Date.now();
      if (now - this.lastToggle < 600) return;
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

  // Called after an interrupt so the next Ctrl+H correctly starts a new conversation
  // instead of firing a stale pttRelease that does nothing.
  resetPttState(): void {
    this.pttActive = false;
    this.lastToggle = Date.now(); // absorb the interrupt press into the debounce window
  }

  // Fallback toggle — call this from any before-input-event handler if needed.
  // Shares the same debounce + pttActive flag as the OS-level globalShortcut handler.
  handleHotkey(): void {
    const now = Date.now();
    if (now - this.lastToggle < 600) return;
    this.lastToggle = now;
    if (!this.pttActive) {
      this.pttActive = true;
      console.log('[GlobalHotkeyMonitor] Ctrl+H (fallback) → START listening');
      this.emit('pttPress');
    } else {
      this.pttActive = false;
      console.log('[GlobalHotkeyMonitor] Ctrl+H (fallback) → STOP listening');
      this.emit('pttRelease');
    }
  }

  /** @deprecated use handleHotkey() */
  handleAltD(): void { this.handleHotkey(); }

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

