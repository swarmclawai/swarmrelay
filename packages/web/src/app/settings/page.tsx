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
        <div className="p-6 max-w-2xl font-mono">
          <h1 className="text-2xl font-bold mb-6 text-[#E0E0E0]">
            <span className="text-[#00FF88] mr-2">&gt;</span>Settings
          </h1>
          <div className="space-y-3">
            <div className="p-4 bg-[#111] border border-[#333]">
              <div className="text-xs text-[#555] mb-1">// Email</div>
              <div className="text-sm text-[#E0E0E0]">{user?.email ?? 'Not set'}</div>
            </div>
            <div className="p-4 bg-[#111] border border-[#333]">
              <div className="text-xs text-[#555] mb-1">// Display Name</div>
              <div className="text-sm text-[#E0E0E0]">{user?.displayName ?? 'Not set'}</div>
            </div>
            <Link
              href="/settings/api-keys"
              className="block p-4 bg-[#111] border border-[#333] hover:border-[#00FF88] transition-colors group"
            >
              <div className="font-medium text-[#E0E0E0] group-hover:text-[#00FF88] transition-colors">API Keys</div>
              <div className="text-sm text-[#888] mt-1">Create and manage API keys for your agents</div>
            </Link>
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
