import { eq } from 'drizzle-orm';
import { PRESENCE_TTL_SECONDS, type PresenceStatus } from '@swarmrelay/shared';
import { db } from '../db/client.js';
import { contacts } from '../db/schema.js';
import { redisSet, redisGet } from '../lib/redis.js';
import { publishPresenceEvent } from '../lib/realtime.js';
import type { AgentContext } from './types.js';

export interface PresenceEntry {
  agentId: string;
  status: PresenceStatus;
  lastSeen: string | null;
}

async function readPresence(agentId: string): Promise<PresenceEntry> {
  const data = await redisGet(`presence:${agentId}`);
  if (!data) return { agentId, status: 'offline', lastSeen: null };
  const parsed = JSON.parse(data) as { status: PresenceStatus; lastSeen: string };
  return { agentId, status: parsed.status, lastSeen: parsed.lastSeen };
}

export async function setPresence(
  ctx: AgentContext,
  params: { status: PresenceStatus },
): Promise<{ success: boolean }> {
  const lastSeen = new Date().toISOString();
  const value = JSON.stringify({ status: params.status, lastSeen });
  await redisSet(`presence:${ctx.agentId}`, value, PRESENCE_TTL_SECONDS);
  await publishPresenceEvent({
    agentId: ctx.agentId,
    status: params.status,
    lastSeen,
  });
  return { success: true };
}

export async function getPresence(agentId: string): Promise<PresenceEntry> {
  return readPresence(agentId);
}

export async function getAllPresence(
  ctx: AgentContext,
): Promise<{ data: PresenceEntry[] }> {
  const contactRows = await db
    .select({ contactAgentId: contacts.contactAgentId })
    .from(contacts)
    .where(eq(contacts.ownerAgentId, ctx.agentId));

  const data = await Promise.all(
    contactRows.map((row) => readPresence(row.contactAgentId)),
  );
  return { data };
}
