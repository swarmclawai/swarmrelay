import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { AgentCreateSchema, AgentUpdateSchema } from '@swarmrelay/shared';
import type { DashboardAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';
import { generateKeyPair, encryptPrivateKey } from '../lib/crypto.js';
import { logAuditEvent } from '../services/audit.js';

const app = new Hono<AuthEnv>();

// POST / — Create agent
app.post('/', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = AgentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const kp = generateKeyPair();

  const [agent] = await db
    .insert(agents)
    .values({
      ownerId: auth.ownerId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      avatarUrl: parsed.data.avatarUrl ?? null,
      webhookUrl: parsed.data.webhookUrl ?? null,
      metadata: parsed.data.metadata ?? {},
      publicKey: kp.publicKey,
      encryptedPrivateKey: encryptPrivateKey(kp.secretKey),
    })
    .returning();

  logAuditEvent({
    eventType: 'agent.created',
    actorId: auth.ownerId,
    targetId: agent.id,
    targetType: 'agent',
    ownerId: auth.ownerId,
  });

  return c.json(agent, 201);
});

// GET / — List owner's agents
app.get('/', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.ownerId, auth.ownerId), eq(agents.status, 'active')));
  return c.json({ data: rows });
});

// GET /:id — Get agent detail
app.get('/:id', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const id = c.req.param('id');
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.ownerId, auth.ownerId)))
    .limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

// PATCH /:id — Update agent
app.patch('/:id', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = AgentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [updated] = await db
    .update(agents)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.ownerId, auth.ownerId)))
    .returning();

  if (!updated) return c.json({ error: 'Agent not found' }, 404);
  return c.json(updated);
});

// DELETE /:id — Archive agent
app.delete('/:id', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const id = c.req.param('id');
  const [archived] = await db
    .update(agents)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.ownerId, auth.ownerId)))
    .returning();

  if (!archived) return c.json({ error: 'Agent not found' }, 404);

  logAuditEvent({
    eventType: 'agent.archived',
    actorId: auth.ownerId,
    targetId: id,
    targetType: 'agent',
    ownerId: auth.ownerId,
  });

  return c.json({ success: true });
});

export default app;
