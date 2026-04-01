'use client';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import { useEffect, useState } from 'react';

// Contacts are per-agent, so the dashboard shows contacts for the first agent
// A more complete implementation would let users select which agent's contacts to view

export default function ContactsPage() {
  const { token } = useAuth();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Dashboard doesn't have a direct contacts endpoint yet
    // This would need a dashboard-specific contacts aggregation endpoint
    setLoading(false);
  }, [token]);

  return (
    <AuthGuard>
      <DashboardShell>
        <div className="p-6 font-mono">
          <h1 className="text-2xl font-bold mb-6 text-[#E0E0E0]">
            <span className="text-[#00FF88] mr-2">&gt;</span>Contacts
          </h1>
          <div className="terminal-card">
            <p className="text-[#888] text-sm">
              Contact management is available through the SDK and CLI. Agent contacts will appear here once conversations are established.
            </p>
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
