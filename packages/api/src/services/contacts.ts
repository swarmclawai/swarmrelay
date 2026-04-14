import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { contacts, agents } from '../db/schema.js';
import type { AgentContext } from './types.js';
import { ServiceError } from './types.js';

export async function listContacts(
  ctx: AgentContext,
  params: { limit?: number; offset?: number } = {},
) {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.ownerAgentId, ctx.agentId))
    .limit(limit)
    .offset(offset);
  return { data: rows };
}

export async function addContact(
  ctx: AgentContext,
  params: { agentId?: string; publicKey?: string; nickname?: string; notes?: string },
) {
  let contactAgentId = params.agentId;
  if (!contactAgentId && params.publicKey) {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.publicKey, params.publicKey))
      .limit(1);
    if (!agent) throw new ServiceError('not_found', 'Agent not found');
    contactAgentId = agent.id;
  }
  if (!contactAgentId) {
    throw new ServiceError('validation', 'Agent ID or public key required');
  }
  if (contactAgentId === ctx.agentId) {
    throw new ServiceError('validation', 'Cannot add yourself as a contact');
  }

  const [existing] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.ownerAgentId, ctx.agentId), eq(contacts.contactAgentId, contactAgentId)),
    )
    .limit(1);
  if (existing) throw new ServiceError('conflict', 'Contact already exists');

  const [contact] = await db
    .insert(contacts)
    .values({
      ownerAgentId: ctx.agentId,
      contactAgentId,
      nickname: params.nickname ?? null,
      notes: params.notes ?? null,
    })
    .returning();
  return contact;
}

export async function getContact(ctx: AgentContext, id: string) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.ownerAgentId, ctx.agentId)))
    .limit(1);
  if (!contact) throw new ServiceError('not_found', 'Contact not found');
  return contact;
}

export async function updateContact(
  ctx: AgentContext,
  id: string,
  params: { nickname?: string | null; notes?: string | null },
) {
  const [updated] = await db
    .update(contacts)
    .set(params)
    .where(and(eq(contacts.id, id), eq(contacts.ownerAgentId, ctx.agentId)))
    .returning();
  if (!updated) throw new ServiceError('not_found', 'Contact not found');
  return updated;
}

export async function removeContact(ctx: AgentContext, id: string) {
  const [deleted] = await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.ownerAgentId, ctx.agentId)))
    .returning();
  if (!deleted) throw new ServiceError('not_found', 'Contact not found');
  return { success: true };
}

async function setBlocked(ctx: AgentContext, id: string, blocked: boolean) {
  const [updated] = await db
    .update(contacts)
    .set({ blocked })
    .where(and(eq(contacts.id, id), eq(contacts.ownerAgentId, ctx.agentId)))
    .returning();
  if (!updated) throw new ServiceError('not_found', 'Contact not found');
  return updated;
}

export function blockContact(ctx: AgentContext, id: string) {
  return setBlocked(ctx, id, true);
}

export function unblockContact(ctx: AgentContext, id: string) {
  return setBlocked(ctx, id, false);
}
