// Huncho Design System — Chrome / Off-White Theme (matches Hixly Research V3)
export const DS = {
  colors: {
    // Backgrounds (layered elevation, light)
    background: '#f4f3ee',     // panel canvas (Hixly bg-primary)
    surface1: '#eae9e4',       // sunken (Hixly bg-secondary)
    surface2: '#edecea',       // elevated (Hixly bg-elevated)
    surface3: '#ffffff',       // floating cards / bubbles (Hixly bg-panel)
    // Legacy alias
    surface: '#eae9e4',
    surfaceHover: '#f0efea',

    // Borders
    border: '#d8d8d0',
    borderLight: '#e4e4dc',

    // Text
    textPrimary: '#1a1a1e',
    textSecondary: '#3a3a3e',
    textMuted: '#8a8a80',

    // Accent — Chrome (replaces duck-yellow)
    accent: '#3a3a3e',                            // chrome
    accentGlow: '#1a1a1e',                        // chrome-bright
    accentLight: '#7a7a74',                       // chrome-dim
    accentDim: 'rgba(58, 58, 62, 0.10)',
    // Chrome gradient — for highlight strokes / hero accents
    chromeGradient: 'linear-gradient(135deg, #4a4a54 0%, #2a2a34 40%, #5a5a64 60%, #3a3a44 100%)',

    // Status
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  },
  borderRadius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '20px',
    full: '9999px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
  },
  typography: {
    fontFamily: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
    sizes: {
      xs: '11px',
      sm: '12px',
      md: '13px',
      lg: '15px',
      xl: '18px',
      xxl: '24px',
    },
    weights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
};

export type DesignSystem = typeof DS;
