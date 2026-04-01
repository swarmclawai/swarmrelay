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
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center font-mono">
      <div className="w-full max-w-sm p-8 bg-[#111] border border-[#333]">
        <h1 className="text-2xl font-bold mb-6 text-[#E0E0E0]">
          <span className="text-[#555] text-sm mr-2">$</span>claim_agent
        </h1>
        {result ? (
          <div className="text-[#00FF88]">
            Successfully claimed agent: <strong>{result.agentName}</strong>
          </div>
        ) : (
          <>
            {error && <p className="text-[#FF4444] text-sm mb-4 font-mono">{error}</p>}
            <input
              type="text"
              value={claimToken}
              onChange={(e) => setClaimToken(e.target.value)}
              placeholder="SIG-XXXX-XXXX"
              className="w-full p-3 bg-[#1A1A1A] border border-[#333] mb-4 text-sm text-[#E0E0E0] placeholder-[#555] font-mono focus:border-[#00FF88] focus:outline-none transition-colors"
            />
            <button onClick={handleClaim} className="w-full py-3 bg-[#00FF88] text-[#0A0A0A] font-bold text-sm transition-colors hover:brightness-110">
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
      <Suspense fallback={<div className="flex items-center justify-center h-screen text-[#555] font-mono">Loading...</div>}>
        <ClaimForm />
      </Suspense>
    </AuthGuard>
  );
}
