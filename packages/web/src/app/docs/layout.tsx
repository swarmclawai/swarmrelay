'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const sidebarLinks = [
  { href: '/docs', label: 'Getting Started' },
  { href: '/docs/sdk', label: 'SDK Reference' },
  { href: '/docs/cli', label: 'CLI Reference' },
  { href: '/docs/api', label: 'API Reference' },
];

const ecosystemLinks = [
  { href: 'https://www.swarmdock.ai', label: 'SwarmDock' },
  { href: 'https://www.swarmfeed.ai', label: 'SwarmFeed' },
  { href: 'https://www.swarmrecall.ai', label: 'SwarmRecall' },
  { href: 'https://www.swarmclaw.ai', label: 'SwarmClaw' },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] font-mono">
      {/* Top Nav */}
      <header className="border-b border-[#333] px-6 py-4 flex justify-between items-center sticky top-0 bg-[#0A0A0A] z-50">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-[#00FF88] animate-pulse" />
            <span className="text-lg font-bold tracking-tight">
              Swarm<span className="text-[#00FF88]">Relay</span>
            </span>
          </Link>
          <span className="text-[#555] text-sm ml-2">/ docs</span>
        </div>
        <Link
          href="/login"
          className="px-4 py-2 border border-[#00FF88] text-[#00FF88] hover:bg-[#00FF88] hover:text-[#0A0A0A] text-sm font-medium transition-colors"
        >
          Sign In
        </Link>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-[#333] min-h-[calc(100vh-57px)] sticky top-[57px] self-start hidden md:block">
          <nav className="p-4 space-y-1">
            <div className="text-[#555] text-xs font-mono uppercase tracking-widest mb-4 px-3">
              {'// Navigation'}
            </div>
            {sidebarLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-[#00FF88] bg-[rgba(0,255,136,0.08)] border-l-2 border-[#00FF88]'
                      : 'text-[#888] hover:text-[#E0E0E0] hover:bg-[#111] border-l-2 border-transparent'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}

            <div className="text-[#555] text-xs font-mono uppercase tracking-widest mt-8 mb-4 px-3 pt-4 border-t border-[#333]">
              {'// Network'}
            </div>
            {ecosystemLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block px-3 py-2 text-sm text-[#888] hover:text-[#E0E0E0] hover:bg-[#111] border-l-2 border-transparent transition-colors"
              >
                {link.label}
              </a>
            ))}

            <div className="text-[#555] text-xs font-mono uppercase tracking-widest mt-8 mb-4 px-3 pt-4 border-t border-[#333]">
              {'// Links'}
            </div>
            <a
              href="https://github.com/swarmclawai/swarmrelay"
              className="block px-3 py-2 text-sm text-[#888] hover:text-[#E0E0E0] hover:bg-[#111] border-l-2 border-transparent transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://clawhub.ai/skills/swarmrelay"
              className="block px-3 py-2 text-sm text-[#888] hover:text-[#E0E0E0] hover:bg-[#111] border-l-2 border-transparent transition-colors"
            >
              ClawHub Skill
            </a>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 max-w-4xl mx-auto px-6 md:px-12 py-10">
          <div className="prose-docs">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
