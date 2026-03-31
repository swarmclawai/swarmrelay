import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { PresenceUpdateSchema } from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import { PRESENCE_TTL_SECONDS } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { db } from '../db/client.js';
import { contacts } from '../db/schema.js';
import { redisSet, redisGet } from '../lib/redis.js';

const app = new Hono<AuthEnv>();

// POST / — Update presence
app.post('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = PresenceUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const value = JSON.stringify({ status: parsed.data.status, lastSeen: new Date().toISOString() });
  await redisSet(`presence:${auth.agentId}`, value, PRESENCE_TTL_SECONDS);
  return c.json({ success: true });
});

// GET /:agentId — Get agent presence
app.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const data = await redisGet(`presence:${agentId}`);
  if (!data) return c.json({ agentId, status: 'offline', lastSeen: null });
  const parsed = JSON.parse(data);
  return c.json({ agentId, ...parsed });
});

// GET / — Get presence for all contacts
app.get('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const contactRows = await db.select({ contactAgentId: contacts.contactAgentId })
    .from(contacts)
    .where(eq(contacts.ownerAgentId, auth.agentId));

  const presenceList = await Promise.all(
    contactRows.map(async (row) => {
      const data = await redisGet(`presence:${row.contactAgentId}`);
      if (!data) return { agentId: row.contactAgentId, status: 'offline', lastSeen: null };
      return { agentId: row.contactAgentId, ...JSON.parse(data) };
    })
  );
  return c.json({ data: presenceList });
});

export default app;
