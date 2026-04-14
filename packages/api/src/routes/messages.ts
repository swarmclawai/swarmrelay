import { Hono } from 'hono';
import {
  MessageSendSchema,
  MessageEditSchema,
  MessageListSchema,
  ReceiptCreateSchema,
} from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import {
  listMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  sendReceipt,
} from '../services/messages.js';
import { handleServiceRoute } from './helpers.js';

// --- Conversation-scoped message routes ---
// Mounted at /api/v1/conversations/:conversationId/messages

export const conversationMessages = new Hono<AuthEnv>();

conversationMessages.get('/', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    const conversationId = c.req.param('conversationId') as string;
    const query = MessageListSchema.parse(c.req.query());
    return listMessages(auth, conversationId, query);
  }),
);

conversationMessages.post('/', async (c) =>
  handleServiceRoute(
    c,
    async () => {
      const auth = c.get('auth') as AgentAuthPayload;
      const conversationId = c.req.param('conversationId') as string;
      const body = await c.req.json().catch(() => ({}));
      const parsed = MessageSendSchema.safeParse(body);
      if (!parsed.success) {
        throw Object.assign(new Error('Validation failed'), {
          __validation: parsed.error.flatten(),
        });
      }
      return sendMessage(auth, {
        conversationId,
        type: parsed.data.type,
        ciphertext: parsed.data.ciphertext,
        nonce: parsed.data.nonce,
        signature: parsed.data.signature,
        replyToId: parsed.data.replyToId ?? null,
        metadata: parsed.data.metadata ?? {},
      });
    },
    { successStatus: 201 },
  ),
);

// --- Flat message routes ---
// Mounted at /api/v1/messages

export const messageOperations = new Hono<AuthEnv>();

messageOperations.patch('/:messageId', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    const messageId = c.req.param('messageId');
    const body = await c.req.json().catch(() => ({}));
    const parsed = MessageEditSchema.safeParse(body);
    if (!parsed.success) {
      throw Object.assign(new Error('Validation failed'), {
        __validation: parsed.error.flatten(),
      });
    }
    return editMessage(auth, messageId, parsed.data);
  }),
);

messageOperations.delete('/:messageId', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return deleteMessage(auth, c.req.param('messageId'));
  }),
);

messageOperations.post('/:messageId/receipts', async (c) =>
  handleServiceRoute(
    c,
    async () => {
      const auth = c.get('auth') as AgentAuthPayload;
      const messageId = c.req.param('messageId');
      const body = await c.req.json().catch(() => ({}));
      const parsed = ReceiptCreateSchema.safeParse(body);
      if (!parsed.success) {
        throw Object.assign(new Error('Validation failed'), {
          __validation: parsed.error.flatten(),
        });
      }
      return sendReceipt(auth, messageId, parsed.data.status);
    },
    { successStatus: 201 },
  ),
);
