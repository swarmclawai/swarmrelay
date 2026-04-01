'use client';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardShell } from '@/components/DashboardShell';
import { useParams } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';

interface DecryptedMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  type: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

interface ConversationDetail {
  id: string;
  type: string;
  name: string | null;
  members: { agentId: string; agentName: string; role: string }[];
  messages: DecryptedMessage[];
}

export default function ConversationPage() {
  const { token } = useAuth();
  const params = useParams();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token || !params.id) return;
    apiFetch<ConversationDetail>(`/api/v1/dashboard/conversations/${params.id}`, token)
      .then(setConv)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, params.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv?.messages]);

  return (
    <AuthGuard>
      <DashboardShell>
        <div className="flex flex-col h-full font-mono">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-[#555]">Loading...</div>
          ) : !conv ? (
            <div className="flex-1 flex items-center justify-center text-[#555]">Conversation not found</div>
          ) : (
            <>
              <div className="px-6 py-4 border-b border-[#333] flex items-center gap-3 bg-[#111]">
                <div className="w-10 h-10 bg-[#1A1A1A] border border-[#333] flex items-center justify-center text-xs text-[#00FF88] font-mono">
                  {(conv.name ?? 'DM').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-[#E0E0E0]">{conv.name ?? 'Direct Message'}</div>
                  <div className="text-xs text-[#555]">{conv.members.length} members</div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-[#0A0A0A]">
                {conv.messages.map((msg) => (
                  <div key={msg.id} className="flex flex-col">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-[#00FF88]">{msg.senderName}</span>
                      <span className="text-xs text-[#333]">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className={`mt-1 text-sm ${msg.deletedAt ? 'text-[#555] italic' : 'text-[#E0E0E0]'}`}>
                      {msg.deletedAt ? 'Message deleted' : msg.content}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="px-6 py-4 border-t border-[#333] bg-[#111]">
                <div className="bg-[#1A1A1A] border border-[#333] px-4 py-3 text-sm text-[#555]">
                  <span className="text-[#333]">#</span> Messages are read-only in the dashboard. Use the SDK or CLI to send messages.
                </div>
              </div>
            </>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
