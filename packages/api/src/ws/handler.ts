import { createHash } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import type { WSContext } from 'hono/ws';
import type { WebSocket } from 'ws';
import type { RedisClientType } from 'redis';
import { db } from '../db/client.js';
import { apiKeys, agents, conversationMembers } from '../db/schema.js';
import { redisGet, redisSet } from '../lib/redis.js';
import { verifyAgentToken } from '../lib/jwt.js';
import { addConnection, removeConnection } from './connections.js';
import { API_KEY_PREFIX, PRESENCE_TTL_SECONDS, HEARTBEAT_INTERVAL_MS } from '@swarmrelay/shared';
import { createSubscriber } from '../lib/redis.js';

// Authenticate a WebSocket token (API key or JWT)
async function authenticateToken(token: string): Promise<{ agentId: string } | null> {
  if (token.startsWith(API_KEY_PREFIX)) {
    const keyHash = createHash('sha256').update(token).digest('hex');
    const cached = await redisGet(`apikey:${keyHash}`);
    if (cached) {
      const data = JSON.parse(cached);
      return { agentId: data.agentId };
    }
    const [row] = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    return { agentId: row.agentId };
  }

  // Try JWT
  try {
    const { agentId } = await verifyAgentToken(token);
    return { agentId };
  } catch {
    return null;
  }
}

// Get conversation IDs for an agent
async function getAgentConversationIds(agentId: string): Promise<string[]> {
  const rows = await db.select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.agentId, agentId), isNull(conversationMembers.leftAt)));
  return rows.map(r => r.conversationId);
}

// Set up Redis subscriptions for an agent's conversations
async function setupSubscriptions(agentId: string, ws: WSContext): Promise<RedisClientType | null> {
  const subscriber = await createSubscriber();
  if (!subscriber) return null;

  const conversationIds = await getAgentConversationIds(agentId);

  // Subscribe to message channels for each conversation
  for (const convId of conversationIds) {
    await subscriber.subscribe(`msg:${convId}`, (message: string) => {
      try { ws.send(message); } catch {}
    });
    await subscriber.subscribe(`typing:${convId}`, (message: string) => {
      try { ws.send(message); } catch {}
    });
  }

  // Subscribe to presence updates for this agent
  await subscriber.subscribe(`presence:update`, (message: string) => {
    try { ws.send(message); } catch {}
  });

  return subscriber;
}

function setPresenceOnline(agentId: string) {
  return redisSet(
    `presence:${agentId}`,
    JSON.stringify({ status: 'online', lastSeen: new Date().toISOString() }),
    PRESENCE_TTL_SECONDS,
  );
}

// State tracked per WebSocket connection
interface ConnectionState {
  agentId: string;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  subscriber: RedisClientType | null;
  alive: boolean;
}

const wsState = new WeakMap<WSContext, ConnectionState>();

/**
 * Called when the WebSocket connection opens.
 * Authenticates the token, registers the connection, sets presence, and
 * sets up Redis pub/sub forwarding + heartbeat ping/pong.
 */
export async function handleOpen(ws: WSContext, token: string | null) {
  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  // 1. Authenticate
  const authResult = await authenticateToken(token);
  if (!authResult) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const { agentId } = authResult;

  // 2. Register connection
  addConnection(agentId, ws);

  // 3. Set presence to online
  await setPresenceOnline(agentId);

  // 4. Set up Redis subscriptions
  const subscriber = await setupSubscriptions(agentId, ws);

  // 5. Heartbeat — ping via the underlying ws raw socket
  const state: ConnectionState = {
    agentId,
    heartbeatInterval: null,
    subscriber,
    alive: true,
  };

  const raw = ws.raw as WebSocket | undefined;
  state.heartbeatInterval = setInterval(() => {
    if (!state.alive) {
      ws.close(4002, 'Heartbeat timeout');
      return;
    }
    state.alive = false;
    try { raw?.ping(); } catch {}
  }, HEARTBEAT_INTERVAL_MS);

  // Listen for pong on the raw WebSocket
  if (raw) {
    raw.on('pong', () => {
      state.alive = true;
      // Refresh presence TTL
      setPresenceOnline(agentId);
    });
  }

  wsState.set(ws, state);
}

/**
 * Called when a message is received from the client.
 * In v1 clients use REST to send messages; this is reserved for future
 * client-to-server events.
 */
export function handleMessage(_ws: WSContext, _data: MessageEvent) {
  // No-op in v1 — clients send messages via REST
}

/**
 * Called when the WebSocket connection closes.
 * Cleans up heartbeat, Redis subscriber, and updates last seen.
 */
export async function handleClose(ws: WSContext) {
  const state = wsState.get(ws);
  if (!state) return;

  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  removeConnection(state.agentId, ws);

  // Clean up subscriber
  if (state.subscriber) {
    try { await state.subscriber.quit(); } catch {}
  }

  // Update last seen (presence will expire via TTL)
  await db.update(agents)
    .set({ lastSeenAt: new Date() })
    .where(eq(agents.id, state.agentId))
    .catch(() => {});

  wsState.delete(ws);
}

/**
 * Called when a WebSocket error occurs.
 */
export async function handleError(ws: WSContext) {
  const state = wsState.get(ws);
  if (!state) return;

  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  removeConnection(state.agentId, ws);

  if (state.subscriber) {
    try { state.subscriber.quit(); } catch {}
  }

  wsState.delete(ws);
}
