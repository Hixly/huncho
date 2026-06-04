import React, { useState, useEffect, useRef } from 'react';
import { VoiceState, StoredMessage } from '../../shared/ipc-types';
import { DS } from './components/design-system';
import { ModelPicker } from './components/ModelPicker';
import { WaveformDisplay } from './components/WaveformDisplay';

// ── Duck logo (header + chat avatar) ─────────────────────────────────────────
const DuckLogo: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" style={{ display: 'block', flexShrink: 0 }}>
    <circle cx="22" cy="22" r="21" fill="#111" stroke="#222" strokeWidth="1"/>
    <circle cx="22" cy="23" r="15.5" fill="#F5C518"/>
    <ellipse cx="22" cy="8.5" rx="3" ry="4.5" fill="#D4A800"/>
    <ellipse cx="20.5" cy="7.5" rx="1.5" ry="2.5" fill="#fff" opacity="0.25"/>
    <circle cx="15" cy="22" r="5.8" fill="none" stroke="#111" strokeWidth="2.5"/>
    <circle cx="29" cy="22" r="5.8" fill="none" stroke="#111" strokeWidth="2.5"/>
    <line x1="20.8" y1="22" x2="23.2" y2="22" stroke="#111" strokeWidth="2"/>
    <line x1="9.2" y1="20" x2="9.5" y2="22" stroke="#111" strokeWidth="2" strokeLinecap="round"/>
    <line x1="34.8" y1="20" x2="34.5" y2="22" stroke="#111" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="15" cy="22" r="2.8" fill="#111"/>
    <circle cx="29" cy="22" r="2.8" fill="#111"/>
    <circle cx="16.2" cy="20.8" r="1.2" fill="white"/>
    <circle cx="30.2" cy="20.8" r="1.2" fill="white"/>
    <ellipse cx="22" cy="32.5" rx="6" ry="3" fill="#8B4500"/>
    <ellipse cx="22" cy="31" rx="6" ry="2.8" fill="#C06800"/>
  </svg>
);

// ── Typing dots ───────────────────────────────────────────────────────────────
const TypingDots: React.FC = () => (
  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '2px 0' }}>
    {[0, 1, 2].map(i => (
      <div key={i} style={{
        width: '6px', height: '6px', borderRadius: '50%',
        backgroundColor: DS.colors.accent,
        animation: 'dotBounce 1.2s ease-in-out infinite',
        animationDelay: `${i * 0.15}s`,
      }} />
    ))}
  </div>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Bubble components ─────────────────────────────────────────────────────────
const UserBubble: React.FC<{ text: string; timestamp?: number; pending?: boolean }> = ({ text, timestamp, pending }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
    <div style={{
      maxWidth: '78%',
      backgroundColor: '#3a3a3c',
      color: '#ffffff',
      borderRadius: '18px 18px 4px 18px',
      padding: '9px 13px',
      fontSize: '13px',
      lineHeight: '1.45',
      opacity: pending ? 0.7 : 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
    }}>
      {text}
    </div>
    {timestamp && (
      <div style={{ fontSize: '10px', color: DS.colors.textMuted, paddingRight: '4px' }}>
        {formatTime(timestamp)}
      </div>
    )}
  </div>
);

const HunchoBubble: React.FC<{ text: string; timestamp?: number; streaming?: boolean }> = ({ text, timestamp, streaming }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '7px' }}>
    <DuckLogo size={24} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '78%' }}>
      <div style={{
        backgroundColor: 'rgba(245,158,11,0.10)',
        border: '1px solid rgba(245,158,11,0.22)',
        color: '#d8d8d8',
        borderRadius: '18px 18px 18px 4px',
        padding: '9px 13px',
        fontSize: '13px',
        lineHeight: '1.5',
        boxShadow: `0 1px 8px rgba(245,158,11,0.08)`,
      }}>
        {text}
        {streaming && (
          <span style={{
            display: 'inline-block', width: '2px', height: '12px',
            backgroundColor: DS.colors.accent, marginLeft: '2px',
            animation: 'blink 0.7s step-end infinite', verticalAlign: 'text-bottom',
          }} />
        )}
      </div>
      {timestamp && !streaming && (
        <div style={{ fontSize: '10px', color: DS.colors.textMuted, paddingLeft: '4px' }}>
          {formatTime(timestamp)}
        </div>
      )}
    </div>
  </div>
);

const HunchoTyping: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '7px' }}>
    <DuckLogo size={24} />
    <div style={{
      backgroundColor: 'rgba(245,158,11,0.10)',
      border: '1px solid rgba(245,158,11,0.22)',
      borderRadius: '18px 18px 18px 4px',
      padding: '10px 14px',
    }}>
      <TypingDots />
    </div>
  </div>
);

const DateSeparator: React.FC<{ label: string }> = ({ label }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0',
  }}>
    <div style={{ flex: 1, height: '1px', backgroundColor: DS.colors.border }} />
    <span style={{ fontSize: '10px', color: DS.colors.textMuted, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {label}
    </span>
    <div style={{ flex: 1, height: '1px', backgroundColor: DS.colors.border }} />
  </div>
);

// ── Main App ──────────────────────────────────────────────────────────────────
export const App: React.FC = () => {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [pendingUser, setPendingUser] = useState('');
  const [streamText, setStreamText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [currentModel, setCurrentModel] = useState('claude-sonnet-4-5');
  const [quitHover, setQuitHover] = useState(false);
  const [minHover, setMinHover] = useState(false);
  const [clearHover, setClearHover] = useState(false);

  // Refs to avoid stale closures in IPC callbacks
  const pendingUserRef = useRef('');
  const streamTextRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync
  useEffect(() => { pendingUserRef.current = pendingUser; }, [pendingUser]);
  useEffect(() => { streamTextRef.current = streamText; }, [streamText]);

  // Auto-scroll to bottom whenever conversation updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingUser, streamText]);

  useEffect(() => {
    const api = window.electronAPI;

    // Request persisted history on mount
    api.requestChatHistory();

    const cleanups = [
      api.onChatHistory(({ messages: stored }) => {
        setMessages(stored);
      }),

      api.onVoiceStateChanged(({ state }) => {
        setVoiceState(state);
        if (state === 'idle') setAudioLevel(0);
      }),

      api.onTranscriptUpdate(({ transcript: t, isFinal }) => {
        if (isFinal) {
          setPendingUser(t);
          setStreamText('');
        }
      }),

      api.onResponseChunk(({ accumulated }) => {
        setStreamText(accumulated);
      }),

      api.onResponseComplete(() => {
        const userText = pendingUserRef.current;
        const assistantText = streamTextRef.current;
        const now = Date.now();
        if (userText || assistantText) {
          setMessages(prev => [
            ...prev,
            ...(userText ? [{ role: 'user' as const, text: userText, timestamp: now - 1 }] : []),
            ...(assistantText ? [{ role: 'assistant' as const, text: assistantText, timestamp: now }] : []),
          ]);
        }
        setPendingUser('');
        setStreamText('');
      }),

      api.onAudioPowerLevel(({ level }) => setAudioLevel(level)),
      api.onModelChanged(({ model }) => setCurrentModel(model)),
      api.onTtsComplete(() => {}),
      api.onHistoryCleared(() => {
        setMessages([]);
        setPendingUser('');
        setStreamText('');
      }),
    ];

    return () => cleanups.forEach(fn => fn());
  }, []);

  const handleModelChange = (model: string) => {
    setCurrentModel(model);
    window.electronAPI.requestModelChange({ model });
  };

  const isListening = voiceState === 'listening';
  const isProcessing = voiceState === 'processing';
  const isResponding = voiceState === 'responding';

  // Group messages by date for separators
  const renderMessages = () => {
    const items: React.ReactNode[] = [];
    let lastDate = '';

    const allMessages = [...messages];

    allMessages.forEach((msg, i) => {
      const dateLabel = formatDateSeparator(msg.timestamp);
      if (dateLabel !== lastDate) {
        items.push(<DateSeparator key={`date-${i}`} label={dateLabel} />);
        lastDate = dateLabel;
      }

      if (msg.role === 'user') {
        items.push(<UserBubble key={`msg-${i}`} text={msg.text} timestamp={msg.timestamp} />);
      } else {
        items.push(<HunchoBubble key={`msg-${i}`} text={msg.text} timestamp={msg.timestamp} />);
      }
    });

    // Pending user message (speaking now)
    if (pendingUser) {
      items.push(<UserBubble key="pending-user" text={pendingUser} pending />);
    }

    // Live streaming response or typing indicator
    if (isProcessing && !streamText) {
      items.push(<HunchoTyping key="typing" />);
    } else if (streamText) {
      items.push(<HunchoBubble key="streaming" text={streamText} streaming />);
    }

    return items;
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#0e0e0e',
      color: DS.colors.textPrimary,
      fontFamily: DS.typography.fontFamily,
      borderRadius: '16px',
      border: '1px solid rgba(245,158,11,0.28)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: [
        '0 0 0 1px rgba(0,0,0,0.8)',
        '0 0 30px rgba(245,158,11,0.07)',
        '0 32px 80px rgba(0,0,0,0.95)',
        'inset 0 1px 0 rgba(245,158,11,0.12)',
      ].join(', '),
      userSelect: 'none',
    }}>

      {/* ── Header — this is the drag handle ── */}
      <div style={{
        padding: '11px 14px',
        borderBottom: '1px solid rgba(245,158,11,0.15)',
        borderTop: '2px solid rgba(245,158,11,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        background: 'linear-gradient(180deg, #1a1610 0%, #111111 100%)',
        WebkitAppRegion: 'drag' as any,
        cursor: 'grab',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <DuckLogo size={30} />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Huncho
            </div>
            <div style={{ fontSize: '10px', color: DS.colors.textMuted, marginTop: '1px' }}>
              Your AI Companion
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', WebkitAppRegion: 'no-drag' as any }}>
          {/* State badge */}
          {voiceState !== 'idle' && (
            <div style={{
              padding: '2px 8px', borderRadius: DS.borderRadius.full,
              backgroundColor: DS.colors.accentDim,
              border: `1px solid ${DS.colors.accent}44`,
              fontSize: '10px', color: DS.colors.accent, fontWeight: 600, letterSpacing: '0.05em',
            }}>
              {isListening ? 'LISTENING' : isProcessing ? 'THINKING' : 'SPEAKING'}
            </div>
          )}

          {/* New Chat */}
          <button
            onClick={() => window.electronAPI.clearHistory()}
            onMouseEnter={() => setClearHover(true)}
            onMouseLeave={() => setClearHover(false)}
            title="New Chat"
            style={{
              width: '26px', height: '26px', borderRadius: DS.borderRadius.sm,
              border: `1px solid ${clearHover ? DS.colors.accent + '88' : DS.colors.border}`,
              backgroundColor: clearHover ? DS.colors.accentDim : 'transparent',
              color: clearHover ? DS.colors.accent : DS.colors.textMuted,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', lineHeight: 1, fontFamily: DS.typography.fontFamily,
              transition: 'all 0.15s ease', flexShrink: 0,
            }}
          >
            ↺
          </button>

          {/* Minimize — hides panel, duck stays visible */}
          <button
            onClick={() => window.electronAPI.minimizePanel()}
            onMouseEnter={() => setMinHover(true)}
            onMouseLeave={() => setMinHover(false)}
            title="Minimize panel (duck stays active)"
            style={{
              width: '26px', height: '26px', borderRadius: DS.borderRadius.sm,
              border: `1px solid ${minHover ? DS.colors.accent + '88' : DS.colors.border}`,
              backgroundColor: minHover ? DS.colors.accent + '22' : 'transparent',
              color: minHover ? DS.colors.accent : DS.colors.textMuted,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '15px', lineHeight: 1, fontFamily: DS.typography.fontFamily,
              transition: 'all 0.15s ease', flexShrink: 0,
            }}
          >
            −
          </button>

          {/* Close × — hides panel + duck */}
          <button
            onClick={() => window.electronAPI.hidePanel()}
            onMouseEnter={() => setQuitHover(true)}
            onMouseLeave={() => setQuitHover(false)}
            title="Close panel and duck"
            style={{
              width: '26px', height: '26px', borderRadius: DS.borderRadius.sm,
              border: `1px solid ${quitHover ? DS.colors.error + '88' : DS.colors.border}`,
              backgroundColor: quitHover ? DS.colors.error + '22' : 'transparent',
              color: quitHover ? DS.colors.error : DS.colors.textMuted,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '15px', lineHeight: 1, fontFamily: DS.typography.fontFamily,
              transition: 'all 0.15s ease', flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '12px 12px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        WebkitAppRegion: 'no-drag' as any,
      }}>
        {messages.length === 0 && !pendingUser && !streamText && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '10px',
            color: DS.colors.textMuted, fontSize: '12px', textAlign: 'center',
            padding: '40px 20px',
          }}>
            <DuckLogo size={44} />
            <div style={{ marginTop: '8px', lineHeight: 1.6 }}>
              Hold <span style={{
                backgroundColor: DS.colors.surface2,
                border: `1px solid ${DS.colors.border}`,
                borderRadius: '4px', padding: '1px 6px',
                fontFamily: 'monospace', fontSize: '11px', color: DS.colors.textSecondary,
              }}>Alt+D</span> to talk to Huncho
            </div>
          </div>
        )}

        {renderMessages()}

        {/* Waveform row while listening */}
        {isListening && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '6px 2px',
          }}>
            <div style={{
              width: '7px', height: '7px', borderRadius: '50%',
              backgroundColor: DS.colors.success,
              boxShadow: `0 0 6px ${DS.colors.success}`,
              flexShrink: 0,
            }} />
            <WaveformDisplay level={audioLevel} isActive />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Footer: model picker only ── */}
      <div style={{
        padding: '7px 14px',
        borderTop: '1px solid rgba(245,158,11,0.15)',
        display: 'flex', alignItems: 'center', gap: '8px',
        flexShrink: 0,
        WebkitAppRegion: 'no-drag' as any,
        background: 'linear-gradient(0deg, #1a1610 0%, #111111 100%)',
      }}>
        <span style={{ fontSize: '11px', color: DS.colors.textMuted }}>Model</span>
        <ModelPicker currentModel={currentModel} onModelChange={handleModelChange} />
      </div>

      <style>{`
        @keyframes dotBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${DS.colors.border}; border-radius: 2px; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
};

