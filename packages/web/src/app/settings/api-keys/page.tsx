'use client';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import { useEffect, useState } from 'react';

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  agentId: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function ApiKeysPage() {
  const { token } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadKeys = async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ data: ApiKeyInfo[] }>('/api/v1/api-keys', token);
      setKeys(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadKeys(); }, [token]);

  const handleRevoke = async (id: string) => {
    if (!token) return;
    try {
      await apiFetch(`/api/v1/api-keys/${id}`, token, { method: 'DELETE' });
      loadKeys();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <AuthGuard>
      <DashboardShell>
        <div className="p-6 max-w-3xl">
          <h1 className="text-2xl font-bold mb-6">API Keys</h1>
          {loading ? (
            <div className="text-zinc-500 text-sm">Loading...</div>
          ) : keys.length === 0 ? (
            <div className="text-zinc-500 text-sm">No API keys. Create agents to generate API keys, or use the CLI to register.</div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div key={key.id} className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{key.name}</div>
                      <div className="text-xs text-zinc-500 font-mono mt-1">{key.keyPrefix}...</div>
                    </div>
                    {!key.revokedAt && (
                      <button
                        onClick={() => handleRevoke(key.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                    <span>Scopes: {key.scopes.join(', ')}</span>
                    {key.revokedAt && <span className="text-red-400">Revoked</span>}
                    {key.lastUsedAt && <span>Last used: {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
