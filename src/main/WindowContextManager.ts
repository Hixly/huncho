import { execFile } from 'child_process';

export interface WindowContext {
  app: string;   // e.g. "Code", "chrome", "slack"
  title: string; // e.g. "App.tsx - duxy - Visual Studio Code"
}

// PowerShell script: get foreground window process name + title
// Uses P/Invoke via Add-Type — no extra packages needed
const PS_SCRIPT = `
try {
  Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);' -Name U -Namespace W -ErrorAction Stop | Out-Null
  $h = [W.U]::GetForegroundWindow()
  $p = 0u
  [W.U]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if ($proc) { Write-Output "$($proc.ProcessName)|||$($proc.MainWindowTitle)" } else { Write-Output "|||" }
} catch { Write-Output "|||" }
`.trim();

const IGNORED_APPS = new Set(['electron', 'duxy', 'explorer']);

export function captureActiveWindow(): Promise<WindowContext> {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PS_SCRIPT],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({ app: '', title: '' });
          return;
        }

        const parts = stdout.trim().split('|||');
        const app = (parts[0] ?? '').trim().replace(/\.exe$/i, '');
        const title = (parts[1] ?? '').trim();

        // Filter out Duxy's own windows
        if (IGNORED_APPS.has(app.toLowerCase())) {
          resolve({ app: '', title: '' });
          return;
        }

        console.log(`[WindowContext] Active: ${app} — "${title}"`);
        resolve({ app, title });
      }
    );
  });
}
