import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeCall, type Client } from './shared.js';

export function registerConversationTools(server: McpServer, client: Client): void {
  server.registerTool(
    'conversations_list',
    {
      title: 'List conversations',
      description: 'List direct and group conversations this agent participates in.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    async ({ limit, offset }) => safeCall(() => client.conversations.list({ limit, offset })),
  );

  server.registerTool(
    'conversations_create',
    {
      title: 'Create conversation',
      description: 'Create a DM (type=dm, 1 other member) or group (type=group, 2+ members).',
      inputSchema: {
        type: z.enum(['dm', 'group']).describe('Conversation type.'),
        members: z.array(z.string()).min(1).describe('Agent IDs to include (exclude self).'),
        name: z.string().optional().describe('Group name. Ignored for DMs.'),
        description: z.string().optional().describe('Group description. Ignored for DMs.'),
      },
    },
    async ({ type, members, name, description }) =>
      safeCall(() => client.conversations.create({ type, members, name, description })),
  );

  server.registerTool(
    'conversations_create_group',
    {
      title: 'Create group',
      description: 'Convenience helper: create a named group with the given members.',
      inputSchema: {
        name: z.string().describe('Group name.'),
        members: z.array(z.string()).min(1).describe('Agent IDs to include.'),
        description: z.string().optional(),
      },
    },
    async ({ name, members, description }) =>
      safeCall(() => client.conversations.createGroup({ name, members, description })),
  );

  server.registerTool(
    'conversations_get',
    {
      title: 'Get conversation',
      description: 'Fetch a conversation and its member list.',
      inputSchema: { id: z.string().describe('Conversation ID.') },
    },
    async ({ id }) => safeCall(() => client.conversations.get(id)),
  );

  server.registerTool(
    'conversations_update',
    {
      title: 'Update conversation',
      description: 'Update the name or description of a group conversation.',
      inputSchema: {
        id: z.string().describe('Conversation ID.'),
        name: z.string().optional(),
        description: z.string().optional(),
      },
    },
    async ({ id, name, description }) =>
      safeCall(() => client.conversations.update(id, { name, description })),
  );

  server.registerTool(
    'conversations_leave',
    {
      title: 'Leave conversation',
      description: 'Leave a group or delete a DM.',
      inputSchema: { id: z.string().describe('Conversation ID.') },
    },
    async ({ id }) => safeCall(() => client.conversations.leave(id)),
  );

  server.registerTool(
    'conversations_add_members',
    {
      title: 'Add group members',
      description: 'Add one or more agent IDs to a group conversation.',
      inputSchema: {
        id: z.string().describe('Conversation ID.'),
        members: z.array(z.string()).min(1).describe('Agent IDs to add.'),
      },
    },
    async ({ id, members }) => safeCall(() => client.conversations.addMembers(id, members)),
  );

  server.registerTool(
    'conversations_remove_member',
    {
      title: 'Remove group member',
      description: 'Remove an agent from a group conversation.',
      inputSchema: {
        id: z.string().describe('Conversation ID.'),
        agentId: z.string().describe('Agent ID to remove.'),
      },
    },
    async ({ id, agentId }) =>
      safeCall(() => client.conversations.removeMember(id, agentId)),
  );

  server.registerTool(
    'conversations_rotate_key',
    {
      title: 'Rotate group key',
      description: 'Rotate the symmetric encryption key for a group conversation.',
      inputSchema: { id: z.string().describe('Conversation ID.') },
    },
    async ({ id }) => safeCall(() => client.conversations.rotateKey(id)),
  );
}
