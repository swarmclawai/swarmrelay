import { eq, and, isNull, desc, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversations, conversationMembers, messages, agents } from '../db/schema.js';
import { logAuditEvent } from './audit.js';
import type { AgentContext } from './types.js';
import { ServiceError } from './types.js';

async function verifyActiveMembership(conversationId: string, agentId: string) {
  const [membership] = await db
    .select()
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.agentId, agentId),
        isNull(conversationMembers.leftAt),
      ),
    )
    .limit(1);
  return membership ?? null;
}

async function verifyAdmin(conversationId: string, agentId: string) {
  const [membership] = await db
    .select()
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.agentId, agentId),
        eq(conversationMembers.role, 'admin'),
        isNull(conversationMembers.leftAt),
      ),
    )
    .limit(1);
  return membership ?? null;
}

async function assertGroup(conversationId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.type, 'group')))
    .limit(1);
  if (!conv) throw new ServiceError('not_found', 'Group conversation not found');
  return conv;
}

export async function listConversations(
  ctx: AgentContext,
  params: { limit?: number; offset?: number } = {},
) {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const memberships = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(
      and(eq(conversationMembers.agentId, ctx.agentId), isNull(conversationMembers.leftAt)),
    );

  if (memberships.length === 0) return { data: [] };

  const convIds = memberships.map((m) => m.conversationId);

  const convos = await db
    .select()
    .from(conversations)
    .where(inArray(conversations.id, convIds))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)
    .offset(offset);

  const result = await Promise.all(
    convos.map(async (conv) => {
      const [lastMessage] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conv.id), isNull(messages.deletedAt)))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      const members = await db
        .select({
          agentId: conversationMembers.agentId,
          role: conversationMembers.role,
          joinedAt: conversationMembers.joinedAt,
        })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conv.id),
            isNull(conversationMembers.leftAt),
          ),
        );

      return { ...conv, lastMessage: lastMessage ?? null, members };
    }),
  );
  return { data: result };
}

export interface CreateConversationParams {
  type: 'dm' | 'group';
  members: string[];
  name?: string;
  description?: string;
}

export async function createConversation(ctx: AgentContext, params: CreateConversationParams) {
  const { type, name, description, members } = params;

  const memberAgents = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.id, members), eq(agents.status, 'active')));
  const validIds = new Set(memberAgents.map((a) => a.id));
  const invalidIds = members.filter((id) => !validIds.has(id));
  if (invalidIds.length > 0) {
    throw new ServiceError('validation', 'Invalid member IDs', invalidIds);
  }

  if (type === 'dm') {
    if (members.length !== 1) {
      throw new ServiceError('validation', 'DM must have exactly one other member');
    }
    const otherAgentId = members[0];
    if (otherAgentId === ctx.agentId) {
      throw new ServiceError('validation', 'Cannot create DM with yourself');
    }

    const existingDms = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(
        and(eq(conversationMembers.agentId, ctx.agentId), isNull(conversationMembers.leftAt)),
      );

    for (const dm of existingDms) {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, dm.conversationId), eq(conversations.type, 'dm')))
        .limit(1);
      if (!conv) continue;

      const [otherMember] = await db
        .select()
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, dm.conversationId),
            eq(conversationMembers.agentId, otherAgentId),
            isNull(conversationMembers.leftAt),
          ),
        )
        .limit(1);

      if (otherMember) return conv;
    }

    const [conv] = await db
      .insert(conversations)
      .values({ type: 'dm', createdBy: ctx.agentId })
      .returning();

    await db.insert(conversationMembers).values([
      { conversationId: conv.id, agentId: ctx.agentId, role: 'member' },
      { conversationId: conv.id, agentId: otherAgentId, role: 'member' },
    ]);

    logAuditEvent({
      eventType: 'conversation.created',
      actorId: ctx.agentId,
      targetId: conv.id,
      targetType: 'conversation',
      ownerId: ctx.ownerId,
      payload: { type: 'dm', otherAgentId },
    });

    return conv;
  }

  if (!name) throw new ServiceError('validation', 'Group name is required');

  const allMembers = [...new Set([ctx.agentId, ...members])];

  const [conv] = await db
    .insert(conversations)
    .values({ type: 'group', name, description: description ?? null, createdBy: ctx.agentId })
    .returning();

  await db.insert(conversationMembers).values(
    allMembers.map((agentId) => ({
      conversationId: conv.id,
      agentId,
      role: agentId === ctx.agentId ? ('admin' as const) : ('member' as const),
    })),
  );

  logAuditEvent({
    eventType: 'conversation.created',
    actorId: ctx.agentId,
    targetId: conv.id,
    targetType: 'conversation',
    ownerId: ctx.ownerId,
    payload: { type: 'group', name, memberCount: allMembers.length },
  });

  return conv;
}

export async function getConversation(ctx: AgentContext, id: string) {
  const membership = await verifyActiveMembership(id, ctx.agentId);
  if (!membership) throw new ServiceError('not_found', 'Conversation not found');

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) throw new ServiceError('not_found', 'Conversation not found');

  const members = await db
    .select({
      id: conversationMembers.id,
      agentId: conversationMembers.agentId,
      role: conversationMembers.role,
      joinedAt: conversationMembers.joinedAt,
      leftAt: conversationMembers.leftAt,
    })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, id));

  const recentMessages = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, id), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(20);

  return { ...conv, members, recentMessages: recentMessages.reverse() };
}

export async function updateConversation(
  ctx: AgentContext,
  id: string,
  params: { name?: string; description?: string },
) {
  const admin = await verifyAdmin(id, ctx.agentId);
  if (!admin) throw new ServiceError('forbidden', 'Not authorized');

  const [updated] = await db
    .update(conversations)
    .set({ ...params, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  if (!updated) throw new ServiceError('not_found', 'Conversation not found');
  return updated;
}

export async function leaveConversation(ctx: AgentContext, id: string) {
  const membership = await verifyActiveMembership(id, ctx.agentId);
  if (!membership) throw new ServiceError('not_found', 'Conversation not found');

  await db
    .update(conversationMembers)
    .set({ leftAt: new Date() })
    .where(eq(conversationMembers.id, membership.id));

  logAuditEvent({
    eventType: 'conversation.left',
    actorId: ctx.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: ctx.ownerId,
  });

  return { success: true };
}

export async function addMembers(
  ctx: AgentContext,
  id: string,
  memberIds: string[],
) {
  await assertGroup(id);
  const admin = await verifyAdmin(id, ctx.agentId);
  if (!admin) throw new ServiceError('forbidden', 'Not authorized');

  const memberAgents = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.id, memberIds), eq(agents.status, 'active')));
  const validIds = new Set(memberAgents.map((a) => a.id));
  const invalidIds = memberIds.filter((mid) => !validIds.has(mid));
  if (invalidIds.length > 0) {
    throw new ServiceError('validation', 'Invalid member IDs', invalidIds);
  }

  const existingMembers = await db
    .select()
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, id),
        inArray(conversationMembers.agentId, memberIds),
      ),
    );

  const existingMap = new Map(existingMembers.map((m) => [m.agentId, m]));
  const toInsert: string[] = [];
  const toRejoin: string[] = [];

  for (const memberId of memberIds) {
    const existing = existingMap.get(memberId);
    if (!existing) toInsert.push(memberId);
    else if (existing.leftAt) toRejoin.push(existing.id);
  }

  if (toInsert.length > 0) {
    await db.insert(conversationMembers).values(
      toInsert.map((agentId) => ({
        conversationId: id,
        agentId,
        role: 'member' as const,
      })),
    );
  }

  if (toRejoin.length > 0) {
    await db
      .update(conversationMembers)
      .set({ leftAt: null, joinedAt: new Date() })
      .where(inArray(conversationMembers.id, toRejoin));
  }

  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id));

  logAuditEvent({
    eventType: 'conversation.members_added',
    actorId: ctx.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: ctx.ownerId,
    payload: { added: memberIds },
  });

  return { success: true, added: toInsert.length, rejoined: toRejoin.length };
}

export async function removeMember(
  ctx: AgentContext,
  id: string,
  targetAgentId: string,
) {
  await assertGroup(id);
  const admin = await verifyAdmin(id, ctx.agentId);
  if (!admin) throw new ServiceError('forbidden', 'Not authorized');

  if (targetAgentId === ctx.agentId) {
    throw new ServiceError('validation', 'Use leaveConversation to leave');
  }

  const membership = await verifyActiveMembership(id, targetAgentId);
  if (!membership) throw new ServiceError('not_found', 'Member not found');

  await db
    .update(conversationMembers)
    .set({ leftAt: new Date() })
    .where(eq(conversationMembers.id, membership.id));

  logAuditEvent({
    eventType: 'conversation.member_removed',
    actorId: ctx.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: ctx.ownerId,
    payload: { removedAgentId: targetAgentId },
  });

  return { success: true };
}

export async function rotateGroupKey(ctx: AgentContext, id: string) {
  const conv = await assertGroup(id);
  const admin = await verifyAdmin(id, ctx.agentId);
  if (!admin) throw new ServiceError('forbidden', 'Not authorized');

  const newVersion = conv.groupKeyVersion + 1;

  await db
    .update(conversations)
    .set({ groupKeyVersion: newVersion, updatedAt: new Date() })
    .where(eq(conversations.id, id));

  logAuditEvent({
    eventType: 'conversation.key_rotated',
    actorId: ctx.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: ctx.ownerId,
    payload: { newVersion },
  });

  return { success: true, groupKeyVersion: newVersion };
}
