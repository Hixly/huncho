import React, { useState, useEffect, useRef } from 'react';
import { VoiceState, StoredMessage } from '../../shared/ipc-types';
import { DS } from './components/design-system';
import { ModelPicker } from './components/ModelPicker';
import { WaveformDisplay } from './components/WaveformDisplay';
import { HunchoDiamond } from './components/HunchoDiamond';

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
      background: DS.colors.chromeGradient,
      color: '#ffffff',
      borderRadius: '18px 18px 4px 18px',
      padding: '9px 13px',
      fontSize: '13px',
      lineHeight: '1.45',
      opacity: pending ? 0.7 : 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
    }}>
      {text}
    </div>
    {timestamp && (
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '8.5px', letterSpacing: '0.08em', color: DS.colors.textMuted, paddingRight: '4px', opacity: 0.75 }}>
        {formatTime(timestamp)}
      </div>
    )}
  </div>
);

const HunchoBubble: React.FC<{ text: string; timestamp?: number; streaming?: boolean }> = ({ text, timestamp, streaming }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '7px' }}>
    <HunchoDiamond width={22} height={36} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '78%' }}>
      <div style={{
        backgroundColor: DS.colors.surface3,
        border: `1px solid ${DS.colors.border}`,
        color: DS.colors.textPrimary,
        borderRadius: '18px 18px 18px 4px',
        padding: '9px 13px',
        fontSize: '13px',
        lineHeight: '1.5',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '8.5px', letterSpacing: '0.08em', color: DS.colors.textMuted, paddingLeft: '4px', opacity: 0.75 }}>
          {formatTime(timestamp)}
        </div>
      )}
    </div>
  </div>
);

const HunchoTyping: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '7px' }}>
    <HunchoDiamond width={22} height={36} />
    <div style={{
      backgroundColor: DS.colors.surface3,
      border: `1px solid ${DS.colors.border}`,
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
  const [currentModel, setCurrentModel] = useState('gemini-2.5-flash');
  const [briefMode, setBriefMode] = useState(false);
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

      (api as any).onBriefModeChanged?.(({ briefMode: bm }: { briefMode: boolean }) => {
        setBriefMode(bm);
      }),
    ].filter(Boolean);

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

    const allMessages = messages.slice(-40);

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
      backgroundColor: DS.colors.background,
      color: DS.colors.textPrimary,
      fontFamily: DS.typography.fontFamily,
      borderRadius: '16px',
      border: `1px solid ${DS.colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: [
        '0 0 0 1px rgba(0,0,0,0.04)',
        '0 0 20px rgba(0,0,0,0.06)',
        '0 32px 80px rgba(0,0,0,0.18)',
        'inset 0 1px 0 rgba(255,255,255,0.6)',
      ].join(', '),
      userSelect: 'none',
    }}>

      {/* ── Chrome accent strip ── */}
      <div style={{
        height: '2px', flexShrink: 0,
        background: 'linear-gradient(90deg, transparent 0%, #4a4a54 18%, #c8c8c0 50%, #4a4a54 82%, transparent 100%)',
      }} />

      {/* ── Header — this is the drag handle ── */}
      <div style={{
        padding: '11px 14px 10px',
        borderBottom: `1px solid ${DS.colors.borderLight}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        background: `linear-gradient(180deg, ${DS.colors.surface3} 0%, ${DS.colors.background} 100%)`,
        WebkitAppRegion: 'drag' as any,
        cursor: 'grab',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
          <HunchoDiamond width={24} height={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: "'Cinzel Decorative', serif",
              fontSize: '15px', fontWeight: 900, letterSpacing: '0.26em', lineHeight: 1.1,
              whiteSpace: 'nowrap',
              background: DS.colors.chromeGradient,
              WebkitBackgroundClip: 'text', backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              HUNCHO
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '8px', letterSpacing: '0.20em', textTransform: 'uppercase',
              color: DS.colors.textMuted, marginTop: '2px', opacity: 0.8,
              whiteSpace: 'nowrap',
            }}>
              Your AI Companion
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, WebkitAppRegion: 'no-drag' as any }}>
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
            title="Minimize panel (Huncho stays active)"
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
            title="Close panel and Huncho"
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

      {/* ── Status strip — HUD sub-bar, gives the title row room to breathe ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 14px', flexShrink: 0,
        borderBottom: `1px solid ${DS.colors.borderLight}`,
        backgroundColor: DS.colors.surface1,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '8px', letterSpacing: '0.18em', textTransform: 'uppercase',
        color: voiceState === 'idle' ? DS.colors.textMuted : DS.colors.accent,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
            backgroundColor: isListening ? DS.colors.success : isProcessing ? DS.colors.warning : isResponding ? DS.colors.info : DS.colors.success,
            boxShadow: `0 0 6px ${isListening ? DS.colors.success : isProcessing ? DS.colors.warning : isResponding ? DS.colors.info : DS.colors.success}`,
            animation: 'pulse 2.4s ease-in-out infinite',
          }} />
          {isListening ? 'Listening' : isProcessing ? 'Thinking' : isResponding ? 'Speaking' : 'Standing By'}
        </div>
        <div style={{ opacity: 0.6 }}>Hixly Research Project</div>
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
            alignItems: 'center', justifyContent: 'center', gap: '12px',
            color: DS.colors.textMuted, fontSize: '12px', textAlign: 'center',
            padding: '40px 20px',
          }}>
            <div style={{ animation: 'breathe 4.5s ease-in-out infinite' }}>
              <HunchoDiamond width={36} height={58} />
            </div>
            <div style={{
              fontFamily: "'Cinzel Decorative', serif",
              fontSize: '19px',
              fontWeight: 900,
              letterSpacing: '0.34em',
              paddingLeft: '0.34em',
              background: DS.colors.chromeGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              HUNCHO
            </div>
            <div style={{
              width: '90px', height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(58,58,62,0.45), transparent)',
            }} />
            <div style={{ lineHeight: 1.7, fontSize: '12px' }}>
              Hit <span style={{
                backgroundColor: DS.colors.surface2,
                border: `1px solid ${DS.colors.border}`,
                borderRadius: '4px', padding: '1px 6px',
                fontFamily: "'JetBrains Mono', monospace", fontSize: '10.5px', color: DS.colors.textSecondary,
              }}>Ctrl+H</span> or say the word.<br />
              I got you from there.
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

      {/* ── Footer: model picker + brief mode toggle ── */}
      <div style={{
        padding: '7px 14px',
        borderTop: `1px solid ${DS.colors.borderLight}`,
        display: 'flex', alignItems: 'center', gap: '8px',
        flexShrink: 0,
        WebkitAppRegion: 'no-drag' as any,
        background: `linear-gradient(0deg, ${DS.colors.surface3} 0%, ${DS.colors.background} 100%)`,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '8.5px', letterSpacing: '0.22em', textTransform: 'uppercase',
          color: DS.colors.textMuted,
        }}>Model</span>
        <ModelPicker currentModel={currentModel} onModelChange={handleModelChange} />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => (window.electronAPI as any).toggleBriefMode?.()}
          title={briefMode ? 'Brief mode ON — click to go back to full responses' : 'Click to enable brief mode (1-2 sentence answers)'}
          style={{
            padding: '3px 9px',
            borderRadius: DS.borderRadius.full,
            border: `1px solid ${briefMode ? DS.colors.accent : DS.colors.border}`,
            backgroundColor: briefMode ? DS.colors.accentDim : 'transparent',
            color: briefMode ? DS.colors.accent : DS.colors.textMuted,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '8.5px', fontWeight: briefMode ? 700 : 400,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
        >
          {briefMode ? 'Brief ✓' : 'Brief'}
        </button>
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
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes breathe {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-3px) scale(1.03); }
        }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${DS.colors.border}; border-radius: 2px; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
};

