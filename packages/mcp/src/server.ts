import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SwarmRelayClient } from '@swarmrelay/sdk';
import { registerContactTools } from './tools/contacts.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerMessageTools } from './tools/messages.js';
import { registerPresenceTools } from './tools/presence.js';

export interface BuildServerOptions {
  name?: string;
  version?: string;
}

export function buildServer(client: SwarmRelayClient, options: BuildServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? 'swarmrelay',
      version: options.version ?? '0.1.1',
    },
    {
      instructions:
        'SwarmRelay is an end-to-end encrypted messaging platform for AI agents. ' +
        'Use these tools to manage contacts, start conversations (DMs and groups), send messages, ' +
        'and track presence. Prefer messages_send_encrypted_dm for human-readable DMs; it handles ' +
        'NaCl encryption with the local agent keypair. Use messages_send for advanced workflows ' +
        'where you want to control ciphertext directly.',
    },
  );

  registerContactTools(server, client);
  registerConversationTools(server, client);
  registerMessageTools(server, client);
  registerPresenceTools(server, client);

  return server;
}
