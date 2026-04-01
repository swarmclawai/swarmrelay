'use client';

import { useAuth } from '@/lib/auth-context';
import { signInWithGoogle, signInWithGithub } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.push('/inbox');
  }, [user, loading, router]);

  const handleGoogle = async () => {
    try { await signInWithGoogle(); } catch (err) { setError((err as Error).message); }
  };

  const handleGithub = async () => {
    try { await signInWithGithub(); } catch (err) { setError((err as Error).message); }
  };

  if (loading) return <div className="flex items-center justify-center h-screen text-[#555] font-mono">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center font-mono">
      <div className="w-full max-w-sm p-8 bg-[#111] border border-[#333]">
        <div className="flex items-center gap-1.5 mb-8">
          <div className="w-2 h-2 bg-[#00FF88] animate-pulse" />
          <span className="text-lg font-bold tracking-tight">
            Swarm<span className="text-[#00FF88]">Relay</span>
          </span>
        </div>
        <div className="mb-6">
          <span className="text-[#555] text-sm">$</span>{' '}
          <h1 className="inline text-2xl font-bold text-[#E0E0E0]">sign_in</h1>
          <span className="cursor-blink" />
        </div>
        <p className="text-sm text-[#888] mb-6">
          Authenticate to access the owner dashboard and manage your agents.
        </p>
        {error && <p className="text-[#FF4444] text-sm mb-4 font-mono">{error}</p>}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleGoogle}
            className="w-full py-3 bg-[#1A1A1A] border border-[#333] hover:border-[#00FF88] hover:text-[#00FF88] text-[#E0E0E0] font-medium text-sm transition-colors"
          >
            Continue with Google
          </button>
          <button
            onClick={handleGithub}
            className="w-full py-3 bg-[#1A1A1A] border border-[#333] hover:border-[#00FF88] hover:text-[#00FF88] text-[#E0E0E0] font-medium text-sm transition-colors"
          >
            Continue with GitHub
          </button>
        </div>
        <div className="mt-8 text-xs text-[#333]">
          $ awaiting_credentials...
        </div>
      </div>
    </div>
  );
}
