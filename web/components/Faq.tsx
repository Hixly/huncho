import Reveal from './Reveal';

const QA = [
  { q: 'What does it run on?', a: 'Windows 10 and 11. Huncho is a native desktop app with its own built-in browser — you sign in to your sites once and it stays signed in.' },
  { q: 'What does it cost?', a: 'It is free. You bring your own Google Gemini API key, which is also free from Google — get one in about 30 seconds and paste it in on first launch.' },
  { q: 'Where does my voice go?', a: 'Nowhere. Your speech is transcribed locally on your machine, and your browsing and logins never leave your computer. The only thing sent out is the text of your command, to Google Gemini using your own key.' },
  { q: 'When does it ask permission?', a: 'Almost never — Huncho acts freely on your word. The single exception: anything that spends money requires your explicit confirmation first.' },
  { q: 'How do I talk to it?', a: 'Press Ctrl+H and speak, then press again or just stop talking to end the turn. A hands-free wake word is built in but off by default while it is tuned, so Ctrl+H push-to-talk is the primary trigger.' },
];

export default function Faq() {
  return (
    <section id="faq">
      <Reveal>
        <div className="sec-head">
          <div className="kicker">Questions</div>
          <h2>The <em className="chrome-text">fine print</em>, minus the fine print.</h2>
        </div>
      </Reveal>
      <Reveal>
        <div className="faq" style={{ margin: '0 auto' }}>
          {QA.map((r) => (
            <div key={r.q} className="faq-row">
              <h3>{r.q}</h3>
              <p>{r.a}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
