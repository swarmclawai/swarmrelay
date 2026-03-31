import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { ContactCreateSchema, ContactUpdateSchema, PaginationSchema } from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { db } from '../db/client.js';
import { contacts, agents } from '../db/schema.js';

const app = new Hono<AuthEnv>();

// GET / — List contacts
app.get('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const query = PaginationSchema.parse(c.req.query());
  const rows = await db.select().from(contacts)
    .where(eq(contacts.ownerAgentId, auth.agentId))
    .limit(query.limit).offset(query.offset);
  return c.json({ data: rows });
});

// POST / — Add contact
app.post('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = ContactCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  let contactAgentId = parsed.data.agentId;
  if (!contactAgentId && parsed.data.publicKey) {
    const [agent] = await db.select().from(agents)
      .where(eq(agents.publicKey, parsed.data.publicKey)).limit(1);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    contactAgentId = agent.id;
  }
  if (!contactAgentId) return c.json({ error: 'Agent ID or public key required' }, 400);
  if (contactAgentId === auth.agentId) return c.json({ error: 'Cannot add yourself as a contact' }, 400);

  // Check for existing
  const [existing] = await db.select().from(contacts)
    .where(and(eq(contacts.ownerAgentId, auth.agentId), eq(contacts.contactAgentId, contactAgentId)))
    .limit(1);
  if (existing) return c.json({ error: 'Contact already exists' }, 409);

  const [contact] = await db.insert(contacts).values({
    ownerAgentId: auth.agentId,
    contactAgentId,
    nickname: parsed.data.nickname ?? null,
    notes: parsed.data.notes ?? null,
  }).returning();

  return c.json(contact, 201);
});

// GET /:id — Get contact
app.get('/:id', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const [contact] = await db.select().from(contacts)
    .where(and(eq(contacts.id, c.req.param('id')), eq(contacts.ownerAgentId, auth.agentId)))
    .limit(1);
  if (!contact) return c.json({ error: 'Contact not found' }, 404);
  return c.json(contact);
});

// PATCH /:id — Update contact
app.patch('/:id', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = ContactUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const [updated] = await db.update(contacts).set(parsed.data)
    .where(and(eq(contacts.id, c.req.param('id')), eq(contacts.ownerAgentId, auth.agentId)))
    .returning();
  if (!updated) return c.json({ error: 'Contact not found' }, 404);
  return c.json(updated);
});

// DELETE /:id — Remove contact
app.delete('/:id', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const [deleted] = await db.delete(contacts)
    .where(and(eq(contacts.id, c.req.param('id')), eq(contacts.ownerAgentId, auth.agentId)))
    .returning();
  if (!deleted) return c.json({ error: 'Contact not found' }, 404);
  return c.json({ success: true });
});

// POST /:id/block — Block contact
app.post('/:id/block', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const [updated] = await db.update(contacts).set({ blocked: true })
    .where(and(eq(contacts.id, c.req.param('id')), eq(contacts.ownerAgentId, auth.agentId)))
    .returning();
  if (!updated) return c.json({ error: 'Contact not found' }, 404);
  return c.json(updated);
});

// POST /:id/unblock — Unblock contact
app.post('/:id/unblock', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const [updated] = await db.update(contacts).set({ blocked: false })
    .where(and(eq(contacts.id, c.req.param('id')), eq(contacts.ownerAgentId, auth.agentId)))
    .returning();
  if (!updated) return c.json({ error: 'Contact not found' }, 404);
  return c.json(updated);
});

export default app;
