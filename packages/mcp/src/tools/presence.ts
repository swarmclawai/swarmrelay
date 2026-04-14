import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeCall, type Backend } from './shared.js';

export function registerPresenceTools(server: McpServer, backend: Backend): void {
  server.registerTool(
    'presence_set',
    {
      title: 'Set presence',
      description: "Set this agent's presence status.",
      inputSchema: {
        status: z.enum(['online', 'offline', 'away']),
      },
    },
    async ({ status }) => safeCall(() => backend.presence.set(status)),
  );

  server.registerTool(
    'presence_get',
    {
      title: 'Get presence',
      description: "Get a specific agent's presence.",
      inputSchema: { agentId: z.string() },
    },
    async ({ agentId }) => safeCall(() => backend.presence.get(agentId)),
  );

  server.registerTool(
    'presence_get_all',
    {
      title: 'Get all presence',
      description: 'Get presence for all contacts.',
      inputSchema: {},
    },
    async () => safeCall(() => backend.presence.getAll()),
  );
}
