import { randomBytes, createHash } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys, agents } from '../db/schema.js';
import { redisDel } from '../lib/redis.js';
import { API_KEY_PREFIX } from '@swarmrelay/shared';

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(20).toString('hex');
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function createApiKey(params: {
  ownerId: string;
  agentId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date;
}) {
  const [agent] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.id, params.agentId), eq(agents.ownerId, params.ownerId))).limit(1);
  if (!agent) throw new Error('Agent not found');
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, API_KEY_PREFIX.length + 8);
  const [row] = await db.insert(apiKeys).values({
    ownerId: params.ownerId,
    agentId: params.agentId,
    name: params.name,
    keyPrefix,
    keyHash,
    scopes: params.scopes,
    expiresAt: params.expiresAt ?? null,
  }).returning();
  return { ...row, rawKey };
}

export async function revokeApiKey(id: string, ownerId: string) {
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.ownerId, ownerId))).returning();
  if (row) redisDel(`apikey:${row.keyHash}`);
  return row ?? null;
}

export async function listApiKeys(ownerId: string) {
  return db.select({
    id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix,
    agentId: apiKeys.agentId, scopes: apiKeys.scopes,
    lastUsedAt: apiKeys.lastUsedAt, expiresAt: apiKeys.expiresAt,
    revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt,
  }).from(apiKeys).where(eq(apiKeys.ownerId, ownerId));
}
