import React, { useEffect, useRef } from 'react';
import { DS } from './design-system';

interface WaveformDisplayProps {
  level: number; // 0-1
  isActive: boolean;
}

const BAR_COUNT = 12;
// Profile: center bars taller (Clicky-style hump)
const PROFILE = Array.from({ length: BAR_COUNT }, (_, i) => {
  const center = (BAR_COUNT - 1) / 2;
  const dist = Math.abs(i - center) / center;
  return 1 - dist * 0.6; // center=1.0, edges=0.4
});

export const WaveformDisplay: React.FC<WaveformDisplayProps> = ({ level, isActive }) => {
  const animFrameRef = useRef<number>(0);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) {
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.height = '3px';
      });
      return;
    }

    const animate = () => {
      phaseRef.current += 0.08;

      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const profile = PROFILE[i];

        // Audio-reactive component
        const easedLevel = Math.pow(Math.min(level * 2.85, 1), 0.76);
        const reactiveHeight = easedLevel * 18 * profile;

        // Idle pulse (gentle sine bob even when silent)
        const idlePulse = (Math.sin(phaseRef.current + (i / BAR_COUNT) * Math.PI * 2) + 1) / 2 * 3;

        const h = 3 + reactiveHeight + idlePulse;
        bar.style.height = `${h}px`;
      });

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isActive, level]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '3px',
      height: '32px',
      opacity: isActive ? 1 : 0.3,
      transition: 'opacity 0.3s ease',
    }}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          style={{
            width: '3px',
            height: '3px',
            backgroundColor: DS.colors.accent,
            borderRadius: DS.borderRadius.full,
            transition: 'height 0.06s ease',
            alignSelf: 'center',
            boxShadow: `0 0 4px ${DS.colors.accentDim}`,
          }}
        />
      ))}
    </div>
  );
};

