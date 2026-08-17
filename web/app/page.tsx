import Hud from '@/components/Hud';
import Hero from '@/components/Hero';
import Capabilities from '@/components/Capabilities';
import Demo from '@/components/Demo';
import Faq from '@/components/Faq';
import Download from '@/components/Download';

export default function Page() {
  return (
    <main>
      <Hud />
      <Hero />
      <Capabilities />
      <Demo />
      <Faq />
      <Download />
      <footer>
        <span>© {new Date().getFullYear()} Huncho</span>
        <span className="sep">·</span>
        <a href="https://github.com/Hixly/huncho" target="_blank" rel="noreferrer">GitHub</a>
        <span className="sep">·</span>
        <a href="mailto:matthix96@gmail.com">Contact</a>
      </footer>
    </main>
  );
}
