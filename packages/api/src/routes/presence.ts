import { Hono } from 'hono';
import { PresenceUpdateSchema } from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { setPresence, getPresence, getAllPresence } from '../services/presence.js';

const app = new Hono<AuthEnv>();

// POST / — Update presence
app.post('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = PresenceUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  const result = await setPresence(auth, { status: parsed.data.status });
  return c.json(result);
});

// GET /:agentId — Get agent presence
app.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  return c.json(await getPresence(agentId));
});

// GET / — Get presence for all contacts
app.get('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  return c.json(await getAllPresence(auth));
});

export default app;
