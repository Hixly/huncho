import Reveal from './Reveal';

export default function Download() {
  return (
    <section id="download" className="waitlist">
      <Reveal>
        <div className="sec-head" style={{ marginBottom: 0 }}>
          <div className="kicker">Get Huncho</div>
          <h2>Free. On your <em className="chrome-text">machine</em>.</h2>
        </div>
        <p className="dl-sub">
          Download the Windows installer, paste in a free Google Gemini key, and press{' '}
          <span className="kbd">Ctrl+H</span>. Your voice, browsing, and logins stay on your computer.
        </p>
        <div className="dl-actions">
          <a
            className="cta"
            href="https://github.com/Hixly/huncho/releases/latest"
            target="_blank"
            rel="noreferrer"
          >
            Download for Windows
          </a>
          <a
            className="dl-secondary"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Get a free Gemini key →
          </a>
        </div>
        <div className="meta">Windows 10/11 · Free · Bring your own API key</div>
      </Reveal>
    </section>
  );
}
