import { Hono } from 'hono';
import { TypingSchema, WS_EVENTS } from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { redisPublish } from '../lib/redis.js';

const app = new Hono<AuthEnv>();

app.post('/', async (c) => {
  const auth = c.get('auth') as AgentAuthPayload;
  const body = await c.req.json().catch(() => ({}));
  const parsed = TypingSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const event = parsed.data.typing ? WS_EVENTS.TYPING_START : WS_EVENTS.TYPING_STOP;
  await redisPublish(`typing:${parsed.data.conversationId}`, JSON.stringify({
    event,
    data: { agentId: auth.agentId, conversationId: parsed.data.conversationId },
  }));

  return c.json({ success: true });
});

export default app;
