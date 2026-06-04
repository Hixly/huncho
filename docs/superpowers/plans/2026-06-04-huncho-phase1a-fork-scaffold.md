# Huncho Phase 1A — Fork & Scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Huncho repo as a working fork of Duxy under the new identity — it builds, runs, and the existing voice loop works as "Huncho" — and add a test harness so Plans 1B–1D can be built test-first.

**Architecture:** Copy Duxy's source (not its build output or `node_modules`) into the existing `huncho/` repo, rebrand all identity strings (`Duxy` → `Huncho`, `com.duxy.app` → `com.huncho.app`), fix one Windows-only dev script, add Vitest, and swap the overlay's duck SVG for the glowing gold Huncho diamond. No behavioral changes to the voice pipeline in this plan — actuation arrives in 1B–1D.

**Tech Stack:** Electron 32 + TypeScript 5.5 + React 18 (main/preload via `tsc`, two renderers via Vite), Vitest for tests, electron-builder for packaging. Windows host (PowerShell).

**Source of truth:** Duxy lives at `C:\Users\oHixo\OneDrive\Desktop\Claude.me\duxy`. Huncho repo root is `C:\Users\oHixo\Noxservo Coding\huncho` (already git-init'd; contains `docs/` and `assets/branding/`).

---

## File Structure (after this plan)

```
huncho/
├─ src/
│  ├─ main/            # 15 modules forked from Duxy (index, CompanionManager, ClaudeAPIClient, …)
│  ├─ renderer/
│  │  ├─ overlay/      # OverlayView.tsx (duck SVG → Huncho diamond), main.tsx, index.html
│  │  └─ panel/        # App.tsx, main.tsx, index.html, components/
│  └─ shared/
│     ├─ ipc-types.ts
│     └─ __tests__/config.test.ts   # NEW — first test, proves harness + rebrand
├─ worker/             # Cloudflare worker source (no node_modules)
├─ assets/             # forked Duxy assets + assets/branding/ (Huncho)
├─ docs/superpowers/{specs,plans}/  # already present
├─ package.json        # rebranded
├─ tsconfig*.json, vite.config.*.ts, electron-builder.yml  # forked
├─ vitest.config.ts    # NEW
└─ .gitignore          # NEW
```

Responsibilities are unchanged from Duxy (the memory/spec document them); this plan only relocates + rebrands them and adds the test harness.

---

### Task 1: Fork Duxy's source into the Huncho repo (source only)

**Files:**
- Create: everything under `huncho/src/`, `huncho/worker/` (minus `node_modules`), `huncho/assets/` (merge), and root config files, copied from Duxy.

- [ ] **Step 1: Copy source with robocopy (excludes build output & deps)**

Run (PowerShell):
```powershell
$src = "C:\Users\oHixo\OneDrive\Desktop\Claude.me\duxy"
$dst = "C:\Users\oHixo\Noxservo Coding\huncho"
robocopy $src $dst /E /XD node_modules dist release .git ".vite"
"robocopy exit code: $LASTEXITCODE (0-7 = success)"
```
Expected: prints `robocopy exit code: 1` (or any value 0–7). **Codes 1–7 mean success** (files copied); only ≥8 is a real error.

- [ ] **Step 2: Verify the source landed and deps did NOT**

Run:
```powershell
Test-Path "C:\Users\oHixo\Noxservo Coding\huncho\src\main\CompanionManager.ts"   # expect True
Test-Path "C:\Users\oHixo\Noxservo Coding\huncho\src\main\node_modules"           # expect False
Test-Path "C:\Users\oHixo\Noxservo Coding\huncho\package.json"                    # expect True
Test-Path "C:\Users\oHixo\Noxservo Coding\huncho\worker\node_modules"             # expect False
```
Expected: `True`, `False`, `True`, `False`.

- [ ] **Step 3: Confirm the design docs are still intact (robocopy must not have purged them)**

Run:
```powershell
Test-Path "C:\Users\oHixo\Noxservo Coding\huncho\docs\superpowers\specs\2026-06-04-huncho-design.md"  # expect True
Test-Path "C:\Users\oHixo\Noxservo Coding\huncho\assets\branding\BRAND.md"                            # expect True
```
Expected: `True`, `True`. (robocopy without `/MIR`/`/PURGE` only adds files — it will not delete these.)

---

### Task 2: Add `.gitignore`

**Files:**
- Create: `huncho/.gitignore`

- [ ] **Step 1: Write `.gitignore`**

```gitignore
# deps & build output
node_modules/
dist/
release/
.vite/

# env & logs
.env
.env.*
*.log

# OS
Thumbs.db
.DS_Store
```

- [ ] **Step 2: Verify nothing huge is staged**

Run:
```powershell
git -C "C:\Users\oHixo\Noxservo Coding\huncho" add -A --dry-run | Select-String "node_modules"
```
Expected: **no output** (node_modules is ignored).

- [ ] **Step 3: Commit the fork**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add -A
git -C $d commit -m "Fork Duxy source into Huncho repo (source only) + .gitignore"
```

---

### Task 3: Install dependencies & baseline build

- [ ] **Step 1: Install**

Run:
```powershell
npm install --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: completes; `huncho/node_modules/` and `package-lock.json` created.

- [ ] **Step 2: Build all three bundles**

Run:
```powershell
npm run build --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: `build:main` (tsc) → `dist/main/*.js`, `build:panel` and `build:overlay` (vite) → `dist/` renderer assets, no TypeScript errors.

- [ ] **Step 3: Verify build output exists**

Run:
```powershell
Test-Path "C:\Users\oHixo\Noxservo Coding\huncho\dist\main\index.js"   # expect True
```
Expected: `True`. (If `build:main` fails on a missing `tsconfig.main.json`, it was excluded by mistake — re-run Task 1; robocopy copies all root `tsconfig*.json`.)

- [ ] **Step 4: Commit the lockfile**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add package-lock.json
git -C $d commit -m "Add package-lock from baseline install"
```

---

### Task 4: Rebrand identity (Duxy → Huncho)

**Files:**
- Modify: `huncho/package.json`
- Modify: `huncho/src/main/config.ts`
- Modify (text replace): all user-facing `Duxy` strings under `huncho/src/` and `huncho/electron-builder.yml`

- [ ] **Step 1: Rebrand `package.json` (exact edits)**

In `huncho/package.json`, change:
```json
  "name": "duxy",
  "description": "Your Windows AI companion — voice-powered assistant with screen awareness",
```
to:
```json
  "name": "huncho",
  "description": "Huncho — your personal hands-free AI assistant that drives the browser by voice",
```
And in the `"build"` block change:
```json
    "appId": "com.duxy.app",
    "productName": "Duxy",
    "copyright": "Copyright © 2026 Duxy.Tech",
```
to:
```json
    "appId": "com.huncho.app",
    "productName": "Huncho",
    "copyright": "Copyright © 2026 Huncho",
```
And:
```json
      "artifactName": "Duxy-Setup-${version}.exe"
```
to:
```json
      "artifactName": "Huncho-Setup-${version}.exe"
```
And:
```json
      "shortcutName": "Duxy"
```
to:
```json
      "shortcutName": "Huncho"
```

- [ ] **Step 2: Rebrand the system prompt name in `config.ts`**

In `huncho/src/main/config.ts`, replace the opening of `systemPrompt`:
```
  systemPrompt: `You are Duxy, an AI guide and Windows desktop assistant with a duck mascot that physically flies to locations on screen.
```
with:
```
  systemPrompt: `You are Huncho, an AI guide and Windows desktop assistant with a glowing diamond mascot that physically flies to locations on screen.
```
> Leave the rest of the prompt (including the "cannot click" hard limit) unchanged — actuation is added in Plan 1D, which rewrites this prompt. Leave `workerBaseURL` pointed at the existing `duxy-worker` URL for now (shared dev proxy; a dedicated `huncho-worker` is a later task).

- [ ] **Step 3: Replace remaining user-facing "Duxy" strings in the app**

Run (PowerShell — capital-D only, so the lowercase `duxy-worker` URL is preserved):
```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
Get-ChildItem "$d\src","$d\electron-builder.yml" -Recurse -Include *.ts,*.tsx,*.html,*.yml |
  ForEach-Object {
    (Get-Content $_.FullName -Raw) -creplace 'Duxy','Huncho' |
      Set-Content $_.FullName -Encoding utf8
  }
```

- [ ] **Step 4: Verify the only remaining "duxy" is the worker URL**

Run:
```powershell
Select-String -Path "C:\Users\oHixo\Noxservo Coding\huncho\src\*","C:\Users\oHixo\Noxservo Coding\huncho\src\**\*" -Pattern "duxy" -CaseSensitive:$false |
  Select-Object Path, LineNumber, Line
```
Expected: the **only** match is `workerBaseURL: 'https://duxy-worker.matthixon.workers.dev'` in `config.ts`. If anything else matches, fix it.

- [ ] **Step 5: Rebuild to confirm nothing broke**

Run:
```powershell
npm run build --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: clean build, no errors.

- [ ] **Step 6: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add -A
git -C $d commit -m "Rebrand identity Duxy -> Huncho (package, app id, system prompt, UI strings)"
```

---

### Task 5: Fix the Windows-incompatible dev script

**Files:**
- Modify: `huncho/package.json`

Duxy's `"start:dev": "NODE_ENV=development electron ."` uses bash-style inline env vars, which fail in PowerShell/cmd.

- [ ] **Step 1: Add `cross-env`**

Run:
```powershell
npm install --prefix "C:\Users\oHixo\Noxservo Coding\huncho" --save-dev cross-env
```

- [ ] **Step 2: Edit the script**

In `huncho/package.json` change:
```json
    "start:dev": "NODE_ENV=development electron ."
```
to:
```json
    "start:dev": "cross-env NODE_ENV=development electron ."
```

- [ ] **Step 3: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add package.json package-lock.json
git -C $d commit -m "Make start:dev cross-platform via cross-env"
```

---

### Task 6: Add the Vitest test harness + first test

**Files:**
- Create: `huncho/vitest.config.ts`
- Modify: `huncho/package.json` (scripts)
- Create: `huncho/src/shared/__tests__/config.test.ts`

- [ ] **Step 1: Install Vitest**

Run:
```powershell
npm install --prefix "C:\Users\oHixo\Noxservo Coding\huncho" --save-dev vitest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

Add to `"scripts"`:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Write the first test (proves harness + rebrand)**

Create `huncho/src/shared/__tests__/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DUXY_CONFIG } from '../../main/config';

describe('Huncho config', () => {
  it('identifies as Huncho, not Duxy, in the system prompt', () => {
    expect(DUXY_CONFIG.systemPrompt).toContain('You are Huncho');
    expect(DUXY_CONFIG.systemPrompt).not.toContain('You are Duxy');
  });

  it('has a worker base URL and a default model', () => {
    expect(DUXY_CONFIG.workerBaseURL).toMatch(/^https:\/\//);
    expect(DUXY_CONFIG.defaultModel.length).toBeGreaterThan(0);
  });
});
```
> Note: the exported const is still named `DUXY_CONFIG`; renaming it is optional churn touching many imports — leave it for now (it's internal). The test asserts the *user-facing* identity, which is what matters.

- [ ] **Step 5: Run the test**

Run:
```powershell
npm test --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: **2 passed**. (If `not.toContain('You are Duxy')` fails, Task 4 Step 2 wasn't applied.)

- [ ] **Step 6: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add -A
git -C $d commit -m "Add Vitest harness + config identity test"
```

---

### Task 7: Swap the overlay's duck SVG for the glowing gold Huncho diamond

**Files:**
- Modify: `huncho/src/renderer/overlay/OverlayView.tsx` (replace the duck `<svg>` markup + add glow)

- [ ] **Step 1: Read the overlay to locate the duck SVG**

Open `huncho/src/renderer/overlay/OverlayView.tsx` and find the JSX block that renders the duck (an inline `<svg>` with the duck body/beak/glasses, ~28px). Note the wrapping element and any width/height/transform props so the diamond drops into the same slot.

- [ ] **Step 2: Replace the duck `<svg>` with the Huncho diamond**

Use this markup (keep the surrounding wrapper/refs that positioned the duck):
```tsx
<svg width="28" height="40" viewBox="0 0 24 40" style={{ filter: 'url(#huncho-glow)' }}>
  <defs>
    <linearGradient id="huncho-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#F2D17A" />
      <stop offset="55%" stopColor="#C9A24B" />
      <stop offset="100%" stopColor="#8C6A2A" />
    </linearGradient>
    <filter id="huncho-glow" x="-75%" y="-75%" width="250%" height="250%">
      <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor="#F2C45A" floodOpacity="0.95" />
      <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#C9A24B" floodOpacity="0.6" />
    </filter>
  </defs>
  {/* outer elongated diamond (the crown's center peak) */}
  <path d="M12 1 L19 14 L12 39 L5 14 Z"
        fill="url(#huncho-gold)" stroke="#3A2A0E" strokeWidth="0.8" strokeLinejoin="round" />
  {/* center ridge */}
  <path d="M12 1 L12 39" stroke="#FFF2C8" strokeWidth="0.7" opacity="0.85" />
  {/* upper facet */}
  <path d="M5 14 L12 18 L19 14" fill="none" stroke="#FFF2C8" strokeWidth="0.6" opacity="0.6" />
</svg>
```
The `#huncho-glow` filter gives the gold core + bright amber halo; the dark `stroke` is the thin edge that keeps it legible on white pages (per BRAND.md).

- [ ] **Step 3: Rebuild the overlay**

Run:
```powershell
npm run build:overlay --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```
Expected: clean Vite build.

- [ ] **Step 4: Commit**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d add src/renderer/overlay/OverlayView.tsx
git -C $d commit -m "Replace duck sprite with glowing gold Huncho diamond"
```

---

### Task 8: Milestone smoke test (manual) — "Huncho runs"

No code. This is the acceptance check for Plan 1A.

- [ ] **Step 1: Launch**

Run:
```powershell
npm start --prefix "C:\Users\oHixo\Noxservo Coding\huncho"
```

- [ ] **Step 2: Verify the full voice loop works under the new identity**
  - App launches; tray icon present; panel opens as "Huncho".
  - The **glowing gold diamond** follows the cursor (not the duck).
  - Press **Ctrl+Shift+Space**, speak a question, release/finish → transcript appears → Claude responds in the panel → TTS speaks the answer → the diamond flies to any `[POINT]` location and returns.
  - No "Duxy" text anywhere in the UI.

- [ ] **Step 3: Tag the milestone**

```powershell
$d = "C:\Users\oHixo\Noxservo Coding\huncho"
git -C $d tag phase-1a-complete
```

**Done when:** Huncho is a clean, building, running fork with the gold diamond and an intact voice loop — ready for Plan 1B (BrowserSurface).

---

## Self-Review

**Spec coverage (vs §4.1 "Reused from Duxy" + branding):** Fork/relocate of all reused modules ✓ (Task 1); identity rebrand ✓ (Task 4); cursor companion = code-rendered glowing gold diamond ✓ (Task 7, matches BRAND.md decision); test harness for downstream TDD ✓ (Task 6). Capability stack (BrowserSurface/Perception/Hands/AgentLoop/PurchaseGate) is intentionally **out of scope** for 1A — it's Plans 1B–1D.

**Placeholder scan:** No TBD/TODO steps; every edit shows exact before/after or exact file content; every run step has an expected result. The one "Read to locate" step (Task 7 Step 1) is a genuine inspection step, not a placeholder — the replacement markup is fully specified.

**Type/name consistency:** Test imports `DUXY_CONFIG` from `../../main/config` — matches the un-renamed export (noted deliberately). Glow/gradient filter ids (`huncho-glow`, `huncho-gold`) are defined and referenced within the same SVG. Worker URL deliberately left as `duxy-worker` and called out in two places consistently.

**Known follow-ups (not 1A):** deploy a dedicated `huncho-worker`; optionally rename the `DUXY_CONFIG` symbol; replace `assets/icon.ico` with the Huncho icon once delivered.
