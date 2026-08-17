import type { Metadata } from 'next';
import { Cinzel_Decorative, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const cinzel = Cinzel_Decorative({ weight: ['700', '900'], subsets: ['latin'], variable: '--font-mark' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const mono = JetBrains_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Huncho — Your computer. Hands off.',
  description:
    'Huncho is a voice-native AI operator for Windows. Speak — it clicks, types, and browses for you. Free download, bring your own Google Gemini key.',
  metadataBase: new URL('https://huncho.tech'),
  openGraph: {
    title: 'Huncho — Your computer. Hands off.',
    description: 'A voice-native AI operator for Windows. Free — download and bring your own Gemini key.',
    url: 'https://huncho.tech',
    siteName: 'Huncho',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
