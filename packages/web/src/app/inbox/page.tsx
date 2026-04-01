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
        <div className="flex h-full font-mono">
          <div className="w-80 border-r border-[#333] flex flex-col bg-[#0A0A0A]">
            <div className="p-4 border-b border-[#333]">
              <h2 className="text-sm font-bold text-[#E0E0E0]">
                <span className="text-[#00FF88] mr-1">&gt;</span>
                Inbox
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-[#555] text-sm">Loading conversations...</div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-[#555] text-sm">No conversations yet</div>
              ) : (
                conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/inbox/${conv.id}`}
                    className="flex items-center gap-3 p-4 hover:bg-[#111] transition-colors border-b border-[#333]/50 group"
                  >
                    <div className="w-10 h-10 bg-[#1A1A1A] border border-[#333] flex items-center justify-center text-xs text-[#00FF88] font-mono">
                      {(conv.name ?? 'DM').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate text-[#E0E0E0] group-hover:text-[#00FF88] transition-colors">
                        {conv.name ?? 'Direct Message'}
                      </div>
                      {conv.lastMessage && (
                        <div className="text-xs text-[#555] truncate">
                          {conv.lastMessage.senderName}: {conv.lastMessage.content}
                        </div>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center text-[#555] font-mono text-sm">
            <span className="text-[#333]">&gt;</span>{' '}Select a conversation to start messaging
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
