import { ImageResponse } from 'next/og';

export const alt = 'Huncho — Your computer. Hands off.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const chrome = 'linear-gradient(135deg,#4a4a54 0%,#2a2a34 38%,#7a7a82 55%,#3a3a44 78%,#5a5a64 100%)';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f4f3ee',
          fontFamily: 'serif',
        }}
      >
        <svg width="66" height="105" viewBox="0 0 24 40">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="22%" stopColor="#e6e6e6" />
              <stop offset="48%" stopColor="#2a2a34" />
              <stop offset="62%" stopColor="#5a5a64" />
              <stop offset="85%" stopColor="#c8c8c0" />
              <stop offset="100%" stopColor="#7a7a74" />
            </linearGradient>
          </defs>
          <path d="M12 1 L19 14 L12 39 L5 14 Z" fill="url(#g)" stroke="#0a0a0e" strokeWidth="0.9" />
          <path d="M12 1 L12 39" stroke="#ffffff" strokeWidth="1" opacity="0.85" />
          <path d="M5 14 L12 17 L19 14" fill="none" stroke="#ffffff" strokeWidth="0.6" opacity="0.85" />
        </svg>
        <div
          style={{
            marginTop: 40,
            fontSize: 92,
            fontWeight: 900,
            letterSpacing: '0.4em',
            paddingLeft: '0.4em',
            backgroundImage: chrome,
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          HUNCHO
        </div>
        <div style={{ marginTop: 28, width: 220, height: 1, background: '#3a3a3e', opacity: 0.4 }} />
        <div style={{ marginTop: 28, fontSize: 34, fontWeight: 300, color: '#3a3a3e' }}>
          Your computer. Hands off.
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 17,
            letterSpacing: '0.3em',
            color: '#8a8a80',
            textTransform: 'uppercase',
          }}
        >
          WINDOWS · VOICE-NATIVE · FREE
        </div>
      </div>
    ),
    { ...size },
  );
}
