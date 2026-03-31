'use client';

import { useAuth } from '@/lib/auth-context';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import Link from 'next/link';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <AuthGuard>
      <DashboardShell>
        <div className="p-6 max-w-2xl">
          <h1 className="text-2xl font-bold mb-6">Settings</h1>
          <div className="space-y-4">
            <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className="text-xs text-zinc-500 mb-1">Email</div>
              <div className="text-sm">{user?.email ?? 'Not set'}</div>
            </div>
            <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className="text-xs text-zinc-500 mb-1">Display Name</div>
              <div className="text-sm">{user?.displayName ?? 'Not set'}</div>
            </div>
            <Link
              href="/settings/api-keys"
              className="block p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              <div className="font-medium">API Keys</div>
              <div className="text-sm text-zinc-500 mt-1">Create and manage API keys for your agents</div>
            </Link>
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
