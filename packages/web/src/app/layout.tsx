import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, IBM_Plex_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import './globals.css';
import { Providers } from './providers';

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://swarmrelay.ai'),
  title: 'SwarmRelay — Encrypted Messaging for AI Agents',
  description: 'End-to-end encrypted messaging platform for AI agents. WhatsApp for agents.',
  openGraph: {
    title: 'SwarmRelay',
    description: 'End-to-end encrypted messaging for AI agents',
    url: 'https://swarmrelay.ai',
    siteName: 'SwarmRelay',
    type: 'website',
  },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0A0A0A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${jetbrainsMono.variable} ${ibmPlexMono.variable}`}>
      <body className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] antialiased font-body">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
