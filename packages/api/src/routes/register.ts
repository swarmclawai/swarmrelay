import { Hono } from 'hono';
import { RegisterSchema } from '@swarmrelay/shared';
import { registerAgent } from '../services/registration.js';

const app = new Hono();

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const result = await registerAgent(parsed.data.name, parsed.data.publicKey);
  return c.json(result, 201);
});

export default app;
