import React, { useState } from 'react';
import { DS } from './design-system';
import { HunchoDiamond } from './HunchoDiamond';

interface SettingsViewProps {
  /** True on the very first run (no key yet) — copy leans into onboarding. */
  firstRun: boolean;
  /** True when a key is already stored — offer a "keep current" affordance. */
  hasKey: boolean;
  onSaved: (hasKey: boolean) => void;
  /** Only shown when not first-run (lets the user back out without changing). */
  onClose?: () => void;
}

const KEY_URL = 'https://aistudio.google.com/apikey';

export const SettingsView: React.FC<SettingsViewProps> = ({ firstRun, hasKey, onSaved, onClose }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const key = value.trim();
    if (!key) {
      setError('Paste your Gemini API key first.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const status = await window.electronAPI.setGeminiKey(key);
      if (status.hasKey) {
        setValue('');
        onSaved(true);
      } else {
        setError("That key didn't take. Check it and try again.");
      }
    } catch {
      setError('Could not save the key. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '22px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '14px',
      textAlign: 'center',
      WebkitAppRegion: 'no-drag' as any,
    }}>
      <div style={{ animation: 'breathe 4.5s ease-in-out infinite' }}>
        <HunchoDiamond width={34} height={54} />
      </div>

      <div style={{
        fontFamily: "'Cinzel Decorative', serif",
        fontSize: '17px', fontWeight: 900, letterSpacing: '0.30em', paddingLeft: '0.30em',
        background: DS.colors.chromeGradient,
        WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
      }}>
        HUNCHO
      </div>

      <div style={{
        fontSize: '12.5px', lineHeight: 1.6, color: DS.colors.textSecondary, maxWidth: '280px',
      }}>
        {firstRun ? (
          <>Huncho needs your own Google Gemini API key to think. It&apos;s free, and it&apos;s stored only on this computer.</>
        ) : (
          <>Update or rotate your Gemini API key. It&apos;s stored only on this computer{hasKey ? ' — leave blank to keep the current one' : ''}.</>
        )}
      </div>

      <a
        href={KEY_URL}
        target="_blank"
        rel="noreferrer"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10.5px', letterSpacing: '0.04em',
          color: DS.colors.info, textDecoration: 'none',
          borderBottom: `1px solid ${DS.colors.info}44`, paddingBottom: '1px',
        }}
      >
        Get a free key → aistudio.google.com/apikey
      </a>

      <div style={{ width: '100%', maxWidth: '300px', display: 'flex', flexDirection: 'column', gap: '9px', marginTop: '4px' }}>
        <input
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void save(); }}
          placeholder="Paste your Gemini API key"
          autoFocus
          spellCheck={false}
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: DS.borderRadius.md,
            border: `1px solid ${error ? DS.colors.error : DS.colors.border}`,
            backgroundColor: DS.colors.surface3,
            color: DS.colors.textPrimary,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '12px',
            outline: 'none',
            WebkitAppRegion: 'no-drag' as any,
          }}
        />

        {error && (
          <div style={{ color: DS.colors.error, fontSize: '11px', textAlign: 'left', paddingLeft: '2px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => void save()}
            disabled={saving}
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: DS.borderRadius.md,
              border: 'none',
              background: DS.colors.chromeGradient,
              color: '#ffffff',
              fontFamily: DS.typography.fontFamily,
              fontSize: '12.5px', fontWeight: 700, letterSpacing: '0.02em',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            {saving ? 'Saving…' : firstRun ? 'Save & Start' : 'Save Key'}
          </button>

          {!firstRun && onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '9px 14px',
                borderRadius: DS.borderRadius.md,
                border: `1px solid ${DS.colors.border}`,
                backgroundColor: 'transparent',
                color: DS.colors.textMuted,
                fontFamily: DS.typography.fontFamily,
                fontSize: '12.5px',
                cursor: 'pointer',
              }}
            >
              {hasKey ? 'Done' : 'Cancel'}
            </button>
          )}
        </div>
      </div>

      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '9px', letterSpacing: '0.10em', color: DS.colors.textMuted,
        opacity: 0.75, marginTop: '4px', maxWidth: '280px', lineHeight: 1.6,
      }}>
        Stored locally in this app&apos;s settings. Never uploaded anywhere by Huncho.
      </div>
    </div>
  );
};
