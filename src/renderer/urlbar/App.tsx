import React, { useEffect, useState } from 'react';

export const App: React.FC = () => {
  const [url, setUrl] = useState('');

  useEffect(() => {
    return window.electronAPI.onBrowserDidNavigate(({ url }) => setUrl(url));
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!v) return;
    window.electronAPI.browserNavigate(v);
  };

  return (
    <form onSubmit={submit} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 12px', height: 36, boxSizing: 'border-box',
      borderBottom: '1px solid #d8d8d0',
      background: 'linear-gradient(180deg, #ffffff 0%, #f4f3ee 100%)',
    }}>
      <span style={{
        color: '#1a1a1e',
        fontSize: 11,
        letterSpacing: 1.2,
        fontWeight: 700,
        fontFamily: "'Inter',sans-serif",
      }}>
        HUNCHO
      </span>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        spellCheck={false}
        placeholder="type a URL or say 'open <site>'"
        style={{
          flex: 1, height: 24, padding: '0 10px',
          background: '#ffffff',
          border: '1px solid #d8d8d0',
          borderRadius: 6,
          color: '#1a1a1e',
          fontSize: 12,
          fontFamily: "'Inter',sans-serif",
          outline: 'none',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)',
        }}
      />
    </form>
  );
};
