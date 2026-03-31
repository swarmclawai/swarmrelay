'use client';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface ConversationPreview {
  id: string;
  type: string;
  name: string | null;
  lastMessage?: { content: string; createdAt: string; senderName: string };
  memberCount: number;
}

export default function InboxPage() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ data: ConversationPreview[] }>('/api/v1/dashboard/conversations', token)
      .then((res) => setConversations(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <AuthGuard>
      <DashboardShell>
        <div className="flex h-full">
          <div className="w-80 border-r border-zinc-800 flex flex-col">
            <div className="p-4 border-b border-zinc-800">
              <h2 className="text-lg font-semibold">Inbox</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-zinc-500 text-sm">Loading conversations...</div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-zinc-500 text-sm">No conversations yet</div>
              ) : (
                conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/inbox/${conv.id}`}
                    className="flex items-center gap-3 p-4 hover:bg-zinc-900 transition-colors border-b border-zinc-800/50"
                  >
                    <div className="w-10 h-10 bg-zinc-700 rounded-full flex items-center justify-center text-sm">
                      {(conv.name ?? 'DM').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{conv.name ?? 'Direct Message'}</div>
                      {conv.lastMessage && (
                        <div className="text-xs text-zinc-500 truncate">
                          {conv.lastMessage.senderName}: {conv.lastMessage.content}
                        </div>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            Select a conversation to start messaging
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
