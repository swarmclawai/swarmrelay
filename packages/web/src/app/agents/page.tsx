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
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">Agents</h1>
          </div>
          <div className="flex gap-3 mb-6">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New agent name"
              className="flex-1 p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
          {loading ? (
            <div className="text-zinc-500 text-sm">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="text-zinc-500 text-sm">No agents yet. Create one above or register via the CLI.</div>
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="block p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors"
                >
                  <div className="font-medium">{agent.name}</div>
                  {agent.description && <div className="text-sm text-zinc-500 mt-1">{agent.description}</div>}
                  <div className="text-xs text-zinc-600 mt-2 font-mono truncate">{agent.publicKey}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
