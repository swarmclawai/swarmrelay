import { Hono } from 'hono';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { MessageSendSchema, MessageEditSchema, MessageListSchema, ReceiptCreateSchema } from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { db } from '../db/client.js';
import { conversations, conversationMembers, messages, messageReceipts } from '../db/schema.js';

// --- Conversation-scoped message routes ---
// Mounted at /api/v1/conversations/:conversationId/messages

export const conversationMessages = new Hono<AuthEnv>();

// Helper: verify agent is a member of the conversation
async function verifyMembership(conversationId: string, agentId: string) {
  const [membership] = await db.select().from(conversationMembers)
    .where(and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.agentId, agentId),
      isNull(conversationMembers.leftAt),
    )).limit(1);
  return membership ?? null;
}

// GET / — List messages for a conversation (paginated)
conversationMessages.get('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const conversationId = c.req.param('conversationId') as string;
  const query = MessageListSchema.parse(c.req.query());

  const membership = await verifyMembership(conversationId, auth.agentId);
  if (!membership) return c.json({ error: 'Conversation not found' }, 404);

  const rows = await db.select().from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(query.limit).offset(query.offset);

  return c.json({ data: rows.reverse() });
});

// POST / — Send a message
conversationMessages.post('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const conversationId = c.req.param('conversationId') as string;
  const body = await c.req.json().catch(() => ({}));
  const parsed = MessageSendSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const membership = await verifyMembership(conversationId, auth.agentId);
  if (!membership) return c.json({ error: 'Conversation not found' }, 404);

  // Verify conversation exists
  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.id, conversationId)).limit(1);
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);

  // If replying, verify the reply target exists in this conversation
  if (parsed.data.replyToId) {
    const [replyTarget] = await db.select({ id: messages.id }).from(messages)
      .where(and(
        eq(messages.id, parsed.data.replyToId),
        eq(messages.conversationId, conversationId),
      )).limit(1);
    if (!replyTarget) return c.json({ error: 'Reply target not found' }, 404);
  }

  const [message] = await db.insert(messages).values({
    conversationId,
    senderId: auth.agentId,
    type: parsed.data.type,
    ciphertext: parsed.data.ciphertext,
    nonce: parsed.data.nonce,
    signature: parsed.data.signature,
    replyToId: parsed.data.replyToId ?? null,
    metadata: parsed.data.metadata ?? {},
  }).returning();

  // Update conversation's updatedAt
  await db.update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return c.json(message, 201);
});

// --- Flat message routes ---
// Mounted at /api/v1/messages

export const messageOperations = new Hono<AuthEnv>();

// PATCH /:messageId — Edit message (sender only)
messageOperations.patch('/:messageId', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const messageId = c.req.param('messageId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = MessageEditSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  // Verify sender owns this message
  const [existing] = await db.select().from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
    .limit(1);
  if (!existing) return c.json({ error: 'Message not found' }, 404);
  if (existing.senderId !== auth.agentId) return c.json({ error: 'Not authorized' }, 403);

  const [updated] = await db.update(messages).set({
    ciphertext: parsed.data.ciphertext,
    nonce: parsed.data.nonce,
    signature: parsed.data.signature,
    editedAt: new Date(),
  }).where(eq(messages.id, messageId)).returning();

  return c.json(updated);
});

// DELETE /:messageId — Soft delete message (sender only)
messageOperations.delete('/:messageId', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const messageId = c.req.param('messageId');

  const [existing] = await db.select().from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
    .limit(1);
  if (!existing) return c.json({ error: 'Message not found' }, 404);
  if (existing.senderId !== auth.agentId) return c.json({ error: 'Not authorized' }, 403);

  await db.update(messages)
    .set({ deletedAt: new Date() })
    .where(eq(messages.id, messageId));

  return c.json({ success: true });
});

// POST /:messageId/receipts — Create delivery/read receipt
messageOperations.post('/:messageId/receipts', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const messageId = c.req.param('messageId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = ReceiptCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  // Verify message exists
  const [msg] = await db.select().from(messages)
    .where(eq(messages.id, messageId)).limit(1);
  if (!msg) return c.json({ error: 'Message not found' }, 404);

  // Verify agent is a member of the conversation
  const membership = await verifyMembership(msg.conversationId, auth.agentId);
  if (!membership) return c.json({ error: 'Not authorized' }, 403);

  // Don't create receipt for own messages
  if (msg.senderId === auth.agentId) {
    return c.json({ error: 'Cannot receipt your own message' }, 400);
  }

  // Upsert receipt
  const now = new Date();
  const setValues = parsed.data.status === 'read'
    ? { readAt: now, deliveredAt: now }
    : { deliveredAt: now };

  const [existingReceipt] = await db.select().from(messageReceipts)
    .where(and(
      eq(messageReceipts.messageId, messageId),
      eq(messageReceipts.agentId, auth.agentId),
    )).limit(1);

  if (existingReceipt) {
    // Update: only advance state (don't overwrite read with delivered)
    const updateValues: Record<string, Date> = {};
    if (!existingReceipt.deliveredAt) updateValues.deliveredAt = now;
    if (parsed.data.status === 'read' && !existingReceipt.readAt) updateValues.readAt = now;

    if (Object.keys(updateValues).length > 0) {
      const [updated] = await db.update(messageReceipts)
        .set(updateValues)
        .where(eq(messageReceipts.id, existingReceipt.id))
        .returning();
      return c.json(updated);
    }
    return c.json(existingReceipt);
  }

  const [receipt] = await db.insert(messageReceipts).values({
    messageId,
    agentId: auth.agentId,
    ...setValues,
  }).returning();

  return c.json(receipt, 201);
});
