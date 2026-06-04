import React from 'react';
import { VoiceState } from '../../../shared/ipc-types';
import { DS } from './design-system';

interface StatusDisplayProps {
  state: VoiceState;
}

const statusConfig: Record<VoiceState, { text: string; color: string }> = {
  idle: {
    text: 'Press Alt+D',
    color: DS.colors.textMuted,
  },
  listening: {
    text: 'Listening...',
    color: DS.colors.success,
  },
  processing: {
    text: 'Thinking...',
    color: DS.colors.accent,
  },
  responding: {
    text: 'Speaking...',
    color: DS.colors.accent,
  },
};

export const StatusDisplay: React.FC<StatusDisplayProps> = ({ state }) => {
  const config = statusConfig[state];
  const isActive = state !== 'idle';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: DS.spacing.sm,
      padding: `${DS.spacing.sm} 0`,
    }}>
      {/* Glowing status dot */}
      <div style={{
        position: 'relative',
        width: '10px',
        height: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {/* Outer glow ring */}
        {isActive && (
          <div style={{
            position: 'absolute',
            width: '18px',
            height: '18px',
            borderRadius: DS.borderRadius.full,
            backgroundColor: config.color,
            opacity: 0.2,
            animation: 'statusRipple 2s ease-out infinite',
          }} />
        )}
        {/* Inner dot */}
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: DS.borderRadius.full,
          backgroundColor: config.color,
          boxShadow: isActive ? `0 0 8px ${config.color}, 0 0 16px ${config.color}44` : 'none',
          animation: isActive ? 'statusPulse 1.5s ease-in-out infinite' : 'none',
          transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
        }} />
      </div>

      <span style={{
        fontSize: DS.typography.sizes.md,
        color: config.color,
        fontWeight: DS.typography.weights.medium,
        transition: 'color 0.3s ease',
        letterSpacing: '-0.01em',
      }}>
        {config.text}
      </span>

      <style>{`
        @keyframes statusPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.9); }
        }
        @keyframes statusRipple {
          0% { transform: scale(0.5); opacity: 0.4; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

