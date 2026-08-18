import type { Metadata } from 'next';
import { Rajdhani, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { BackgroundColumns } from '@/components/BackgroundColumns';

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-rajdhani',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'K-APEX-08 // Kobata Matrix Corporation',
  description: 'Corporate security console — Kobata Matrix Corporation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${rajdhani.variable} ${jetbrainsMono.variable}`}>
      <body>
        <BackgroundColumns />
        {children}
        <div className="grain-layer" aria-hidden="true" />
        <div className="crt-layer" aria-hidden="true" />
        <div className="glitch-layer g1" aria-hidden="true" />
        <div className="glitch-layer g2" aria-hidden="true" />
      </body>
    </html>
  );
}
