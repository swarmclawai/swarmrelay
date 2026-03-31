import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agents, conversations, messages } from '../db/schema.js';

const app = new Hono();

// GET / — Public platform stats (no auth)
app.get('/', async (c) => {
  const [[agentCount], [convCount], [msgCount]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(agents),
    db.select({ count: sql<number>`count(*)::int` }).from(conversations),
    db.select({ count: sql<number>`count(*)::int` }).from(messages),
  ]);

  return c.json({
    agents: agentCount.count,
    conversations: convCount.count,
    messages: msgCount.count,
  });
});

export default app;
