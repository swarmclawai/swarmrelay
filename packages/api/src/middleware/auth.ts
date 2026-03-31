import type { Context, Next } from 'hono';
import { createHash } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { owners, apiKeys, agents } from '../db/schema.js';
import { verifyIdToken } from '../lib/firebase.js';
import { verifyAgentToken } from '../lib/jwt.js';
import { redisGet, redisSetex } from '../lib/redis.js';
import { API_KEY_PREFIX } from '@swarmrelay/shared';
import type { ApiKeyScope, AgentAuthPayload, DashboardAuthPayload } from '@swarmrelay/shared';

// --- API Key Auth (for agent routes) ---
export async function apiKeyAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing API key' }, 401);
  }
  const token = authHeader.slice(7);
  if (!token.startsWith(API_KEY_PREFIX)) {
    // Could be a JWT from challenge-response
    return challengeAuth(c, next);
  }
  const keyHash = createHash('sha256').update(token).digest('hex');
  const cacheKey = `apikey:${keyHash}`;
  const cached = await redisGet(cacheKey);
  let keyData: { id: string; ownerId: string; agentId: string; scopes: string[] } | null = null;
  if (cached) {
    keyData = JSON.parse(cached);
  } else {
    const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt))).limit(1);
    if (!row) return c.json({ error: 'Invalid API key' }, 401);
    if (row.expiresAt && row.expiresAt < new Date()) return c.json({ error: 'API key expired' }, 401);
    keyData = { id: row.id, ownerId: row.ownerId, agentId: row.agentId, scopes: row.scopes };
    redisSetex(cacheKey, 60, JSON.stringify(keyData));
  }
  c.set('auth', { ownerId: keyData!.ownerId, agentId: keyData!.agentId, scopes: keyData!.scopes as ApiKeyScope[], keyId: keyData!.id } satisfies AgentAuthPayload);
  // Touch lastUsedAt async
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyData!.id)).then(() => {}).catch(() => {});
  await next();
}

// --- Challenge JWT Auth (fallback for Ed25519 challenge-response) ---
async function challengeAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader!.slice(7);
  try {
    const { agentId, scopes } = await verifyAgentToken(token);
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!agent || agent.status !== 'active') return c.json({ error: 'Agent not found or inactive' }, 401);
    c.set('auth', { ownerId: agent.ownerId ?? '', agentId, scopes: scopes as ApiKeyScope[], keyId: '' } satisfies AgentAuthPayload);
    await next();
  } catch {
    return c.json({ error: 'Invalid auth token' }, 401);
  }
}

// --- Firebase Auth (for dashboard routes) ---
export async function firebaseAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing auth token' }, 401);
  }
  const token = authHeader.slice(7);
  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch {
    return c.json({ error: 'Invalid auth token' }, 401);
  }
  // Upsert owner
  const [existing] = await db.select().from(owners).where(eq(owners.firebaseUid, decoded.uid)).limit(1);
  let ownerId: string;
  if (existing) {
    ownerId = existing.id;
    if (existing.email !== (decoded.email ?? null) || existing.displayName !== (decoded.name ?? null)) {
      await db.update(owners).set({ email: decoded.email ?? null, displayName: decoded.name ?? null, avatarUrl: decoded.picture ?? null, updatedAt: new Date() }).where(eq(owners.id, existing.id));
    }
  } else {
    const [newOwner] = await db.insert(owners).values({ firebaseUid: decoded.uid, email: decoded.email ?? null, displayName: decoded.name ?? null, avatarUrl: decoded.picture ?? null }).returning();
    ownerId = newOwner.id;
  }
  c.set('auth', { ownerId, firebaseUid: decoded.uid, email: decoded.email ?? null } satisfies DashboardAuthPayload);
  await next();
}

// --- Scope check ---
export function requireScope(...requiredScopes: ApiKeyScope[]) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AgentAuthPayload | undefined;
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);
    const hasAll = requiredScopes.every((s) => auth.scopes.includes(s));
    if (!hasAll) return c.json({ error: `Missing required scope(s): ${requiredScopes.join(', ')}` }, 403);
    await next();
  };
}
