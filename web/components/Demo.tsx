'use client';
import { useEffect, useRef, useState } from 'react';
import Gem from './Gem';
import Reveal from './Reveal';

export default function Demo() {
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPlay(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="demo">
      <Reveal>
        <div className="sec-head">
          <div className="kicker">Live Loop</div>
          <h2>Watch it <em className="chrome-text">work</em>.</h2>
        </div>
      </Reveal>
      <Reveal>
        <div className="demo-frame">
          <div className="demo-chrome">
            <div className="demo-lights"><span /><span /><span /></div>
            <div className="demo-url">huncho://browser — signed in</div>
          </div>
          <div ref={ref} className={`demo-page ${play ? 'play' : ''}`}>
            <div className="demo-search"><span className="demo-type" /><span className="demo-caret" /></div>
            <div className="demo-result">
              <div className="t">The 12 Best Mechanical Keyboards (2026 Review)</div>
              <div className="d">Hands-on picks for every budget — tested switches, build quality, and latency…</div>
            </div>
            <div className="demo-ripple" />
            <div className="demo-dest">
              <div className="bigbar" /><div className="smallbar" /><div className="smallbar" />
            </div>
            <div className="demo-gem"><Gem idSuffix="demo" /></div>
          </div>
        </div>
        <div className="demo-caption">Voice command → search → click — no hands, 12 second loop</div>
      </Reveal>
    </section>
  );
}
