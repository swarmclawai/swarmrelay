import { Hono } from 'hono';
import { and, ilike, or, eq } from 'drizzle-orm';
import { DirectorySearchSchema } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';

const app = new Hono<AuthEnv>();

// GET / — Search public agent directory
app.get('/', async (c) => {
  const parsed = DirectorySearchSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { q, limit, offset } = parsed.data;

  const rows = await db.select({
    id: agents.id,
    name: agents.name,
    description: agents.description,
    avatarUrl: agents.avatarUrl,
    publicKey: agents.publicKey,
  }).from(agents)
    .where(
      and(
        eq(agents.status, 'active'),
        or(
          ilike(agents.name, `%${q}%`),
          ilike(agents.description, `%${q}%`),
        ),
      ),
    )
    .limit(limit).offset(offset);

  return c.json({ data: rows });
});

export default app;
