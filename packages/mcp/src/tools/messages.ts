import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorContent, safeCall, type Backend } from './shared.js';

export function registerMessageTools(server: McpServer, backend: Backend): void {
  server.registerTool(
    'messages_list',
    {
      title: 'List messages',
      description: 'Fetch message history for a conversation (newest first).',
      inputSchema: {
        conversationId: z.string().describe('Conversation ID.'),
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    async ({ conversationId, limit, offset }) =>
      safeCall(() => backend.messages.list(conversationId, { limit, offset })),
  );

  server.registerTool(
    'messages_send',
    {
      title: 'Send message (raw)',
      description:
        'Send a message with pre-encrypted ciphertext. Advanced — most callers should use messages_send_encrypted_dm instead.',
      inputSchema: {
        conversationId: z.string(),
        type: z.string().optional().describe('Message type (default: text).'),
        ciphertext: z.string().describe('Base64 NaCl box/secretbox ciphertext.'),
        nonce: z.string().describe('Base64 nonce used for encryption.'),
        signature: z.string().describe('Ed25519 signature over the plaintext.'),
        replyToId: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      },
    },
    async (args) => safeCall(() => backend.messages.send(args)),
  );

  server.registerTool(
    'messages_send_encrypted_dm',
    {
      title: 'Send encrypted DM',
      description:
        'Encrypt a plaintext message with NaCl box and send it to a DM conversation. The backend handles NaCl box encryption using the agent keypair.',
      inputSchema: {
        conversationId: z.string().describe('DM conversation ID.'),
        recipientPublicKey: z.string().describe("Recipient agent's Ed25519 public key (base64)."),
        plaintext: z.string().describe('Plaintext message content.'),
        type: z.string().optional().describe('Message type (default: text).'),
      },
    },
    async ({ conversationId, recipientPublicKey, plaintext, type }) => {
      // Client-side backends (SwarmRelayClient) advertise their local private
      // key via getPrivateKey(). If present, we expect the backend to perform
      // the encryption with that key. If absent, the backend may still be a
      // server-side implementation that encrypts internally — we let it try
      // and surface the underlying error.
      if (backend.getPrivateKey && !backend.getPrivateKey()) {
        return errorContent(
          'Encrypted DM requires a local private key. Start the server with SWARMRELAY_PRIVATE_KEY or allow auto-registration so credentials include a keypair.',
        );
      }
      return safeCall(() =>
        backend.messages.sendEncrypted({ conversationId, recipientPublicKey, plaintext, type }),
      );
    },
  );

  server.registerTool(
    'messages_edit',
    {
      title: 'Edit message',
      description: 'Edit a message the current agent authored. Requires new ciphertext/nonce/signature.',
      inputSchema: {
        messageId: z.string(),
        ciphertext: z.string(),
        nonce: z.string(),
        signature: z.string(),
      },
    },
    async ({ messageId, ciphertext, nonce, signature }) =>
      safeCall(() => backend.messages.edit(messageId, { ciphertext, nonce, signature })),
  );

  server.registerTool(
    'messages_delete',
    {
      title: 'Delete message',
      description: 'Soft-delete a message the current agent authored.',
      inputSchema: { messageId: z.string() },
    },
    async ({ messageId }) => safeCall(() => backend.messages.delete(messageId)),
  );

  server.registerTool(
    'messages_send_receipt',
    {
      title: 'Send read receipt',
      description: 'Acknowledge a message as delivered or read.',
      inputSchema: {
        messageId: z.string(),
        status: z.enum(['delivered', 'read']),
      },
    },
    async ({ messageId, status }) =>
      safeCall(() => backend.messages.sendReceipt(messageId, status)),
  );
}
