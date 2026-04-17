import { Hono } from 'hono';
import { eq, and, or, desc, isNull, count, sql } from 'drizzle-orm';
import {
  A2AJsonRpcSchema, A2ASendMessageParamsSchema, A2AGetStatusParamsSchema,
  A2ACancelTaskParamsSchema, A2ADiscoverAgentParamsSchema,
  A2A_PROTOCOL_VERSION, A2A_TASK_STATUS_CACHE_TTL, WS_EVENTS,
} from '@swarmrelay/shared';
import type { A2ATaskStatus } from '@swarmrelay/shared';
import { db } from '../db/client.js';
import {
  conversations, conversationMembers, messages, agents, a2aTasks, a2aAgents,
} from '../db/schema.js';
import {
  verifyA2ASignature, generateAgentCard, resolveA2AAgent,
  discoverExternalAgent, jsonRpcSuccess, jsonRpcError,
} from '../lib/a2a.js';
import { decryptPrivateKey } from '../lib/crypto.js';
import { encryptDM, signMessage } from '@swarmrelay/shared';
import { publishNatsEvent } from '../lib/nats.js';
import { redisDel, redisGet, redisSetex } from '../lib/redis.js';
import { logAuditEvent } from '../services/audit.js';
import { publishConversationEvent } from '../lib/realtime.js';

const MUTATING_METHODS = new Set(['sendMessage', 'cancelTask']);

const a2a = new Hono();

// --- POST /relay — Main JSON-RPC endpoint ---

a2a.post('/relay', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(jsonRpcError(undefined, -32700, 'Parse error'), 400);
  }

  const parsed = A2AJsonRpcSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(jsonRpcError(body.id, -32600, 'Invalid request', parsed.error.flatten()), 400);
  }

  const { method, params, id } = parsed.data;

  // Verify Ed25519 signature
  const signature = c.req.header('x-a2a-signature');
  const agentId = c.req.header('x-a2a-agent-id');

  if (signature && agentId) {
    const valid = await verifyA2ASignature(agentId, body, signature);
    if (!valid) {
      return c.json(jsonRpcError(id, -32000, 'Authentication failed'), 401);
    }
  } else if (MUTATING_METHODS.has(method)) {
    // Mutating methods require authentication
    return c.json(jsonRpcError(id, -32000, 'Authentication required for mutating methods. Provide x-a2a-agent-id and x-a2a-signature headers.'), 401);
  }

  try {
    switch (method) {
      case 'sendMessage':
        return c.json(jsonRpcSuccess(id, await handleSendMessage(params)));
      case 'getStatus':
        return c.json(jsonRpcSuccess(id, await handleGetStatus(params)));
      case 'cancelTask':
        return c.json(jsonRpcSuccess(id, await handleCancelTask(params)));
      case 'getResult':
        return c.json(jsonRpcSuccess(id, await handleGetStatus(params)));
      case 'discoverAgent':
        return c.json(jsonRpcSuccess(id, await handleDiscoverAgent(params)));
      default:
        return c.json(jsonRpcError(id, -32601, 'Method not found'), 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return c.json(jsonRpcError(id, -32603, message), 500);
  }
});

// --- GET /.well-known/agent-card.json — Agent discovery endpoint ---

a2a.get('/.well-known/agent-card.json', async (c) => {
  const agentId = c.req.query('agentId');
  if (!agentId) {
    return c.json({ error: 'agentId query parameter required' }, 400);
  }

  const card = await generateAgentCard(agentId);
  if (!card) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json(card);
});

// --- GET /health — A2A health check ---

a2a.get('/health', (c) => {
  return c.json({
    status: 'ok',
    protocolVersion: A2A_PROTOCOL_VERSION,
    supportsStreaming: false,
    supportsAsync: true,
  });
});

// --- Handler: sendMessage ---

async function handleSendMessage(params: Record<string, unknown>) {
  const parsed = A2ASendMessageParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${parsed.error.message}`);
  }

  const { fromAgent, toAgent, message, taskId, correlationId, metadata: extraMeta } = parsed.data;

  // Resolve both agents to SwarmRelay identities
  const [fromCred, toCred] = await Promise.all([
    resolveA2AAgent(fromAgent),
    resolveA2AAgent(toAgent),
  ]);

  // Find or create a DM conversation between the two agents
  const conversation = await getOrCreateA2AConversation(fromCred.id, toCred.id);

  // Encrypt the message using the sender's private key + recipient's public key
  if (!fromCred.encryptedPrivateKey) {
    throw new Error('Sender agent has no private key available for encryption');
  }

  const senderSecretKey = decryptPrivateKey(fromCred.encryptedPrivateKey);
  const plaintext = JSON.stringify(message);
  const encrypted = encryptDM(plaintext, toCred.publicKey, senderSecretKey);

  // Sign the ciphertext
  const ciphertextBytes = new TextEncoder().encode(encrypted.ciphertext);
  const sig = signMessage(ciphertextBytes, senderSecretKey);

  // Determine message type from metadata or default to task_request
  const messageType = (extraMeta?.messageType as string) ?? 'task_request';

  // Store the encrypted message
  const [storedMessage] = await db.insert(messages).values({
    conversationId: conversation.id,
    senderId: fromCred.id,
    type: messageType,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    signature: sig,
    metadata: {
      a2a: {
        enabled: true,
        taskId: taskId ?? null,
        correlationId: correlationId ?? null,
        fromAgent,
        toAgent,
        status: 'submitted',
        startedAt: new Date().toISOString(),
      },
      ...extraMeta,
    },
  }).returning();

  // Update conversation timestamp
  db.update(conversations).set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id))
    .then(() => {}).catch((err) => console.error('[A2A] conversation update failed:', err));

  // Create task record
  const effectiveTaskId = taskId ?? `task-${storedMessage.id}`;
  const effectiveCorrelationId = correlationId ?? `corr-${storedMessage.id}`;

  await db.insert(a2aTasks).values({
    id: effectiveTaskId,
    correlationId: effectiveCorrelationId,
    conversationId: conversation.id,
    fromAgent,
    toAgent,
    status: 'submitted',
    metadata: { messageId: storedMessage.id, ...extraMeta },
  }).onConflictDoNothing();

  // Publish to NATS
  await publishNatsEvent('swarmrelay.a2a.message_new', {
    type: 'a2a.message.new',
    data: {
      messageId: storedMessage.id,
      conversationId: conversation.id,
      fromAgent,
      toAgent,
      taskId: effectiveTaskId,
      correlationId: effectiveCorrelationId,
    },
    timestamp: new Date().toISOString(),
    originInstanceId: process.env.INSTANCE_ID ?? 'api',
    agentId: fromCred.id,
    conversationId: conversation.id,
  });

  // Publish to Redis for WebSocket delivery
  await publishConversationEvent(conversation.id, WS_EVENTS.MESSAGE_NEW, {
    id: storedMessage.id,
    conversationId: conversation.id,
    senderId: fromCred.id,
    type: messageType,
    createdAt: storedMessage.createdAt,
    metadata: storedMessage.metadata as Record<string, unknown> ?? {},
  });

  // Audit
  logAuditEvent({
    eventType: 'a2a.message.sent',
    actorId: fromCred.id,
    targetId: toCred.id,
    targetType: 'agent',
    payload: { taskId: effectiveTaskId, correlationId: effectiveCorrelationId },
  });

  return {
    messageId: storedMessage.id,
    conversationId: conversation.id,
    taskId: effectiveTaskId,
    status: 'delivered' as const,
    encryptedAt: new Date().toISOString(),
  };
}

// --- Handler: getStatus ---

async function handleGetStatus(params: Record<string, unknown>) {
  const parsed = A2AGetStatusParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${parsed.error.message}`);
  }

  const { taskId, correlationId } = parsed.data;

  // Check Redis cache first
  const cacheKey = `a2a:task_status:${taskId ?? correlationId}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  // Find the task
  const conditions = [];
  if (taskId) conditions.push(eq(a2aTasks.id, taskId));
  if (correlationId) conditions.push(eq(a2aTasks.correlationId, correlationId));

  const [task] = await db.select().from(a2aTasks)
    .where(conditions.length > 1 ? or(...conditions) : conditions[0])
    .limit(1);

  if (!task) {
    throw new Error(`Task not found: ${taskId ?? correlationId}`);
  }

  // Count messages in the conversation
  const [{ value: messageCount }] = await db.select({ value: count() })
    .from(messages)
    .where(and(
      eq(messages.conversationId, task.conversationId),
      isNull(messages.deletedAt),
    ));

  // Get latest message
  const [latestMessage] = await db.select({
    id: messages.id,
    createdAt: messages.createdAt,
  }).from(messages)
    .where(and(
      eq(messages.conversationId, task.conversationId),
      isNull(messages.deletedAt),
    ))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const result = {
    taskId: task.id,
    correlationId: task.correlationId,
    conversationId: task.conversationId,
    status: task.status as A2ATaskStatus,
    messageCount,
    latestMessage: latestMessage ? {
      id: latestMessage.id,
      timestamp: latestMessage.createdAt.toISOString(),
    } : undefined,
    result: task.result ?? undefined,
    errorMessage: task.errorMessage ?? undefined,
    updatedAt: task.updatedAt.toISOString(),
  };

  // Cache the status (use short TTL for non-terminal states, longer for terminal)
  const ttl = (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
    ? A2A_TASK_STATUS_CACHE_TTL
    : 60;
  redisSetex(cacheKey, ttl, JSON.stringify(result));

  return result;
}

// --- Handler: cancelTask ---

async function handleCancelTask(params: Record<string, unknown>) {
  const parsed = A2ACancelTaskParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${parsed.error.message}`);
  }

  const { taskId, reason } = params as { taskId: string; reason?: string };

  const [task] = await db.select().from(a2aTasks)
    .where(eq(a2aTasks.id, taskId)).limit(1);

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new Error(`Task ${taskId} is already ${task.status}`);
  }

  await db.update(a2aTasks).set({
    status: 'cancelled',
    errorMessage: reason ?? null,
    updatedAt: new Date(),
  }).where(eq(a2aTasks.id, taskId));

  await Promise.all([
    redisDel(`a2a:task_status:${task.id}`),
    redisDel(`a2a:task_status:${task.correlationId}`),
  ]);

  // Publish cancellation event
  await publishNatsEvent('swarmrelay.a2a.task_cancelled', {
    type: 'a2a.task.cancelled',
    data: { taskId, reason: reason ?? null },
    timestamp: new Date().toISOString(),
    originInstanceId: process.env.INSTANCE_ID ?? 'api',
    conversationId: task.conversationId,
  });

  logAuditEvent({
    eventType: 'a2a.task.cancelled',
    targetId: taskId,
    targetType: 'a2a_task',
    payload: { reason },
  });

  return {
    success: true,
    taskId,
    cancelledAt: new Date().toISOString(),
  };
}

// --- Handler: discoverAgent ---

async function handleDiscoverAgent(params: Record<string, unknown>) {
  const parsed = A2ADiscoverAgentParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${parsed.error.message}`);
  }

  const { agentId: aid, agentUrl, publicKey } = parsed.data;

  // If agentId looks like a UUID, check if it's a SwarmRelay agent
  if (aid && /^[0-9a-f-]{36}$/i.test(aid)) {
    const card = await generateAgentCard(aid);
    if (card) return card;
  }

  // Otherwise discover as an external agent
  const identifier = aid ?? agentUrl ?? publicKey!;
  const agent = await discoverExternalAgent(identifier, { agentUrl, publicKey });

  if (!agent) {
    throw new Error(`Agent not found: ${identifier}`);
  }

  return agent;
}

// --- Helpers ---

/**
 * Find an existing DM conversation between two agents,
 * or create one if it doesn't exist.
 * Uses a subquery join to avoid N+1 queries.
 */
async function getOrCreateA2AConversation(agent1Id: string, agent2Id: string) {
  // Single query: find DM conversations where both agents are active members
  const result = await db
    .select({ id: conversations.id, type: conversations.type, name: conversations.name,
      description: conversations.description, avatarUrl: conversations.avatarUrl,
      createdBy: conversations.createdBy, groupKeyVersion: conversations.groupKeyVersion,
      metadata: conversations.metadata, createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt })
    .from(conversations)
    .innerJoin(conversationMembers, and(
      eq(conversationMembers.conversationId, conversations.id),
      eq(conversationMembers.agentId, agent1Id),
      isNull(conversationMembers.leftAt),
    ))
    .where(and(
      eq(conversations.type, 'dm'),
      sql`EXISTS (
        SELECT 1 FROM conversation_members cm2
        WHERE cm2.conversation_id = ${conversations.id}
        AND cm2.agent_id = ${agent2Id}
        AND cm2.left_at IS NULL
      )`,
    ))
    .limit(1);

  if (result.length > 0) return result[0];

  // Create new DM conversation
  const [conv] = await db.insert(conversations).values({
    type: 'dm',
    createdBy: agent1Id,
    metadata: { a2a: true },
  }).returning();

  // Add both agents as members
  await db.insert(conversationMembers).values([
    { conversationId: conv.id, agentId: agent1Id, role: 'member' },
    { conversationId: conv.id, agentId: agent2Id, role: 'member' },
  ]);

  return conv;
}

export default a2a;
