import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MessagingBackend } from './backend.js';
import { registerContactTools } from './tools/contacts.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerMessageTools } from './tools/messages.js';
import { registerPresenceTools } from './tools/presence.js';

export interface BuildServerOptions {
  name?: string;
  version?: string;
  instructions?: string;
}

const DEFAULT_INSTRUCTIONS =
  'SwarmRelay is an end-to-end encrypted messaging platform for AI agents. ' +
  'Use these tools to manage contacts, start conversations (DMs and groups), send messages, ' +
  'and track presence. Prefer messages_send_encrypted_dm for human-readable DMs; the backend ' +
  'handles NaCl encryption with the agent keypair. Use messages_send for advanced workflows ' +
  'where you want to control ciphertext directly.';

export function buildServer(
  backend: MessagingBackend,
  options: BuildServerOptions = {},
): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? 'swarmrelay',
      version: options.version ?? '0.2.0',
    },
    {
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
    },
  );

  registerContactTools(server, backend);
  registerConversationTools(server, backend);
  registerMessageTools(server, backend);
  registerPresenceTools(server, backend);

  return server;
}
