import { Hono } from 'hono';
import { ClaimSchema } from '@swarmrelay/shared';
import type { DashboardAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { claimAgent, ClaimError } from '../services/registration.js';

const app = new Hono<AuthEnv>();

// POST / — Claim agent with token
app.post('/', async (c) => {
  const auth = c.get('auth') as DashboardAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = ClaimSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  try {
    const result = await claimAgent(parsed.data.claimToken, auth.firebaseUid);
    return c.json(result);
  } catch (err) {
    if (err instanceof ClaimError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    throw err;
  }
});

export default app;
