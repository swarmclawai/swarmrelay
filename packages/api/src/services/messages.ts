import { eq, and, isNull, desc } from 'drizzle-orm';
import { WS_EVENTS, encryptDM, signMessage } from '@swarmrelay/shared';
import util from 'tweetnacl-util';
import { db } from '../db/client.js';
import { conversations, conversationMembers, messages, messageReceipts, agents } from '../db/schema.js';
import { publishConversationEvent } from '../lib/realtime.js';
import { decryptPrivateKey } from '../lib/crypto.js';
import type { AgentContext } from './types.js';
import { ServiceError } from './types.js';

const { decodeUTF8 } = util;

async function verifyMembership(conversationId: string, agentId: string) {
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

export async function listMessages(
  ctx: AgentContext,
  conversationId: string,
  params: { limit?: number; offset?: number } = {},
) {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const membership = await verifyMembership(conversationId, ctx.agentId);
  if (!membership) throw new ServiceError('not_found', 'Conversation not found');

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
  return { data: rows.reverse() };
}

export interface SendMessageParams {
  conversationId: string;
  type: string;
  ciphertext: string;
  nonce: string;
  signature: string;
  replyToId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function sendMessage(ctx: AgentContext, params: SendMessageParams) {
  const membership = await verifyMembership(params.conversationId, ctx.agentId);
  if (!membership) throw new ServiceError('not_found', 'Conversation not found');

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .limit(1);
  if (!conv) throw new ServiceError('not_found', 'Conversation not found');

  if (params.replyToId) {
    const [replyTarget] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.id, params.replyToId),
          eq(messages.conversationId, params.conversationId),
        ),
      )
      .limit(1);
    if (!replyTarget) throw new ServiceError('not_found', 'Reply target not found');
  }

  const [message] = await db
    .insert(messages)
    .values({
      conversationId: params.conversationId,
      senderId: ctx.agentId,
      type: params.type,
      ciphertext: params.ciphertext,
      nonce: params.nonce,
      signature: params.signature,
      replyToId: params.replyToId ?? null,
      metadata: params.metadata ?? {},
    })
    .returning();

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, params.conversationId));

  await publishConversationEvent(params.conversationId, WS_EVENTS.MESSAGE_NEW, {
    id: message.id,
    conversationId: params.conversationId,
    senderId: message.senderId,
    type: message.type,
    createdAt: message.createdAt,
    replyToId: message.replyToId,
    metadata: message.metadata ?? {},
  });

  return message;
}

/**
 * Server-side encrypted DM: decrypts the caller's private key from the DB,
 * runs NaCl box to encrypt the plaintext for the recipient, signs the
 * plaintext, and calls sendMessage. The plaintext private key lives only
 * in this function's scope — it is never logged or persisted.
 *
 * This mirrors the dashboard's server-side decryption pattern
 * (packages/api/src/routes/dashboard.ts) and only works for agents that
 * registered server-side and whose encryptedPrivateKey is held by the API.
 */
export async function sendEncryptedDm(
  ctx: AgentContext,
  params: {
    conversationId: string;
    recipientPublicKey: string;
    plaintext: string;
    type?: string;
  },
) {
  const [agent] = await db
    .select({ encryptedPrivateKey: agents.encryptedPrivateKey })
    .from(agents)
    .where(eq(agents.id, ctx.agentId))
    .limit(1);
  if (!agent || !agent.encryptedPrivateKey) {
    throw new ServiceError(
      'no_agent_key',
      'Server does not hold a private key for this agent; encrypted DM requires a server-registered agent',
    );
  }

  const privateKey = decryptPrivateKey(agent.encryptedPrivateKey);
  const { ciphertext, nonce } = encryptDM(params.plaintext, params.recipientPublicKey, privateKey);
  const signature = signMessage(decodeUTF8(params.plaintext), privateKey);

  return sendMessage(ctx, {
    conversationId: params.conversationId,
    type: params.type ?? 'text',
    ciphertext,
    nonce,
    signature,
  });
}

export interface EditMessageParams {
  ciphertext: string;
  nonce: string;
  signature: string;
}

export async function editMessage(
  ctx: AgentContext,
  messageId: string,
  params: EditMessageParams,
) {
  const [existing] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
    .limit(1);
  if (!existing) throw new ServiceError('not_found', 'Message not found');
  if (existing.senderId !== ctx.agentId) throw new ServiceError('forbidden', 'Not authorized');

  const [updated] = await db
    .update(messages)
    .set({
      ciphertext: params.ciphertext,
      nonce: params.nonce,
      signature: params.signature,
      editedAt: new Date(),
    })
    .where(eq(messages.id, messageId))
    .returning();

  await publishConversationEvent(updated.conversationId, WS_EVENTS.MESSAGE_EDITED, {
    id: updated.id,
    conversationId: updated.conversationId,
    senderId: updated.senderId,
    editedAt: updated.editedAt,
  });

  return updated;
}

export async function deleteMessage(ctx: AgentContext, messageId: string) {
  const [existing] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
    .limit(1);
  if (!existing) throw new ServiceError('not_found', 'Message not found');
  if (existing.senderId !== ctx.agentId) throw new ServiceError('forbidden', 'Not authorized');

  await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId));

  await publishConversationEvent(existing.conversationId, WS_EVENTS.MESSAGE_DELETED, {
    id: existing.id,
    conversationId: existing.conversationId,
    senderId: existing.senderId,
    deletedAt: new Date().toISOString(),
  });

  return { success: true };
}

export async function sendReceipt(
  ctx: AgentContext,
  messageId: string,
  status: 'delivered' | 'read',
) {
  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!msg) throw new ServiceError('not_found', 'Message not found');

  const membership = await verifyMembership(msg.conversationId, ctx.agentId);
  if (!membership) throw new ServiceError('forbidden', 'Not authorized');

  if (msg.senderId === ctx.agentId) {
    throw new ServiceError('validation', 'Cannot receipt your own message');
  }

  const now = new Date();
  const setValues = status === 'read' ? { readAt: now, deliveredAt: now } : { deliveredAt: now };

  const [existingReceipt] = await db
    .select()
    .from(messageReceipts)
    .where(
      and(eq(messageReceipts.messageId, messageId), eq(messageReceipts.agentId, ctx.agentId)),
    )
    .limit(1);

  if (existingReceipt) {
    const updateValues: Record<string, Date> = {};
    if (!existingReceipt.deliveredAt) updateValues.deliveredAt = now;
    if (status === 'read' && !existingReceipt.readAt) updateValues.readAt = now;

    if (Object.keys(updateValues).length > 0) {
      const [updated] = await db
        .update(messageReceipts)
        .set(updateValues)
        .where(eq(messageReceipts.id, existingReceipt.id))
        .returning();

      const receiptEvent = updated.readAt ? WS_EVENTS.RECEIPT_READ : WS_EVENTS.RECEIPT_DELIVERED;
      await publishConversationEvent(msg.conversationId, receiptEvent, {
        id: updated.id,
        messageId: updated.messageId,
        conversationId: msg.conversationId,
        agentId: updated.agentId,
        deliveredAt: updated.deliveredAt,
        readAt: updated.readAt,
      });

      return updated;
    }
    return existingReceipt;
  }

  const [receipt] = await db
    .insert(messageReceipts)
    .values({
      messageId,
      agentId: ctx.agentId,
      ...setValues,
    })
    .returning();

  const receiptEvent = receipt.readAt ? WS_EVENTS.RECEIPT_READ : WS_EVENTS.RECEIPT_DELIVERED;
  await publishConversationEvent(msg.conversationId, receiptEvent, {
    id: receipt.id,
    messageId: receipt.messageId,
    conversationId: msg.conversationId,
    agentId: receipt.agentId,
    deliveredAt: receipt.deliveredAt,
    readAt: receipt.readAt,
  });

  return receipt;
}
