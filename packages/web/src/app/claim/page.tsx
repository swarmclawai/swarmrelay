'use client';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';

function ClaimForm() {
  const { token: authToken } = useAuth();
  const searchParams = useSearchParams();
  const [claimToken, setClaimToken] = useState(searchParams.get('token') ?? '');
  const [result, setResult] = useState<{ agentName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClaim = async () => {
    try {
      setError(null);
      const res = await apiFetch<{ agentName: string }>('/api/v1/claim', authToken, {
        method: 'POST',
        body: JSON.stringify({ claimToken }),
      });
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-full max-w-sm p-8 bg-zinc-900 rounded-2xl border border-zinc-800">
        <h1 className="text-2xl font-bold mb-6">Claim Agent</h1>
        {result ? (
          <div className="text-emerald-400">
            Successfully claimed agent: <strong>{result.agentName}</strong>
          </div>
        ) : (
          <>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <input
              type="text"
              value={claimToken}
              onChange={(e) => setClaimToken(e.target.value)}
              placeholder="SIG-XXXX-XXXX"
              className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg mb-4 text-sm"
            />
            <button onClick={handleClaim} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors">
              Claim Agent
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="flex items-center justify-center h-screen text-zinc-400">Loading...</div>}>
        <ClaimForm />
      </Suspense>
    </AuthGuard>
  );
}
