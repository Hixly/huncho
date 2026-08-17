import Reveal from './Reveal';

const CAPS = [
  {
    kicker: '01 / VOICE LINK',
    title: 'You speak.',
    body: 'Press Ctrl+H and talk to Huncho like a person — no menus, no clicks. It understands what you meant, and stops gracefully the moment you change your mind.',
  },
  {
    kicker: '02 / EYES + HANDS',
    title: 'It acts.',
    body: 'Huncho reads the page and works it: clicks, types, scrolls, navigates. It runs its own browser that stays signed in to your sites — say it once, watch it happen.',
  },
  {
    kicker: '03 / ALWAYS YOURS',
    title: 'You stay in command.',
    body: 'The chrome diamond flies to everything Huncho touches, so you always see what it is doing. It acts freely — and only ever stops to ask before money moves.',
  },
];

export default function Capabilities() {
  return (
    <section id="capabilities">
      <Reveal>
        <div className="sec-head">
          <div className="kicker">Capabilities</div>
          <h2>Built to <em className="chrome-text">operate</em>, not just answer.</h2>
        </div>
      </Reveal>
      <Reveal>
        <div className="caps">
          {CAPS.map((c) => (
            <div key={c.kicker} className="cap">
              <div className="kicker">{c.kicker}</div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
