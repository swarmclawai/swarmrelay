import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import health from './routes/health.js';
import registerRouter from './routes/register.js';
import authRouter from './routes/auth.js';
import agentsRouter from './routes/agents.js';
import apiKeysRouter from './routes/api-keys.js';
import claimRouter from './routes/claim.js';
import contactsRouter from './routes/contacts.js';
import conversationsRouter from './routes/conversations.js';
import { conversationMessages, messageOperations } from './routes/messages.js';
import directoryRouter from './routes/directory.js';
import dashboardRouter from './routes/dashboard.js';
import statsRouter from './routes/stats.js';
import presenceRouter from './routes/presence.js';
import typingRouter from './routes/typing.js';
import a2aRouter from './routes/a2a.js';
import mcpRouter from './mcp/route.js';
import { apiKeyAuth, firebaseAuth, requireScope } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { connectRedis } from './lib/redis.js';
import { getNatsConnection, closeNats } from './lib/nats.js';
import { RATE_LIMIT_REGISTER, RATE_LIMIT_MESSAGES } from '@swarmrelay/shared';
import { handleOpen, handleMessage, handleClose, handleError } from './ws/handler.js';

export function createApp() {
  const app = new Hono();

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3600').split(','),
    }),
  );

  // Health (no auth)
  app.route('/api/v1/health', health);

  // Self-registration (no auth, rate limited by IP)
  app.route('/api/v1/register', (() => { const r = new Hono(); r.use('*', rateLimit(60_000, RATE_LIMIT_REGISTER)); r.route('/', registerRouter); return r; })());

  // Auth (no auth, rate limited)
  app.route('/api/v1/auth', (() => { const r = new Hono(); r.use('*', rateLimit(60_000, 20)); r.route('/', authRouter); return r; })());

  // Claim (Firebase auth)
  app.route('/api/v1/claim', (() => { const r = new Hono(); r.use('*', firebaseAuth); r.use('*', rateLimit()); r.route('/', claimRouter); return r; })());

  // Dashboard routes (Firebase auth)
  app.route('/api/v1/agents', (() => { const r = new Hono(); r.use('*', firebaseAuth); r.use('*', rateLimit()); r.route('/', agentsRouter); return r; })());
  app.route('/api/v1/api-keys', (() => { const r = new Hono(); r.use('*', firebaseAuth); r.use('*', rateLimit()); r.route('/', apiKeysRouter); return r; })());
  app.route('/api/v1/dashboard', (() => { const r = new Hono(); r.use('*', firebaseAuth); r.use('*', rateLimit()); r.route('/', dashboardRouter); return r; })());

  // Agent routes (API key / JWT auth)
  app.route('/api/v1/contacts', (() => { const r = new Hono(); r.use('*', apiKeyAuth); r.use('*', rateLimit()); r.route('/', contactsRouter); return r; })());
  app.route('/api/v1/conversations', (() => { const r = new Hono(); r.use('*', apiKeyAuth); r.use('*', rateLimit()); r.route('/', conversationsRouter); return r; })());
  app.route('/api/v1/conversations/:conversationId/messages', (() => { const r = new Hono(); r.use('*', apiKeyAuth); r.use('*', rateLimit(60_000, RATE_LIMIT_MESSAGES)); r.route('/', conversationMessages); return r; })());
  app.route('/api/v1/messages', (() => { const r = new Hono(); r.use('*', apiKeyAuth); r.use('*', rateLimit()); r.route('/', messageOperations); return r; })());
  app.route('/api/v1/directory', (() => { const r = new Hono(); r.use('*', apiKeyAuth); r.use('*', rateLimit()); r.route('/', directoryRouter); return r; })());

  // Presence and typing (agent auth)
  app.route('/api/v1/presence', (() => { const r = new Hono(); r.use('*', apiKeyAuth); r.use('*', rateLimit()); r.route('/', presenceRouter); return r; })());
  app.route('/api/v1/typing', (() => { const r = new Hono(); r.use('*', apiKeyAuth); r.use('*', rateLimit()); r.route('/', typingRouter); return r; })());

  // A2A Protocol bridge (no auth — uses Ed25519 signature verification internally)
  app.route('/a2a', (() => { const r = new Hono(); r.use('*', rateLimit()); r.route('/', a2aRouter); return r; })());

  // MCP (Streamable HTTP) — agent API-key auth, same rate limit as /messages
  app.route('/mcp', (() => { const r = new Hono(); r.use('*', rateLimit(60_000, RATE_LIMIT_MESSAGES)); r.route('/', mcpRouter); return r; })());

  // WebSocket endpoint (auth via query param token)
  app.get('/ws', upgradeWebSocket((c) => {
    const token = new URL(c.req.url).searchParams.get('token');
    return {
      onOpen(_evt, ws) {
        handleOpen(ws, token);
      },
      onMessage(evt, ws) {
        handleMessage(ws, evt);
      },
      onClose(_evt, ws) {
        handleClose(ws);
      },
      onError(_evt, ws) {
        handleError(ws);
      },
    };
  }));

  // Public routes (no auth)
  app.route('/api/v1/stats', statsRouter);

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error('Unhandled error:', err);
    return c.json(
      { error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message },
      500,
    );
  });

  return { app, injectWebSocket };
}

const { app, injectWebSocket } = createApp();

const port = Number(process.env.PORT ?? 3500);

async function start() {
  await connectRedis();

  // NATS is optional — warn but don't block startup
  getNatsConnection()
    .then((nc) => {
      if (nc) console.log('[NATS] connected');
      else if (process.env.NATS_URL) console.warn('[NATS] configured but connection failed');
    })
    .catch((err) => console.warn('[NATS] unavailable:', (err as Error).message));

  const server = serve({ fetch: app.fetch, port });
  injectWebSocket(server);
  console.log(`SwarmRelay API running on port ${port}`);

  // Graceful shutdown
  function shutdown(signal: string) {
    console.log(`${signal} received, closing server...`);
    server.close(async () => {
      await closeNats();
      console.log('Server closed');
      process.exit(0);
    });
    // Force exit after 10s if graceful close stalls
    setTimeout(() => { process.exit(1); }, 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

export default app;
