import type { Metadata } from 'next';

// Authenticated app surface: no public content, must stay out of the index.
// Deliberately no rel=canonical here — a noindex page must not also point a
// canonical at a different URL.
export const metadata: Metadata = {
  title: 'Settings — SwarmRelay',
  robots: { index: false, follow: false },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
