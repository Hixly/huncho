# Huncho — Brand Guide

> Source: logo guide sheet delivered 2026-06-04. This doc is the written record; the
> raster source files should live alongside it (see **Asset files** below).

## The mark
A **geometric crown** built from sharp, angular spikes, with a negative-space **"H"**
formed in the center. The crown's central peak is a **tall elongated diamond** — this
center diamond is the basis for the **cursor companion sprite** (the follow-the-cursor
icon, Huncho's equivalent of Duxy's duck).

- Style: thin **luminous gold** line-art, premium / futuristic **HUD + blueprint** feel.
- Always reads as a crown ("head honcho / the boss") with the hidden H.

## Wordmark
- "**Huncho**" in a modern **geometric sans-serif**.
- Fill: gold, sometimes a **gold → silver/white gradient**; often paired with a small
  gold underline accent.
- Lockups: stacked (mark over wordmark) and horizontal (mark left of wordmark).

## Color palette (approximate — refine from source files)
| Token | Hex (approx) | Use |
|---|---|---|
| Huncho Gold (primary) | `#C9A24B` | the mark, accents |
| Bright gold (highlight) | `#F2D17A` | glow, highlights |
| Deep gold (shadow) | `#8C6A2A` | bevel/depth |
| Near-black (bg) | `#0B0B0D` | primary background |
| Charcoal | `#141417` | panels/tiles |
| Off-white (wordmark tip) | `#EDEDED` | gradient end on wordmark |

## Variations in the guide sheet
1. **Blueprint** — gold mark on grid + wordmark (gold→silver)
2. **App icon** — glossy rounded-square dark tile, gold outline crown
3. **HUD ring** — concentric dotted circles around the mark
4. **Clean line** — minimal outline mark + wordmark
5. **Geometric blueprint** linework variant
6. **3D polished gold** extruded mark
7. **Embossed / deboss** dark-on-dark
8. **3D gold** on textured black
9. **Business card** mockup
10. **Embossed surface** mockup + wordmark
11. **Phone app-icon** mockup
12. **Icon scaling set** (large → small rounded tiles) — legibility at size
13. **Horizontal lockup** (mark + wordmark)
14. **Tech / circuit banner** with small crown in HUD ring

## Usage notes
- Default surface is **dark**; the gold mark needs a dark or charcoal background to pop.
- App icon = the crown on a rounded-square charcoal tile (variation #2/#11).
- Cursor sprite = the **center diamond** of the crown, **rendered as an inline SVG in code**
  (NOT a raster asset — same approach as Duxy's code-drawn duck). Given a **brand-gold glow** (gold core + bright amber halo + thin dark edge for white-page legibility)
  to stand out next to the cursor; glow is a tunable CSS/SVG filter. Animated states
  (idle pulse / tilt-to-point / success flash) are done in code.

## Asset files (drop the raster sources here)
Place the exported images in this folder (`assets/branding/`) with these names so the
app and docs can reference them:
- `huncho-logo-guide.png` — the full guide sheet (the image delivered 2026-06-04)
- `huncho-logo.png` — primary stacked logo (mark + wordmark), transparent bg
- `huncho-mark.png` — crown mark only, transparent bg
- `huncho-appicon.png` — rounded-square app icon (1024×1024)
- `icon.ico` — Windows app icon (for electron-builder; replaces Duxy's)

(No cursor-sprite PNG needed — the cursor companion is a code-rendered inline SVG of the
center diamond, see Usage notes.)
