import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { owners, agents, apiKeys, claimTokens } from '../db/schema.js';
import { redisDel } from '../lib/redis.js';
import { generateKeyPair, encryptPrivateKey } from '../lib/crypto.js';
import { createApiKey } from './apikeys.js';
import { logAuditEvent } from './audit.js';
import { CLAIM_TOKEN_PREFIX, CLAIM_TOKEN_EXPIRY_DAYS, API_KEY_SCOPES } from '@swarmrelay/shared';
import { randomBytes } from 'node:crypto';

const ALPHANUMERIC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomAlphanumeric(length: number): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
  }
  return result;
}

export function generateClaimToken(): string {
  return `${CLAIM_TOKEN_PREFIX}-${randomAlphanumeric(4)}-${randomAlphanumeric(4)}`;
}

export async function registerAgent(name?: string, publicKey?: string) {
  // 1. Create unclaimed owner
  const [owner] = await db.insert(owners).values({}).returning();

  // 2. Generate or accept keypair
  let agentPublicKey = publicKey;
  let encryptedSecretKey: string | null = null;
  let returnPrivateKey: string | undefined;

  if (!publicKey) {
    const kp = generateKeyPair();
    agentPublicKey = kp.publicKey;
    encryptedSecretKey = encryptPrivateKey(kp.secretKey);
    returnPrivateKey = kp.secretKey;
  }

  // 3. Create agent
  const agentName = name ?? `agent-${owner.id.slice(0, 8)}`;
  const [agent] = await db.insert(agents).values({
    ownerId: owner.id,
    name: agentName,
    publicKey: agentPublicKey!,
    encryptedPrivateKey: encryptedSecretKey,
  }).returning();

  // 4. Create API key with all scopes
  const { rawKey } = await createApiKey({
    ownerId: owner.id,
    agentId: agent.id,
    name: `${agentName}-default`,
    scopes: [...API_KEY_SCOPES],
  });

  // 5. Create claim token
  const token = generateClaimToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CLAIM_TOKEN_EXPIRY_DAYS);

  await db.insert(claimTokens).values({
    token,
    ownerId: owner.id,
    agentId: agent.id,
    expiresAt,
  });

  // 6. Audit
  logAuditEvent({
    eventType: 'agent.self_registered',
    actorId: owner.id,
    targetId: agent.id,
    targetType: 'agent',
    ownerId: owner.id,
    payload: { agentName, claimToken: token },
  });

  const baseUrl = process.env.DASHBOARD_URL ?? 'https://swarmrelay.ai';

  return {
    apiKey: rawKey,
    agentId: agent.id,
    ownerId: owner.id,
    publicKey: agentPublicKey!,
    ...(returnPrivateKey ? { privateKey: returnPrivateKey } : {}),
    claimToken: token,
    claimUrl: `${baseUrl}/claim?token=${token}`,
  };
}

export class ClaimError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClaimError';
    this.status = status;
  }
}

export async function claimAgent(claimToken: string, firebaseOwnerId: string) {
  const [tokenRecord] = await db.select().from(claimTokens).where(eq(claimTokens.token, claimToken)).limit(1);
  if (!tokenRecord) throw new ClaimError('Invalid claim token', 404);
  if (tokenRecord.expiresAt < new Date()) throw new ClaimError('Claim token has expired', 410);
  if (tokenRecord.claimedAt) throw new ClaimError('Claim token has already been used', 409);

  const oldOwnerId = tokenRecord.ownerId;
  const agentId = tokenRecord.agentId;

  const [existingOwner] = await db.select().from(owners).where(eq(owners.firebaseUid, firebaseOwnerId)).limit(1);
  let newOwnerId: string;
  if (existingOwner) {
    newOwnerId = existingOwner.id;
  } else {
    const [newOwner] = await db.insert(owners).values({ firebaseUid: firebaseOwnerId }).returning();
    newOwnerId = newOwner.id;
  }

  const now = new Date();
  const { agentName, transferredKeyHashes } = await db.transaction(async (tx) => {
    const [updatedAgent] = await tx.update(agents).set({ ownerId: newOwnerId, updatedAt: now }).where(and(eq(agents.id, agentId), eq(agents.ownerId, oldOwnerId!))).returning({ name: agents.name });
    if (!updatedAgent) throw new ClaimError('Agent not found', 404);

    const transferredKeys = await tx.update(apiKeys).set({ ownerId: newOwnerId }).where(and(eq(apiKeys.ownerId, oldOwnerId!), eq(apiKeys.agentId, agentId))).returning({ keyHash: apiKeys.keyHash });

    await tx.update(claimTokens).set({ claimedAt: now }).where(eq(claimTokens.id, tokenRecord.id));

    return { agentName: updatedAgent.name, transferredKeyHashes: transferredKeys.map((k) => k.keyHash) };
  });

  for (const keyHash of transferredKeyHashes) {
    redisDel(`apikey:${keyHash}`);
  }

  logAuditEvent({
    eventType: 'agent.claimed',
    actorId: newOwnerId,
    targetId: agentId,
    targetType: 'agent',
    ownerId: newOwnerId,
    payload: { claimToken, oldOwnerId },
  });

  return { ownerId: newOwnerId, agentId, agentName };
}
