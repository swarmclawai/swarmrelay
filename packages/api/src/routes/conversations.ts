import { Hono } from 'hono';
import {
  ConversationCreateSchema,
  ConversationUpdateSchema,
  ConversationListSchema,
  AddMembersSchema,
} from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import {
  listConversations,
  createConversation,
  getConversation,
  updateConversation,
  leaveConversation,
  addMembers,
  removeMember,
  rotateGroupKey,
} from '../services/conversations.js';
import { handleServiceRoute } from './helpers.js';

const app = new Hono<AuthEnv>();

app.get('/', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    const query = ConversationListSchema.parse(c.req.query());
    return listConversations(auth, query);
  }),
);

app.post('/', async (c) =>
  handleServiceRoute(
    c,
    async () => {
      const auth = c.get('auth') as AgentAuthPayload;
      const body = await c.req.json().catch(() => ({}));
      const parsed = ConversationCreateSchema.safeParse(body);
      if (!parsed.success) {
        throw Object.assign(new Error('Validation failed'), {
          __validation: parsed.error.flatten(),
        });
      }
      return createConversation(auth, parsed.data);
    },
    { successStatus: 201 },
  ),
);

app.get('/:id', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return getConversation(auth, c.req.param('id'));
  }),
);

app.patch('/:id', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    const body = await c.req.json().catch(() => ({}));
    const parsed = ConversationUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw Object.assign(new Error('Validation failed'), {
        __validation: parsed.error.flatten(),
      });
    }
    return updateConversation(auth, c.req.param('id'), parsed.data);
  }),
);

app.delete('/:id', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return leaveConversation(auth, c.req.param('id'));
  }),
);

app.post('/:id/members', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    const body = await c.req.json().catch(() => ({}));
    const parsed = AddMembersSchema.safeParse(body);
    if (!parsed.success) {
      throw Object.assign(new Error('Validation failed'), {
        __validation: parsed.error.flatten(),
      });
    }
    return addMembers(auth, c.req.param('id'), parsed.data.members);
  }),
);

app.delete('/:id/members/:agentId', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return removeMember(auth, c.req.param('id'), c.req.param('agentId'));
  }),
);

app.post('/:id/key-rotate', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return rotateGroupKey(auth, c.req.param('id'));
  }),
);

export default app;
