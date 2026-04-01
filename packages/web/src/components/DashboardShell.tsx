'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';

const navItems = [
  { href: '/inbox', label: 'Inbox', abbr: 'IN' },
  { href: '/contacts', label: 'Contacts', abbr: 'CO' },
  { href: '/agents', label: 'Agents', abbr: 'AG' },
  { href: '/settings', label: 'Settings', abbr: 'SE' },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#E0E0E0] font-mono">
      <nav className="w-16 bg-[#111] border-r border-[#333] flex flex-col items-center py-4 gap-4">
        <Link href="/" className="flex items-center justify-center">
          <div className="w-2 h-2 bg-[#00FF88] animate-pulse" />
        </Link>
        <div className="flex-1 flex flex-col gap-1 mt-4">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`w-10 h-10 flex items-center justify-center text-xs font-mono transition-colors relative ${
                  active
                    ? 'bg-[#1A1A1A] text-[#00FF88] border-l-2 border-[#00FF88]'
                    : 'text-[#555] hover:text-[#E0E0E0] hover:bg-[#151515]'
                }`}
                title={item.label}
              >
                {item.abbr}
              </Link>
            );
          })}
        </div>
        <button
          onClick={() => signOut()}
          className="w-10 h-10 flex items-center justify-center text-xs text-[#555] hover:text-[#FF4444] hover:bg-[#151515] font-mono transition-colors"
          title="Sign out"
        >
          {'>>'}
        </button>
      </nav>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
