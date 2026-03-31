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

  if (loading) return <div className="flex items-center justify-center h-screen text-zinc-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-full max-w-sm p-8 bg-zinc-900 rounded-2xl border border-zinc-800">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-xs font-bold">SR</div>
          <span className="text-lg font-semibold">SwarmRelay</span>
        </div>
        <h1 className="text-2xl font-bold mb-6">Sign in</h1>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="flex flex-col gap-3">
          <button onClick={handleGoogle} className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium transition-colors">
            Continue with Google
          </button>
          <button onClick={handleGithub} className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium transition-colors">
            Continue with GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
