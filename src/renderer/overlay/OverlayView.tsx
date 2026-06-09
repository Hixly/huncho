import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VoiceState, CursorPointAtPayload, AudioPowerLevelPayload, CursorPositionPayload } from '../../shared/ipc-types';

const YELLOW = '#F59E0B';
const YELLOW_GLOW = 'rgba(245, 158, 11, 0.5)';

const DUCK_SIZE = 14;        // px
const DUCK_HALF = DUCK_SIZE / 2;
const DUCK_OFFSET_X = 22;   // px right of cursor tip — stays out of click zone
const DUCK_OFFSET_Y = 14;   // px below cursor tip

interface Point { x: number; y: number; }

function quadBezier(p0: Point, cp: Point, p1: Point, t: number): Point {
  const t1 = 1 - t;
  return {
    x: t1 * t1 * p0.x + 2 * t1 * t * cp.x + t * t * p1.x,
    y: t1 * t1 * p0.y + 2 * t1 * t * cp.y + t * t * p1.y,
  };
}

function bezierTangentAngle(p0: Point, cp: Point, p1: Point, t: number): number {
  const t1 = 1 - t;
  const dx = 2 * t1 * (cp.x - p0.x) + 2 * t * (p1.x - cp.x);
  const dy = 2 * t1 * (cp.y - p0.y) + 2 * t * (p1.y - cp.y);
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

function controlPoint(start: Point, end: Point): Point {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
  return { x: midX, y: midY - Math.max(80, dist * 0.35) };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Huncho diamond mascot — glowing gold elongated diamond (center shape of the Huncho crown logo)
const DuckIcon: React.FC = () => (
  <svg width="14" height="22" viewBox="0 0 24 40" style={{ display: 'block', filter: 'url(#huncho-glow)' }}>
    <defs>
      <linearGradient id="huncho-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F2D17A" />
        <stop offset="55%" stopColor="#C9A24B" />
        <stop offset="100%" stopColor="#8C6A2A" />
      </linearGradient>
      <filter id="huncho-glow" x="-75%" y="-75%" width="250%" height="250%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor="#F2C45A" floodOpacity="0.95" />
        <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#C9A24B" floodOpacity="0.6" />
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
);

export const OverlayView: React.FC = () => {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [label, setLabel] = useState('');
  const [showLabel, setShowLabel] = useState(false);

  const displayIndex = window.electronAPI.getDisplayIndex();
  const screenW = window.screen.width;
  const screenH = window.screen.height;

  const duckElRef = useRef<HTMLDivElement | null>(null);
  // Start at screen center — trails in from there on first cursor move
  const posRef = useRef<Point>({ x: screenW / 2, y: screenH / 2 });
  const cursorPosRef = useRef<Point>({ x: screenW / 2, y: screenH / 2 });

  const isFlying = useRef(false);
  const isAtTarget = useRef(false); // waiting at a POINT target for TTS to finish
  const isReturnFlight = useRef(false); // true when flying BACK to cursor (not to a POINT)
  const flightStartRef = useRef<Point>({ x: screenW / 2, y: screenH / 2 });
  const flightTargetRef = useRef<Point | null>(null);
  const flightProgressRef = useRef(1);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scaleRef = useRef(1);

  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const phaseRef = useRef(0);
  const audioLevelRef = useRef(0);
  const voiceStateRef = useRef<VoiceState>('idle');
  const ttsCompleteRef = useRef(false);

  const startFlight = useCallback((from: Point, to: Point, targetLabel: string, returning = false) => {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    }
    flightStartRef.current = { ...from };
    flightTargetRef.current = { ...to };
    flightProgressRef.current = 0;
    isFlying.current = true;
    isAtTarget.current = false;
    isReturnFlight.current = returning;
    ttsCompleteRef.current = false;
    if (targetLabel) {
      setLabel(targetLabel);
      setShowLabel(false);
    }
  }, []);

  // Main RAF animation loop
  useEffect(() => {
    let running = true;
    const FLIGHT_DURATION = 650;
    const FOLLOW_SPEED = 0.018; // lazy trail — duck lags well behind cursor

    const loop = () => {
      if (!running) return;

      if (isFlying.current && flightTargetRef.current) {
        // Flying to target
        flightProgressRef.current = Math.min(flightProgressRef.current + (16 / FLIGHT_DURATION), 1);
        const t = easeInOutCubic(flightProgressRef.current);
        const start = flightStartRef.current;
        const end = flightTargetRef.current;
        const cp = controlPoint(start, end);
        const pos = quadBezier(start, cp, end, t);
        // Scale pulse during flight — no rotation (circular icon looks bad rotated)
        const scale = 1 + 0.25 * Math.sin(t * Math.PI);

        posRef.current = pos;
        scaleRef.current = scale;

        if (flightProgressRef.current >= 1) {
          isFlying.current = false;
          scaleRef.current = 1;

          if (isReturnFlight.current) {
            // Landed back at cursor — resume cursor-follow mode, don't lock at target
            isAtTarget.current = false;
            isReturnFlight.current = false;
          } else {
            // Landed at a POINT target — wait for TTS to finish
            isAtTarget.current = true;
            setShowLabel(true);
            // Fallback: if TTS_COMPLETE never fires, return after 10s
            returnTimerRef.current = setTimeout(() => {
              isAtTarget.current = false;
              setShowLabel(false);
              startFlight(posRef.current, { ...cursorPosRef.current }, '', true);
            }, 10000);
          }
        }
      } else if (isAtTarget.current) {
        // Hovering at target — bob gently, wait for TTS
        scaleRef.current = 1 + 0.04 * Math.sin(Date.now() / 300);
      } else {
        // Trail cursor with lag
        posRef.current.x = lerp(posRef.current.x, cursorPosRef.current.x, FOLLOW_SPEED);
        posRef.current.y = lerp(posRef.current.y, cursorPosRef.current.y, FOLLOW_SPEED);
        scaleRef.current = lerp(scaleRef.current, 1, 0.07);
      }

      if (duckElRef.current) {
        duckElRef.current.style.left = `${posRef.current.x - DUCK_HALF + DUCK_OFFSET_X}px`;
        duckElRef.current.style.top = `${posRef.current.y - DUCK_HALF + DUCK_OFFSET_Y}px`;
        duckElRef.current.style.transform = `scale(${scaleRef.current})`;
      }

      // Waveform bars while listening
      if (voiceStateRef.current === 'listening') {
        phaseRef.current += 0.1;
        const profile = [0.4, 0.7, 1.0, 0.7, 0.4];
        barsRef.current.forEach((bar, i) => {
          if (!bar) return;
          const easedLevel = Math.pow(Math.min(audioLevelRef.current * 2.85, 1), 0.76);
          const reactive = easedLevel * 14 * profile[i];
          const idle = (Math.sin(phaseRef.current + i * 1.2) + 1) / 2 * 2;
          bar.style.height = `${3 + reactive + idle}px`;
        });
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
    return () => { running = false; };
  }, [startFlight]);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onVoiceStateChanged(({ state }) => {
        setVoiceState(state);
        voiceStateRef.current = state;
        if (state === 'idle') {
          audioLevelRef.current = 0;
          setShowLabel(false);
        }
      }),

      window.electronAPI.onCursorPosition((payload: CursorPositionPayload) => {
        if (payload.displayIndex !== displayIndex) return;
        cursorPosRef.current = { x: payload.x, y: payload.y };
      }),

      window.electronAPI.onCursorPointAt((payload: CursorPointAtPayload) => {
        if (payload.displayIndex !== displayIndex) return;
        startFlight(posRef.current, { x: payload.x, y: payload.y }, payload.label);
      }),

      window.electronAPI.onAudioPowerLevel(({ level }: AudioPowerLevelPayload) => {
        audioLevelRef.current = level;
      }),

      window.electronAPI.onResponseComplete(() => {}),

      window.electronAPI.onTtsComplete(() => {
        if (isAtTarget.current) {
          // TTS finished — fly back to cursor after short pause
          if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
          returnTimerRef.current = setTimeout(() => {
            isAtTarget.current = false;
            setShowLabel(false);
            startFlight(posRef.current, { ...cursorPosRef.current }, '', true);
          }, 600);
        }
      }),
    ];

    return () => {
      cleanups.forEach((fn) => fn());
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    };
  }, [displayIndex, startFlight]);

  const isListening = voiceState === 'listening';
  const isProcessing = voiceState === 'processing';

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>

      {/* Duck is ALWAYS rendered — visible from app start, never hides */}
      <div
        ref={duckElRef}
        style={{
          position: 'absolute',
          left: posRef.current.x - DUCK_HALF + DUCK_OFFSET_X,
          top: posRef.current.y - DUCK_HALF + DUCK_OFFSET_Y,
          width: DUCK_SIZE,
          height: 22,
          willChange: 'left, top, transform',
          filter: `drop-shadow(0 0 5px ${YELLOW_GLOW}) drop-shadow(0 2px 8px rgba(0,0,0,0.7))`,
        }}
      >
        {/* Ambient glow ring */}
        <div style={{
          position: 'absolute',
          inset: -5,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${YELLOW_GLOW} 0%, transparent 65%)`,
          animation: 'pulse 2.5s ease-in-out infinite',
          pointerEvents: 'none',
        }} />

        <DuckIcon />

        {/* Waveform bars above duck when listening */}
        {isListening && (
          <div style={{
            position: 'absolute',
            top: -28,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            height: '20px',
          }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                ref={(el) => { barsRef.current[i] = el; }}
                style={{
                  width: '3px',
                  height: '4px',
                  backgroundColor: YELLOW,
                  borderRadius: '2px',
                  alignSelf: 'center',
                  boxShadow: `0 0 4px ${YELLOW}`,
                }}
              />
            ))}
          </div>
        )}

        {/* Spinner ring when processing */}
        {isProcessing && (
          <div style={{
            position: 'absolute',
            inset: -6,
            borderRadius: '50%',
            border: `2.5px solid transparent`,
            borderTop: `2.5px solid ${YELLOW}`,
            animation: 'spin 0.8s linear infinite',
            pointerEvents: 'none',
          }} />
        )}

        {/* Point label */}
        {showLabel && label && (
          <div style={{
            position: 'absolute',
            top: 50,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            backgroundColor: 'rgba(0,0,0,0.9)',
            color: '#fff',
            fontSize: '11px',
            fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
            padding: '4px 10px',
            borderRadius: '6px',
            border: `1px solid ${YELLOW}55`,
            boxShadow: `0 2px 12px rgba(0,0,0,0.5)`,
            animation: 'labelFadeIn 0.2s ease',
          }}>
            {label}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes labelFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: transparent; }
      `}</style>
    </div>
  );
};

