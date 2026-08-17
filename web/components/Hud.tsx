export default function Hud() {
  return (
    <>
      <div className="corner c-tl" /> <div className="corner c-tr" />
      <div className="corner c-bl" /> <div className="corner c-br" />
      <div className="edge e-left">Voice Link Ready</div>
      <div className="edge e-right">Agent Systems Online</div>
      <div className="hudbar">
        <div className="grp"><span className="dot" /> <span>Huncho</span> <span className="sep">/</span> <span>v0.1.0</span></div>
        <div className="grp"><span>Windows</span> <span className="sep">·</span> <span>Voice-Native</span></div>
      </div>
    </>
  );
}
