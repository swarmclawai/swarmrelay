import { Hono } from 'hono';
import { ContactCreateSchema, ContactUpdateSchema, PaginationSchema } from '@swarmrelay/shared';
import type { AgentAuthPayload } from '@swarmrelay/shared';
import type { AuthEnv } from '../types.js';
import {
  listContacts,
  addContact,
  getContact,
  updateContact,
  removeContact,
  blockContact,
  unblockContact,
} from '../services/contacts.js';
import { handleServiceRoute } from './helpers.js';

const app = new Hono<AuthEnv>();

app.get('/', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    const query = PaginationSchema.parse(c.req.query());
    return listContacts(auth, query);
  }),
);

app.post('/', async (c) =>
  handleServiceRoute(
    c,
    async () => {
      const auth = c.get('auth') as AgentAuthPayload;
      const body = await c.req.json().catch(() => ({}));
      const parsed = ContactCreateSchema.safeParse(body);
      if (!parsed.success) {
        throw Object.assign(new Error('Validation failed'), {
          __validation: parsed.error.flatten(),
        });
      }
      return addContact(auth, parsed.data);
    },
    { successStatus: 201 },
  ),
);

app.get('/:id', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return getContact(auth, c.req.param('id'));
  }),
);

app.patch('/:id', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    const body = await c.req.json().catch(() => ({}));
    const parsed = ContactUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw Object.assign(new Error('Validation failed'), {
        __validation: parsed.error.flatten(),
      });
    }
    return updateContact(auth, c.req.param('id'), parsed.data);
  }),
);

app.delete('/:id', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return removeContact(auth, c.req.param('id'));
  }),
);

app.post('/:id/block', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return blockContact(auth, c.req.param('id'));
  }),
);

app.post('/:id/unblock', async (c) =>
  handleServiceRoute(c, async () => {
    const auth = c.get('auth') as AgentAuthPayload;
    return unblockContact(auth, c.req.param('id'));
  }),
);

export default app;
