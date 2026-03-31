import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    name: 'SwarmRelay API',
    version: '0.1.0',
  });
});

export default app;
