import { Hono } from 'hono';
import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import { PaginationSchema } from '@swarmrelay/shared';
import { decryptDM, decryptGroupMessage, decryptGroupKeyFromCreator } from '@swarmrelay/shared';
import type { DashboardAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { db } from '../db/client.js';
import { agents, conversations, conversationMembers, messages } from '../db/schema.js';
import { decryptPrivateKey } from '../lib/crypto.js';

const app = new Hono<AuthEnv>();

// GET /conversations — List conversations across ALL of owner's agents
app.get('/conversations', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const query = PaginationSchema.parse(c.req.query());

  // Get all agents belonging to this owner
  const ownerAgents = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.ownerId, auth.ownerId), eq(agents.status, 'active')));

  if (ownerAgents.length === 0) {
    return c.json({ data: [] });
  }

  const agentIds = ownerAgents.map((a) => a.id);

  // Find all conversations these agents belong to
  const memberships = await db.select({
    conversationId: conversationMembers.conversationId,
    agentId: conversationMembers.agentId,
  }).from(conversationMembers)
    .where(and(
      inArray(conversationMembers.agentId, agentIds),
      isNull(conversationMembers.leftAt),
    ));

  if (memberships.length === 0) {
    return c.json({ data: [] });
  }

  const convIds = [...new Set(memberships.map((m) => m.conversationId))];

  const convos = await db.select().from(conversations)
    .where(inArray(conversations.id, convIds))
    .orderBy(desc(conversations.updatedAt))
    .limit(query.limit).offset(query.offset);

  // Enrich with last message and members
  const result = await Promise.all(convos.map(async (conv) => {
    const [lastMessage] = await db.select().from(messages)
      .where(and(eq(messages.conversationId, conv.id), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const members = await db.select({
      agentId: conversationMembers.agentId,
      role: conversationMembers.role,
    }).from(conversationMembers)
      .where(and(
        eq(conversationMembers.conversationId, conv.id),
        isNull(conversationMembers.leftAt),
      ));

    // Identify which of the owner's agents is in this conversation
    const ownerAgentId = memberships.find(
      (m) => m.conversationId === conv.id && agentIds.includes(m.agentId),
    )?.agentId;

    return { ...conv, lastMessage: lastMessage ?? null, members, ownerAgentId };
  }));

  return c.json({ data: result });
});

// GET /conversations/:id — Get decrypted conversation messages
app.get('/conversations/:id', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const conversationId = c.req.param('id');
  const query = PaginationSchema.parse(c.req.query());

  // Get owner's agents
  const ownerAgents = await db.select().from(agents)
    .where(and(eq(agents.ownerId, auth.ownerId), eq(agents.status, 'active')));

  if (ownerAgents.length === 0) {
    return c.json({ error: 'No agents found' }, 404);
  }

  const agentIds = ownerAgents.map((a) => a.id);

  // Verify one of the owner's agents is a member
  const [membership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, conversationId),
      inArray(conversationMembers.agentId, agentIds),
      isNull(conversationMembers.leftAt),
    )).limit(1);

  if (!membership) return c.json({ error: 'Conversation not found' }, 404);

  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.id, conversationId)).limit(1);
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);

  // Get the agent whose key we'll use for decryption
  const decryptAgent = ownerAgents.find((a) => a.id === membership.agentId);
  if (!decryptAgent?.encryptedPrivateKey) {
    return c.json({ error: 'Agent private key not available for decryption' }, 400);
  }

  // Decrypt the agent's private key
  let agentSecretKey: string;
  try {
    agentSecretKey = decryptPrivateKey(decryptAgent.encryptedPrivateKey);
  } catch {
    return c.json({ error: 'Failed to decrypt agent key' }, 500);
  }

  // Get messages
  const rawMessages = await db.select().from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(query.limit).offset(query.offset);

  // Get all members for resolving sender info
  const allMembers = await db.select().from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));

  // Get agent info for all senders
  const senderIds = [...new Set(rawMessages.map((m) => m.senderId))];
  const senderAgents = senderIds.length > 0
    ? await db.select({ id: agents.id, name: agents.name, publicKey: agents.publicKey, avatarUrl: agents.avatarUrl })
        .from(agents).where(inArray(agents.id, senderIds))
    : [];
  const senderMap = new Map(senderAgents.map((a) => [a.id, a]));

  // Attempt to decrypt messages
  const decryptedMessages = rawMessages.reverse().map((msg) => {
    const sender = senderMap.get(msg.senderId);
    let plaintext: string | null = null;

    try {
      if (conv.type === 'dm') {
        // DM: use NaCl box with sender's public key and our secret key
        if (sender) {
          if (msg.senderId === decryptAgent.id) {
            // We sent this message — we need the recipient's public key to decrypt
            const otherMember = allMembers.find(
              (m) => m.agentId !== decryptAgent.id,
            );
            const otherAgent = otherMember ? senderMap.get(otherMember.agentId) : null;
            // For sent messages, we need the other party's public key
            // The decryptDM function uses sender's public key from the recipient's perspective
            if (otherAgent) {
              plaintext = decryptDM(msg.ciphertext, msg.nonce, otherAgent.publicKey, agentSecretKey);
            }
          } else {
            plaintext = decryptDM(msg.ciphertext, msg.nonce, sender.publicKey, agentSecretKey);
          }
        }
      } else if (conv.type === 'group') {
        // Group: need to decrypt the group key first, then use secretbox
        if (membership.encryptedGroupKey && membership.groupKeyNonce) {
          // Find the conversation creator to get their public key for key decryption
          const creatorMember = allMembers.find((m) => m.agentId === conv.createdBy);
          const creatorAgent = conv.createdBy ? senderMap.get(conv.createdBy) : null;

          // If we don't have the creator in senderMap, fetch them
          let creatorPublicKey: string | null = creatorAgent?.publicKey ?? null;
          if (!creatorPublicKey && conv.createdBy) {
            // Will be fetched below if needed
            creatorPublicKey = null;
          }

          if (creatorPublicKey) {
            const groupKey = decryptGroupKeyFromCreator(
              membership.encryptedGroupKey,
              membership.groupKeyNonce,
              creatorPublicKey,
              agentSecretKey,
            );
            plaintext = decryptGroupMessage(msg.ciphertext, msg.nonce, groupKey);
          }
        }
      }
    } catch {
      // Decryption failed — leave plaintext as null
      plaintext = null;
    }

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: sender?.name ?? null,
      senderAvatarUrl: sender?.avatarUrl ?? null,
      type: msg.type,
      plaintext,
      ciphertext: msg.ciphertext,
      nonce: msg.nonce,
      replyToId: msg.replyToId,
      metadata: msg.metadata,
      editedAt: msg.editedAt,
      createdAt: msg.createdAt,
    };
  });

  // Get members with agent info
  const memberDetails = await Promise.all(
    allMembers.filter((m) => !m.leftAt).map(async (m) => {
      const agent = senderMap.get(m.agentId);
      if (agent) return { ...m, agentName: agent.name, agentAvatarUrl: agent.avatarUrl };
      const [a] = await db.select({ name: agents.name, avatarUrl: agents.avatarUrl })
        .from(agents).where(eq(agents.id, m.agentId)).limit(1);
      return { ...m, agentName: a?.name ?? null, agentAvatarUrl: a?.avatarUrl ?? null };
    }),
  );

  return c.json({
    conversation: conv,
    members: memberDetails,
    messages: decryptedMessages,
  });
});

// GET /stats — Overview stats for the owner's dashboard
app.get('/stats', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;

  // Get owner's agents
  const ownerAgents = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.ownerId, auth.ownerId), eq(agents.status, 'active')));

  if (ownerAgents.length === 0) {
    return c.json({ agents: 0, conversations: 0, messages: 0 });
  }

  const agentIds = ownerAgents.map((a) => a.id);

  // Count conversations
  const memberships = await db.select({
    conversationId: conversationMembers.conversationId,
  }).from(conversationMembers)
    .where(and(
      inArray(conversationMembers.agentId, agentIds),
      isNull(conversationMembers.leftAt),
    ));

  const uniqueConvIds = [...new Set(memberships.map((m) => m.conversationId))];

  // Count messages sent by owner's agents
  let messageCount = 0;
  if (agentIds.length > 0) {
    const [result] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(messages)
      .where(inArray(messages.senderId, agentIds));
    messageCount = result.count;
  }

  return c.json({
    agents: ownerAgents.length,
    conversations: uniqueConvIds.length,
    messages: messageCount,
  });
});

export default app;
