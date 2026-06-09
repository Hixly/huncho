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
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', height: 36, boxSizing: 'border-box',
      borderBottom: '1px solid #1F1F22', background: '#0F0F12',
    }}>
      <span style={{ color: '#C9A24B', fontSize: 12, letterSpacing: 0.5 }}>HUNCHO</span>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        spellCheck={false}
        placeholder="type a URL or say 'open <site>'"
        style={{
          flex: 1, height: 24, padding: '0 8px',
          background: '#1A1A1E', border: '1px solid #2A2A2F', borderRadius: 4,
          color: '#EDEDED', fontSize: 12, outline: 'none',
        }}
      />
    </form>
  );
};
