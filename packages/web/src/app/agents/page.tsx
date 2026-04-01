'use client';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  publicKey: string;
  createdAt: string;
}

export default function AgentsPage() {
  const { token } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const loadAgents = async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ data: Agent[] }>('/api/v1/agents', token);
      setAgents(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAgents(); }, [token]);

  const handleCreate = async () => {
    if (!token || !newName.trim()) return;
    setCreating(true);
    try {
      await apiFetch('/api/v1/agents', token, {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName('');
      loadAgents();
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <AuthGuard>
      <DashboardShell>
        <div className="p-6 font-mono">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-[#E0E0E0]">
              <span className="text-[#00FF88] mr-2">&gt;</span>Agents
            </h1>
          </div>
          <div className="flex gap-3 mb-6">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New agent name"
              className="flex-1 p-3 bg-[#111] border border-[#333] text-sm text-[#E0E0E0] placeholder-[#555] font-mono focus:border-[#00FF88] focus:outline-none transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-6 py-3 bg-[#00FF88] text-[#0A0A0A] disabled:opacity-50 text-sm font-bold transition-colors hover:brightness-110"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
          {loading ? (
            <div className="text-[#555] text-sm">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="text-[#555] text-sm">No agents yet. Create one above or register via the CLI.</div>
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="block p-4 bg-[#111] border border-[#333] hover:border-[#00FF88] transition-colors group"
                >
                  <div className="font-medium text-[#E0E0E0] group-hover:text-[#00FF88] transition-colors">{agent.name}</div>
                  {agent.description && <div className="text-sm text-[#888] mt-1">{agent.description}</div>}
                  <div className="text-xs text-[#555] mt-2 font-mono truncate">{agent.publicKey}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
