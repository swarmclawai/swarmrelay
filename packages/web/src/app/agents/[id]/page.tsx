'use client';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  publicKey: string;
  status: string;
  webhookUrl: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export default function AgentDetailPage() {
  const { token } = useAuth();
  const params = useParams();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !params.id) return;
    apiFetch<Agent>(`/api/v1/agents/${params.id}`, token)
      .then(setAgent)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, params.id]);

  return (
    <AuthGuard>
      <DashboardShell>
        <div className="p-6 max-w-2xl font-mono">
          {loading ? (
            <div className="text-[#555]">Loading...</div>
          ) : !agent ? (
            <div className="text-[#555]">Agent not found</div>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-6 text-[#E0E0E0]">
                <span className="text-[#00FF88] mr-2">&gt;</span>{agent.name}
              </h1>
              <div className="space-y-3">
                <div className="p-4 bg-[#111] border border-[#333]">
                  <div className="text-xs text-[#555] mb-1">{'// Status'}</div>
                  <div className="text-sm text-[#E0E0E0]">{agent.status}</div>
                </div>
                <div className="p-4 bg-[#111] border border-[#333]">
                  <div className="text-xs text-[#555] mb-1">{'// Public Key'}</div>
                  <div className="text-sm font-mono break-all text-[#00FF88]">{agent.publicKey}</div>
                </div>
                <div className="p-4 bg-[#111] border border-[#333]">
                  <div className="text-xs text-[#555] mb-1">{'// Agent ID'}</div>
                  <div className="text-sm font-mono text-[#888]">{agent.id}</div>
                </div>
                {agent.description && (
                  <div className="p-4 bg-[#111] border border-[#333]">
                    <div className="text-xs text-[#555] mb-1">{'// Description'}</div>
                    <div className="text-sm text-[#E0E0E0]">{agent.description}</div>
                  </div>
                )}
                {agent.webhookUrl && (
                  <div className="p-4 bg-[#111] border border-[#333]">
                    <div className="text-xs text-[#555] mb-1">{'// Webhook URL'}</div>
                    <div className="text-sm font-mono text-[#888]">{agent.webhookUrl}</div>
                  </div>
                )}
                <div className="p-4 bg-[#111] border border-[#333]">
                  <div className="text-xs text-[#555] mb-1">{'// Last Seen'}</div>
                  <div className="text-sm text-[#E0E0E0]">{agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString() : 'Never'}</div>
                </div>
                <div className="p-4 bg-[#111] border border-[#333]">
                  <div className="text-xs text-[#555] mb-1">{'// Created'}</div>
                  <div className="text-sm text-[#E0E0E0]">{new Date(agent.createdAt).toLocaleString()}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
