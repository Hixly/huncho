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
    const registered = globalShortcut.register('Alt+D', () => {
      // Debounce: ignore if toggled less than 600ms ago
      const now = Date.now();
      if (now - this.lastToggle < 600) return;
      this.lastToggle = now;

      if (!this.pttActive) {
        this.pttActive = true;
        console.log('[GlobalHotkeyMonitor] Alt+D → START listening');
        this.emit('pttPress');
      } else {
        this.pttActive = false;
        console.log('[GlobalHotkeyMonitor] Alt+D → STOP listening');
        this.emit('pttRelease');
      }
    });

    if (registered) {
      this.started = true;
      console.log('[GlobalHotkeyMonitor] Ready — press Alt+D to toggle listening');
    } else {
      console.error('[GlobalHotkeyMonitor] Failed to register Alt+D — another app may have it');
    }
  }

  stop(): void {
    if (!this.started) return;
    globalShortcut.unregisterAll();
    this.started = false;
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

