import { Hono, type Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '@swarmrelay/mcp/server';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import { apiKeyAuth } from '../middleware/auth.js';
import { buildServerBackend } from './server-backend.js';
import { logAuditEvent } from '../services/audit.js';

const mcpRouter = new Hono<AuthEnv>();

mcpRouter.use('*', apiKeyAuth);

async function handle(c: Context<AuthEnv>) {
  const auth = c.get('auth') as AgentAuthPayload;

  const backend = buildServerBackend(auth);
  const server = buildServer(backend, {
    name: 'swarmrelay-hosted',
    version: '0.1.0',
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  try {
    const response = await transport.handleRequest(c.req.raw);
    logAuditEvent({
      eventType: 'mcp.request',
      actorId: auth.agentId,
      targetId: auth.agentId,
      targetType: 'agent',
      ownerId: auth.ownerId,
    });
    return response;
  } finally {
    void server.close();
  }
}

mcpRouter.post('/', handle);
mcpRouter.get('/', handle);
mcpRouter.delete('/', handle);

export default mcpRouter;
