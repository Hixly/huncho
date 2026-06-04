// Duxy Design System — Golden Duck Yellow Theme
export const DS = {
  colors: {
    // Backgrounds (layered elevation)
    background: '#0c0c0c',
    surface1: '#131313',
    surface2: '#1a1a1a',
    surface3: '#222222',
    // Legacy alias
    surface: '#1a1a1a',
    surfaceHover: '#2a2a2a',

    // Borders
    border: '#2a2a2a',
    borderLight: '#333333',

    // Text
    textPrimary: '#ffffff',
    textSecondary: '#a0a0a0',
    textMuted: '#5a5a5a',

    // Accent — Duck Yellow / Amber
    accent: '#F59E0B',
    accentGlow: '#D97706',
    accentLight: '#FBBF24',
    accentDim: 'rgba(245, 158, 11, 0.15)',

    // Status
    success: '#22c55e',
    warning: '#F59E0B',
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
    fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
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
