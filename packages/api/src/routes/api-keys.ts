import { Hono } from 'hono';
import { ApiKeyCreateSchema } from '@swarmrelay/shared';
import type { DashboardAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { createApiKey, revokeApiKey, listApiKeys } from '../services/apikeys.js';

const app = new Hono<AuthEnv>();

// POST / — Create API key
app.post('/', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = ApiKeyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  try {
    const result = await createApiKey({
      ownerId: auth.ownerId,
      agentId: parsed.data.agentId,
      name: parsed.data.name,
      scopes: [...parsed.data.scopes],
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    });
    return c.json({
      id: result.id,
      name: result.name,
      keyPrefix: result.keyPrefix,
      apiKey: result.rawKey,
      scopes: result.scopes,
      createdAt: result.createdAt,
    }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// GET / — List owner's keys
app.get('/', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const keys = await listApiKeys(auth.ownerId);
  return c.json({ data: keys });
});

// DELETE /:id — Revoke key
app.delete('/:id', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const id = c.req.param('id');
  const revoked = await revokeApiKey(id, auth.ownerId);
  if (!revoked) return c.json({ error: 'API key not found' }, 404);
  return c.json({ success: true });
});

export default app;
