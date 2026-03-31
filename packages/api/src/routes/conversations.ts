import { Hono } from 'hono';
import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import {
  ConversationCreateSchema, ConversationUpdateSchema, ConversationListSchema,
  AddMembersSchema,
} from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { db } from '../db/client.js';
import { conversations, conversationMembers, messages, agents } from '../db/schema.js';
import { logAuditEvent } from '../services/audit.js';

const app = new Hono<AuthEnv>();

// GET / — List conversations for the authenticated agent
app.get('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const query = ConversationListSchema.parse(c.req.query());

  // Find conversations where this agent is a member and hasn't left
  const memberships = await db.select({
    conversationId: conversationMembers.conversationId,
  }).from(conversationMembers)
    .where(and(
      eq(conversationMembers.agentId, auth.agentId),
      isNull(conversationMembers.leftAt),
    ));

  if (memberships.length === 0) {
    return c.json({ data: [] });
  }

  const convIds = memberships.map((m) => m.conversationId);

  const convos = await db.select().from(conversations)
    .where(inArray(conversations.id, convIds))
    .orderBy(desc(conversations.updatedAt))
    .limit(query.limit).offset(query.offset);

  // Get last message for each conversation
  const result = await Promise.all(convos.map(async (conv) => {
    const [lastMessage] = await db.select().from(messages)
      .where(and(eq(messages.conversationId, conv.id), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    // Get members
    const members = await db.select({
      agentId: conversationMembers.agentId,
      role: conversationMembers.role,
      joinedAt: conversationMembers.joinedAt,
    }).from(conversationMembers)
      .where(and(
        eq(conversationMembers.conversationId, conv.id),
        isNull(conversationMembers.leftAt),
      ));

    return { ...conv, lastMessage: lastMessage ?? null, members };
  }));

  return c.json({ data: result });
});

// POST / — Create a DM or group conversation
app.post('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = ConversationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { type, name, description, members } = parsed.data;

  // Validate all member agent IDs exist
  const memberAgents = await db.select({ id: agents.id }).from(agents)
    .where(and(inArray(agents.id, members), eq(agents.status, 'active')));
  const validIds = new Set(memberAgents.map((a) => a.id));
  const invalidIds = members.filter((id) => !validIds.has(id));
  if (invalidIds.length > 0) {
    return c.json({ error: 'Invalid member IDs', details: invalidIds }, 400);
  }

  if (type === 'dm') {
    // DMs must have exactly 1 other member
    if (members.length !== 1) {
      return c.json({ error: 'DM must have exactly one other member' }, 400);
    }
    const otherAgentId = members[0];
    if (otherAgentId === auth.agentId) {
      return c.json({ error: 'Cannot create DM with yourself' }, 400);
    }

    // Check for existing DM between these two agents
    const existingDms = await db.select({
      conversationId: conversationMembers.conversationId,
    }).from(conversationMembers)
      .where(and(
        eq(conversationMembers.agentId, auth.agentId),
        isNull(conversationMembers.leftAt),
      ));

    for (const dm of existingDms) {
      const [conv] = await db.select().from(conversations)
        .where(and(eq(conversations.id, dm.conversationId), eq(conversations.type, 'dm')))
        .limit(1);
      if (!conv) continue;

      const [otherMember] = await db.select().from(conversationMembers)
        .where(and(
          eq(conversationMembers.conversationId, dm.conversationId),
          eq(conversationMembers.agentId, otherAgentId),
          isNull(conversationMembers.leftAt),
        )).limit(1);

      if (otherMember) {
        // Existing DM found, return it
        return c.json(conv);
      }
    }

    // Create new DM
    const [conv] = await db.insert(conversations).values({
      type: 'dm',
      createdBy: auth.agentId,
    }).returning();

    // Add both members
    await db.insert(conversationMembers).values([
      { conversationId: conv.id, agentId: auth.agentId, role: 'member' },
      { conversationId: conv.id, agentId: otherAgentId, role: 'member' },
    ]);

    logAuditEvent({
      eventType: 'conversation.created',
      actorId: auth.agentId,
      targetId: conv.id,
      targetType: 'conversation',
      ownerId: auth.ownerId,
      payload: { type: 'dm', otherAgentId },
    });

    return c.json(conv, 201);
  }

  // Group conversation
  if (!name) {
    return c.json({ error: 'Group name is required' }, 400);
  }

  const allMembers = [...new Set([auth.agentId, ...members])];

  const [conv] = await db.insert(conversations).values({
    type: 'group',
    name,
    description: description ?? null,
    createdBy: auth.agentId,
  }).returning();

  // Add all members — creator is admin
  await db.insert(conversationMembers).values(
    allMembers.map((agentId) => ({
      conversationId: conv.id,
      agentId,
      role: agentId === auth.agentId ? ('admin' as const) : ('member' as const),
    })),
  );

  logAuditEvent({
    eventType: 'conversation.created',
    actorId: auth.agentId,
    targetId: conv.id,
    targetType: 'conversation',
    ownerId: auth.ownerId,
    payload: { type: 'group', name, memberCount: allMembers.length },
  });

  return c.json(conv, 201);
});

// GET /:id — Get conversation details
app.get('/:id', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const id = c.req.param('id');

  // Verify membership
  const [membership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.agentId, auth.agentId),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  if (!membership) return c.json({ error: 'Conversation not found' }, 404);

  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.id, id)).limit(1);
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);

  // Get members
  const members = await db.select({
    id: conversationMembers.id,
    agentId: conversationMembers.agentId,
    role: conversationMembers.role,
    joinedAt: conversationMembers.joinedAt,
    leftAt: conversationMembers.leftAt,
  }).from(conversationMembers)
    .where(eq(conversationMembers.conversationId, id));

  // Get recent messages
  const recentMessages = await db.select().from(messages)
    .where(and(eq(messages.conversationId, id), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(20);

  return c.json({ ...conv, members, recentMessages: recentMessages.reverse() });
});

// PATCH /:id — Update group conversation (admin only)
app.patch('/:id', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = ConversationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  // Verify admin membership
  const [membership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.agentId, auth.agentId),
      eq(conversationMembers.role, 'admin'),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  if (!membership) return c.json({ error: 'Not authorized' }, 403);

  const [updated] = await db.update(conversations)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  if (!updated) return c.json({ error: 'Conversation not found' }, 404);
  return c.json(updated);
});

// DELETE /:id — Leave conversation (set leftAt)
app.delete('/:id', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const id = c.req.param('id');

  const [membership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.agentId, auth.agentId),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  if (!membership) return c.json({ error: 'Conversation not found' }, 404);

  await db.update(conversationMembers)
    .set({ leftAt: new Date() })
    .where(eq(conversationMembers.id, membership.id));

  logAuditEvent({
    eventType: 'conversation.left',
    actorId: auth.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: auth.ownerId,
  });

  return c.json({ success: true });
});

// POST /:id/members — Add members to group (admin only)
app.post('/:id/members', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = AddMembersSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  // Verify conversation is a group and caller is admin
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.type, 'group')))
    .limit(1);
  if (!conv) return c.json({ error: 'Group conversation not found' }, 404);

  const [adminMembership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.agentId, auth.agentId),
      eq(conversationMembers.role, 'admin'),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  if (!adminMembership) return c.json({ error: 'Not authorized' }, 403);

  // Validate member agent IDs
  const memberAgents = await db.select({ id: agents.id }).from(agents)
    .where(and(inArray(agents.id, parsed.data.members), eq(agents.status, 'active')));
  const validIds = new Set(memberAgents.map((a) => a.id));
  const invalidIds = parsed.data.members.filter((mid) => !validIds.has(mid));
  if (invalidIds.length > 0) {
    return c.json({ error: 'Invalid member IDs', details: invalidIds }, 400);
  }

  // Check for existing members (including those who left — rejoin them)
  const existingMembers = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      inArray(conversationMembers.agentId, parsed.data.members),
    ));

  const existingMap = new Map(existingMembers.map((m) => [m.agentId, m]));
  const toInsert: string[] = [];
  const toRejoin: string[] = [];

  for (const memberId of parsed.data.members) {
    const existing = existingMap.get(memberId);
    if (!existing) {
      toInsert.push(memberId);
    } else if (existing.leftAt) {
      toRejoin.push(existing.id);
    }
    // Already an active member — skip silently
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
    await db.update(conversationMembers)
      .set({ leftAt: null, joinedAt: new Date() })
      .where(inArray(conversationMembers.id, toRejoin));
  }

  // Update conversation timestamp
  await db.update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, id));

  logAuditEvent({
    eventType: 'conversation.members_added',
    actorId: auth.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: auth.ownerId,
    payload: { added: parsed.data.members },
  });

  return c.json({ success: true, added: toInsert.length, rejoined: toRejoin.length });
});

// DELETE /:id/members/:agentId — Remove member from group (admin only)
app.delete('/:id/members/:agentId', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const id = c.req.param('id');
  const targetAgentId = c.req.param('agentId');

  // Verify conversation is a group and caller is admin
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.type, 'group')))
    .limit(1);
  if (!conv) return c.json({ error: 'Group conversation not found' }, 404);

  const [adminMembership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.agentId, auth.agentId),
      eq(conversationMembers.role, 'admin'),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  if (!adminMembership) return c.json({ error: 'Not authorized' }, 403);

  // Cannot remove yourself via this endpoint (use DELETE /:id instead)
  if (targetAgentId === auth.agentId) {
    return c.json({ error: 'Use DELETE /conversations/:id to leave' }, 400);
  }

  const [membership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.agentId, targetAgentId),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  if (!membership) return c.json({ error: 'Member not found' }, 404);

  await db.update(conversationMembers)
    .set({ leftAt: new Date() })
    .where(eq(conversationMembers.id, membership.id));

  logAuditEvent({
    eventType: 'conversation.member_removed',
    actorId: auth.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: auth.ownerId,
    payload: { removedAgentId: targetAgentId },
  });

  return c.json({ success: true });
});

// POST /:id/key-rotate — Rotate group key version (admin only)
app.post('/:id/key-rotate', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const id = c.req.param('id');

  // Verify conversation is a group and caller is admin
  const [conv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.type, 'group')))
    .limit(1);
  if (!conv) return c.json({ error: 'Group conversation not found' }, 404);

  const [adminMembership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, id),
      eq(conversationMembers.agentId, auth.agentId),
      eq(conversationMembers.role, 'admin'),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  if (!adminMembership) return c.json({ error: 'Not authorized' }, 403);

  const newVersion = conv.groupKeyVersion + 1;

  await db.update(conversations)
    .set({ groupKeyVersion: newVersion, updatedAt: new Date() })
    .where(eq(conversations.id, id));

  logAuditEvent({
    eventType: 'conversation.key_rotated',
    actorId: auth.agentId,
    targetId: id,
    targetType: 'conversation',
    ownerId: auth.ownerId,
    payload: { newVersion },
  });

  return c.json({ success: true, groupKeyVersion: newVersion });
});

export default app;
