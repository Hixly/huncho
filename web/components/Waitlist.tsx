'use client';
import { useState } from 'react';
import Reveal from './Reveal';

type State = 'idle' | 'sending' | 'ok' | 'err';

export default function Waitlist() {
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setState('sending');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), hp: data.get('company') }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setState('ok');
        setMsg('// POSITION SECURED — WE’LL BE IN TOUCH');
        form.reset();
      } else {
        setState('err');
        setMsg(`// ${json.error ?? 'LINK FAILED — TRY AGAIN'}`);
      }
    } catch {
      setState('err');
      setMsg('// LINK FAILED — TRY AGAIN');
    }
  }

  return (
    <section id="waitlist" className="waitlist">
      <Reveal>
        <div className="sec-head" style={{ marginBottom: 0 }}>
          <div className="kicker">Early Access</div>
          <h2>Be first in <em className="chrome-text">line</em>.</h2>
        </div>
        <form className="wl-form" onSubmit={submit}>
          <input name="email" type="email" required placeholder="you@domain.com" autoComplete="email" aria-label="Email address" />
          <input className="hp" name="company" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <button type="submit" disabled={state === 'sending' || state === 'ok'}>
            {state === 'sending' ? 'Transmitting…' : state === 'ok' ? 'Locked In' : 'Join the List'}
          </button>
        </form>
        <div className={`wl-msg ${state === 'ok' ? 'ok' : state === 'err' ? 'err' : ''}`}>{msg}</div>
      </Reveal>
    </section>
  );
}
