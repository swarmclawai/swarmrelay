import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeCall, type Backend } from './shared.js';

export function registerContactTools(server: McpServer, backend: Backend): void {
  server.registerTool(
    'contacts_list',
    {
      title: 'List contacts',
      description: 'List all contacts in the agent address book.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional().describe('Max contacts to return (default 20).'),
        offset: z.number().int().nonnegative().optional().describe('Pagination offset.'),
      },
    },
    async ({ limit, offset }) => safeCall(() => backend.contacts.list({ limit, offset })),
  );

  server.registerTool(
    'contacts_add',
    {
      title: 'Add contact',
      description: 'Add a contact by agent ID or public key. At least one of agentId or publicKey is required.',
      inputSchema: {
        agentId: z.string().optional().describe('SwarmRelay agent ID to add.'),
        publicKey: z.string().optional().describe('Ed25519 public key (base64) to add.'),
        nickname: z.string().optional().describe('Optional display nickname.'),
      },
    },
    async ({ agentId, publicKey, nickname }) =>
      safeCall(() => backend.contacts.add({ agentId, publicKey, nickname })),
  );

  server.registerTool(
    'contacts_get',
    {
      title: 'Get contact',
      description: 'Fetch a contact by its contact ID.',
      inputSchema: { id: z.string().describe('Contact ID.') },
    },
    async ({ id }) => safeCall(() => backend.contacts.get(id)),
  );

  server.registerTool(
    'contacts_update',
    {
      title: 'Update contact',
      description: 'Update a contact nickname or notes.',
      inputSchema: {
        id: z.string().describe('Contact ID.'),
        nickname: z.string().optional().describe('New nickname.'),
        notes: z.string().optional().describe('New notes.'),
      },
    },
    async ({ id, nickname, notes }) =>
      safeCall(() => backend.contacts.update(id, { nickname, notes })),
  );

  server.registerTool(
    'contacts_remove',
    {
      title: 'Remove contact',
      description: 'Delete a contact from the address book.',
      inputSchema: { id: z.string().describe('Contact ID.') },
    },
    async ({ id }) => safeCall(() => backend.contacts.remove(id)),
  );

  server.registerTool(
    'contacts_block',
    {
      title: 'Block contact',
      description: 'Block a contact. Blocked agents cannot send messages.',
      inputSchema: { id: z.string().describe('Contact ID.') },
    },
    async ({ id }) => safeCall(() => backend.contacts.block(id)),
  );

  server.registerTool(
    'contacts_unblock',
    {
      title: 'Unblock contact',
      description: 'Unblock a previously blocked contact.',
      inputSchema: { id: z.string().describe('Contact ID.') },
    },
    async ({ id }) => safeCall(() => backend.contacts.unblock(id)),
  );
}
