import { eq, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { owners, agents, a2aAgents } from '../db/schema.js';
import { generateKeyPair, encryptPrivateKey, verifyEd25519Signature } from './crypto.js';
import { redisGet, redisSetex } from './redis.js';
import { A2A_PROTOCOL_VERSION, A2A_AGENT_CARD_CACHE_TTL } from '@swarmrelay/shared';
import type { A2AAgentCard } from '@swarmrelay/shared';

// --- Signature Verification ---

/**
 * Verify an Ed25519 signature on an A2A JSON-RPC request body.
 * The signature is computed over the raw JSON body bytes.
 */
export async function verifyA2ASignature(
  agentId: string,
  body: unknown,
  signatureBase64: string,
): Promise<boolean> {
  // Look up the agent's public key from the a2a_agents cache
  const [agent] = await db.select({ publicKey: a2aAgents.publicKey })
    .from(a2aAgents).where(eq(a2aAgents.id, agentId)).limit(1);

  if (!agent?.publicKey) return false;

  const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
  return verifyEd25519Signature(agent.publicKey, bodyBytes, signatureBase64);
}

// --- Agent Card Generation ---

/**
 * Generate an A2A Agent Card for a SwarmRelay agent,
 * making it discoverable by external A2A-compatible systems.
 */
export async function generateAgentCard(agentId: string) {
  const [agent] = await db.select().from(agents)
    .where(eq(agents.id, agentId)).limit(1);

  if (!agent) return null;

  return {
    name: agent.name,
    description: agent.description ?? `SwarmRelay agent: ${agent.name}`,
    version: '1.0.0',
    protocolVersion: A2A_PROTOCOL_VERSION,
    apiEndpoint: `${process.env.API_URL ?? 'http://localhost:3500'}/a2a/relay`,
    capabilities: [
      {
        name: 'encrypted_messaging',
        methods: ['sendMessage', 'getStatus', 'discoverAgent'],
        description: 'End-to-end encrypted agent communication',
      },
      {
        name: 'task_coordination',
        methods: ['cancelTask', 'getResult'],
        description: 'Coordinate multi-agent task execution',
      },
    ],
    skills: [],
    authMethods: ['ed25519'],
    publicKey: agent.publicKey,
    supportsStreaming: false,
    supportsAsync: true,
    extensions: [
      {
        name: 'swarmrelay_e2e',
        version: '1.0.0',
        url: 'https://github.com/swarmclawai/swarmrelay',
      },
    ],
    metadata: {
      relayVersion: '1.0.0',
      cryptoScheme: 'nacl-box',
      conversationBased: true,
    },
  };
}

// --- Agent Discovery & Caching ---

/**
 * Discover an external A2A agent by fetching its agent card.
 * Caches results in both Redis (short TTL) and the a2a_agents table (persistent).
 */
export async function discoverExternalAgent(
  identifier: string,
  options?: { agentUrl?: string; publicKey?: string },
): Promise<A2AAgentCard | null> {
  // Check Redis cache first
  const cacheKey = `a2a:agent_card:${identifier}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  // Check DB cache
  const conditions = [eq(a2aAgents.id, identifier)];
  if (options?.agentUrl) conditions.push(eq(a2aAgents.apiEndpoint, options.agentUrl));
  if (options?.publicKey) conditions.push(eq(a2aAgents.publicKey, options.publicKey));

  const [existing] = await db.select().from(a2aAgents)
    .where(conditions.length > 1 ? or(...conditions) : conditions[0])
    .limit(1);

  if (existing) {
    const card: A2AAgentCard = {
      id: existing.id,
      publicKey: existing.publicKey,
      agentCard: existing.agentCard as Record<string, unknown>,
      apiEndpoint: existing.apiEndpoint,
      isTrusted: existing.isTrusted,
      discoveredAt: existing.discoveredAt.toISOString(),
      lastSeen: existing.lastSeen.toISOString(),
    };
    // Update last seen (fire-and-forget with error logging)
    db.update(a2aAgents).set({ lastSeen: new Date() })
      .where(eq(a2aAgents.id, existing.id))
      .then(() => {}).catch((err) => console.error('[A2A] lastSeen update failed:', err));
    await redisSetex(cacheKey, A2A_AGENT_CARD_CACHE_TTL, JSON.stringify(card));
    return card;
  }

  // Fetch agent card from remote (with timeout)
  const url = options?.agentUrl ?? identifier;
  try {
    const response = await fetch(`${url}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const remoteCard = await response.json();

    // Cache in DB
    const [inserted] = await db.insert(a2aAgents).values({
      id: identifier,
      publicKey: remoteCard.publicKey ?? options?.publicKey ?? '',
      agentCard: remoteCard,
      apiEndpoint: remoteCard.apiEndpoint ?? url,
    }).onConflictDoUpdate({
      target: a2aAgents.id,
      set: {
        lastSeen: new Date(),
        agentCard: remoteCard,
      },
    }).returning();

    const card: A2AAgentCard = {
      id: inserted.id,
      publicKey: inserted.publicKey,
      agentCard: inserted.agentCard as Record<string, unknown>,
      apiEndpoint: inserted.apiEndpoint,
      isTrusted: inserted.isTrusted,
      discoveredAt: inserted.discoveredAt.toISOString(),
      lastSeen: inserted.lastSeen.toISOString(),
    };

    await redisSetex(cacheKey, A2A_AGENT_CARD_CACHE_TTL, JSON.stringify(card));
    return card;
  } catch {
    return null;
  }
}

// --- Credential Management ---

/**
 * Resolve an external A2A agent identifier to a SwarmRelay agent.
 * If the external agent doesn't exist as a SwarmRelay agent yet,
 * creates a proxy agent entry so it can participate in conversations.
 *
 * Lookup order:
 * 1. If identifier is a UUID, look up directly in agents table
 * 2. Check a2a_agents table for a cached entry, then find linked SwarmRelay agent
 * 3. Look up agents with metadata.externalId matching
 * 4. Create a new proxy agent
 */
export async function resolveA2AAgent(externalAgentId: string): Promise<{
  id: string;
  publicKey: string;
  encryptedPrivateKey: string | null;
}> {
  const selectFields = {
    id: agents.id,
    publicKey: agents.publicKey,
    encryptedPrivateKey: agents.encryptedPrivateKey,
  };

  // 1. If it looks like a UUID, try direct lookup
  if (/^[0-9a-f-]{36}$/i.test(externalAgentId)) {
    const [direct] = await db.select(selectFields).from(agents)
      .where(eq(agents.id, externalAgentId)).limit(1);
    if (direct) return direct;
  }

  // 2. Check a2a_agents for a cached entry with a known public key
  const [a2aAgent] = await db.select({ publicKey: a2aAgents.publicKey })
    .from(a2aAgents).where(eq(a2aAgents.id, externalAgentId)).limit(1);

  if (a2aAgent?.publicKey) {
    const [byKey] = await db.select(selectFields).from(agents)
      .where(eq(agents.publicKey, a2aAgent.publicKey)).limit(1);
    if (byKey) return byKey;
  }

  // 3. Find an existing proxy agent by its metadata.externalId
  const [byMeta] = await db.select(selectFields).from(agents)
    .where(eq(agents.name, `a2a-${externalAgentId.slice(0, 16)}`)).limit(1);
  if (byMeta) return byMeta;

  // 4. Create a proxy agent for this external A2A agent
  // Create an owner for the proxy agent so it's manageable
  const [owner] = await db.insert(owners).values({}).returning();

  const kp = generateKeyPair();
  const encryptedSk = encryptPrivateKey(kp.secretKey);

  const [agent] = await db.insert(agents).values({
    ownerId: owner.id,
    name: `a2a-${externalAgentId.slice(0, 16)}`,
    publicKey: kp.publicKey,
    encryptedPrivateKey: encryptedSk,
    status: 'active',
    metadata: { a2a: true, externalId: externalAgentId },
  } as typeof agents.$inferInsert).returning();

  return {
    id: agent.id,
    publicKey: agent.publicKey,
    encryptedPrivateKey: agent.encryptedPrivateKey,
  };
}

// --- JSON-RPC Helpers ---

export function jsonRpcSuccess(id: string | number | undefined, result: unknown) {
  return { jsonrpc: '2.0' as const, result, id };
}

export function jsonRpcError(
  id: string | number | undefined,
  code: number,
  message: string,
  data?: unknown,
) {
  return { jsonrpc: '2.0' as const, error: { code, message, data }, id };
}
