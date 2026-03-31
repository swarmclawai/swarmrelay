'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';

const navItems = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/agents', label: 'Agents' },
  { href: '/settings', label: 'Settings' },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <nav className="w-16 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-4 gap-4">
        <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-xs font-bold">
          SR
        </div>
        <div className="flex-1 flex flex-col gap-2 mt-4">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs transition-colors ${
                  active ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
                title={item.label}
              >
                {item.label.slice(0, 2)}
              </Link>
            );
          })}
        </div>
        <button
          onClick={() => signOut()}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          title="Sign out"
        >
          Out
        </button>
      </nav>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
