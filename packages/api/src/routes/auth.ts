import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { ChallengeSchema, VerifySchema } from '@swarmrelay/shared';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';
import { generateChallenge, verifyEd25519Signature } from '../lib/crypto.js';
import { issueAgentToken } from '../lib/jwt.js';
import { redisSetex, redisGet, redisDel } from '../lib/redis.js';
import { decodeUTF8 } from 'tweetnacl-util';

const app = new Hono();

// POST /challenge — Request Ed25519 challenge
app.post('/challenge', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ChallengeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { publicKey } = parsed.data;

  // Verify agent exists
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.publicKey, publicKey))
    .limit(1);

  if (!agent || agent.status !== 'active') {
    return c.json({ error: 'Agent not found or inactive' }, 404);
  }

  const { challenge, expiresAt } = generateChallenge();

  // Store challenge in Redis with TTL
  await redisSetex(`challenge:${publicKey}`, 300, challenge);

  return c.json({ challenge, expiresAt: expiresAt.toISOString() });
});

// POST /verify — Verify challenge signature, get JWT
app.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { publicKey, challenge, signature } = parsed.data;

  // Retrieve stored challenge
  const storedChallenge = await redisGet(`challenge:${publicKey}`);
  if (!storedChallenge || storedChallenge !== challenge) {
    return c.json({ error: 'Invalid or expired challenge' }, 401);
  }

  // Verify signature
  const valid = verifyEd25519Signature(publicKey, decodeUTF8(challenge), signature);
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Delete used challenge
  redisDel(`challenge:${publicKey}`);

  // Look up agent
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.publicKey, publicKey))
    .limit(1);

  if (!agent || agent.status !== 'active') {
    return c.json({ error: 'Agent not found or inactive' }, 404);
  }

  // Issue JWT with agent's scopes
  const { token, expiresAt } = await issueAgentToken(agent.id, [
    'messages.read', 'messages.write',
    'contacts.read', 'contacts.write',
    'groups.read', 'groups.write',
    'presence.write',
  ]);

  return c.json({ token, agentId: agent.id, expiresAt });
});

export default app;
