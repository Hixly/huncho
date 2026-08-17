import Gem from './Gem';

const RINGS = [
  { cls: 'r1', stroke: 'rgba(58,58,62,0.28)', width: 0.5, dash: '50 28 8 28 50 143' },
  { cls: 'r2', stroke: 'rgba(58,58,62,0.4)', width: 0.8, dash: '20 55 90 143' },
  { cls: 'r3', stroke: 'rgba(58,58,62,0.5)', width: 0.5, dash: '2 10' },
];

export default function Hero() {
  return (
    <div className="hero">
      <div className="core">
        {RINGS.map((r) => (
          <div key={r.cls} className={`ring ${r.cls}`}>
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="49" fill="none" stroke={r.stroke} strokeWidth={r.width} strokeDasharray={r.dash} strokeLinecap="round" />
            </svg>
          </div>
        ))}
        <div className="gemwrap">
          <div className="halo" />
          <Gem className="gem" idSuffix="hero" />
        </div>
      </div>
      <div className="mark" aria-label="HUNCHO">
        {'HUNCHO'.split('').map((ch, i) => (
          <span key={i} className="ltr" style={{ animationDelay: `${0.95 + i * 0.08}s` }} aria-hidden="true">
            {ch}
          </span>
        ))}
        <span className="shimmer" aria-hidden="true">HUNCHO</span>
      </div>
      <div className="rule" />
      <h1 className="tagline">
        Your computer. <em className="chrome-text">Hands off.</em>
      </h1>
      <p className="sub">
        A voice-native AI operator for Windows. Say the word — Huncho clicks, types, and browses for you, in its own always-signed-in browser.
      </p>
      <a className="cta" href="#download">Download for Windows</a>
      <div className="meta">Windows · Voice-Native · Free · Bring your own key</div>
    </div>
  );
}
