import Reveal from './Reveal';

const QA = [
  { q: 'What does it run on?', a: 'Windows first. Huncho is a native desktop app with its own built-in browser — you sign in to your sites once and it stays signed in.' },
  { q: 'What does it cost?', a: 'Early access is free. Pricing comes later, and early-access members get first word and founder terms.' },
  { q: 'Where does my voice go?', a: 'Audio is transcribed and processed to carry out your command, not stored for training. Your browser sessions and logins never leave your machine.' },
  { q: 'When does it ask permission?', a: 'Almost never — Huncho acts freely on your word. The single exception: anything that spends money requires your explicit confirmation first.' },
  { q: 'When can I get it?', a: 'It is in active development and in daily use by its builder. Join the list — invites go out in waves as builds stabilize.' },
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
