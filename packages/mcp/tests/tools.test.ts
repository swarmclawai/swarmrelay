import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SwarmRelayClient } from '@swarmrelay/sdk';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/server.ts';

type FetchImpl = typeof globalThis.fetch;

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
}

function makeClient(): { sdk: SwarmRelayClient; calls: CapturedCall[]; restore: () => void } {
  const calls: CapturedCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    // Echo back a deterministic minimal response that matches typical SDK shapes.
    return new Response(JSON.stringify({ ok: true, echo: body ?? null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchImpl;

  const sdk = new SwarmRelayClient({
    apiKey: 'rl_test_key',
    baseUrl: 'https://test.example.com',
    publicKey: 'test-public-key',
    privateKey: 'test-private-key',
  });

  return {
    sdk,
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function connectClient(sdk: SwarmRelayClient) {
  const server = buildServer(sdk);
  const client = new McpClient({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

describe('mcp tools → sdk routing', () => {
  let harness: ReturnType<typeof makeClient>;

  beforeEach(() => {
    harness = makeClient();
  });

  afterEach(() => {
    harness.restore();
  });

  it('registers the expected tool surface', async () => {
    const { client, server } = await connectClient(harness.sdk);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    const expected = [
      'contacts_add',
      'contacts_block',
      'contacts_get',
      'contacts_list',
      'contacts_remove',
      'contacts_unblock',
      'contacts_update',
      'conversations_add_members',
      'conversations_create',
      'conversations_create_group',
      'conversations_get',
      'conversations_leave',
      'conversations_list',
      'conversations_remove_member',
      'conversations_rotate_key',
      'conversations_update',
      'messages_delete',
      'messages_edit',
      'messages_list',
      'messages_send',
      'messages_send_encrypted_dm',
      'messages_send_receipt',
      'presence_get',
      'presence_get_all',
      'presence_set',
    ];
    assert.deepEqual(names, expected);
    await server.close();
    await client.close();
  });

  it('contacts_list calls GET /api/v1/contacts with pagination', async () => {
    const { client, server } = await connectClient(harness.sdk);
    await client.callTool({ name: 'contacts_list', arguments: { limit: 10, offset: 5 } });
    const call = harness.calls.at(-1)!;
    assert.equal(call.method, 'GET');
    assert.match(call.url, /\/api\/v1\/contacts\?limit=10&offset=5$/);
    await server.close();
    await client.close();
  });

  it('contacts_add posts to /api/v1/contacts with provided body', async () => {
    const { client, server } = await connectClient(harness.sdk);
    await client.callTool({
      name: 'contacts_add',
      arguments: { agentId: 'agent-xyz', nickname: 'Xyz' },
    });
    const call = harness.calls.at(-1)!;
    assert.equal(call.method, 'POST');
    assert.match(call.url, /\/api\/v1\/contacts$/);
    assert.deepEqual(call.body, { agentId: 'agent-xyz', nickname: 'Xyz' });
    await server.close();
    await client.close();
  });

  it('conversations_create posts with type and members', async () => {
    const { client, server } = await connectClient(harness.sdk);
    await client.callTool({
      name: 'conversations_create',
      arguments: { type: 'group', members: ['a', 'b'], name: 'team' },
    });
    const call = harness.calls.at(-1)!;
    assert.equal(call.method, 'POST');
    assert.match(call.url, /\/api\/v1\/conversations$/);
    assert.deepEqual(call.body, { type: 'group', members: ['a', 'b'], name: 'team' });
    await server.close();
    await client.close();
  });

  it('messages_list hits the conversation messages endpoint', async () => {
    const { client, server } = await connectClient(harness.sdk);
    await client.callTool({
      name: 'messages_list',
      arguments: { conversationId: 'conv-1', limit: 50 },
    });
    const call = harness.calls.at(-1)!;
    assert.equal(call.method, 'GET');
    assert.match(call.url, /\/api\/v1\/conversations\/conv-1\/messages\?limit=50$/);
    await server.close();
    await client.close();
  });

  it('messages_send_encrypted_dm errors without a private key', async () => {
    harness.restore();
    const alt = makeClient();
    harness = alt;
    // Rebuild the client without a private key.
    alt.sdk = new SwarmRelayClient({ apiKey: 'rl_test_key', baseUrl: 'https://test.example.com' });

    const { client, server } = await connectClient(alt.sdk);
    const result = await client.callTool({
      name: 'messages_send_encrypted_dm',
      arguments: {
        conversationId: 'c',
        recipientPublicKey: 'r',
        plaintext: 'hi',
      },
    });
    assert.equal(result.isError, true);
    const content = (result.content as { type: string; text: string }[])[0];
    assert.match(content.text, /private key/i);
    await server.close();
    await client.close();
  });

  it('presence_set posts the requested status', async () => {
    const { client, server } = await connectClient(harness.sdk);
    await client.callTool({ name: 'presence_set', arguments: { status: 'away' } });
    const call = harness.calls.at(-1)!;
    assert.equal(call.method, 'POST');
    assert.match(call.url, /\/api\/v1\/presence$/);
    assert.deepEqual(call.body, { status: 'away' });
    await server.close();
    await client.close();
  });
});
