import React from 'react';

/** Chrome elongated diamond — matches the in-page cursor mascot and overlay. */
export const HunchoDiamond: React.FC<{ width?: number; height?: number }> = ({
  width = 24,
  height = 40,
}) => {
  const uid = React.useId().replace(/:/g, '');
  const chromeId = `hc-${uid}`;
  const specId = `hs-${uid}`;
  const glowId = `hg-${uid}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 40"
      style={{ display: 'block', filter: `url(#${glowId})` }}
      aria-hidden
    >
      <defs>
        <linearGradient id={chromeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#e6e6e6" />
          <stop offset="48%" stopColor="#2a2a34" />
          <stop offset="62%" stopColor="#5a5a64" />
          <stop offset="85%" stopColor="#c8c8c0" />
          <stop offset="100%" stopColor="#7a7a74" />
        </linearGradient>
        <linearGradient id={specId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.8" floodColor="#000000" floodOpacity="0.45" />
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#ffffff" floodOpacity="0.4" />
        </filter>
      </defs>
      <path
        d="M12 1 L19 14 L12 39 L5 14 Z"
        fill={`url(#${chromeId})`}
        stroke="#0a0a0e"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M12 1 L12 39" stroke={`url(#${specId})`} strokeWidth="1.2" opacity="0.95" />
      <path d="M5 14 L12 17 L19 14" fill="none" stroke="#ffffff" strokeWidth="0.7" opacity="0.85" />
      <path d="M5 14 L12 22 L19 14" fill="none" stroke="#1a1a1e" strokeWidth="0.5" opacity="0.5" />
    </svg>
  );
};
