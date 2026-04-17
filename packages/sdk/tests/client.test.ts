import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair } from '@swarmrelay/shared';
import {
  NotFoundError,
  SwarmRelayClient,
} from '../src/index.ts';

test('register posts to the normalized API URL', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      apiKey: 'rl_live_register',
      agentId: crypto.randomUUID(),
      ownerId: crypto.randomUUID(),
      publicKey: 'public-key',
      privateKey: 'private-key',
      claimToken: 'SIG-ABCD-EFGH',
      claimUrl: 'https://swarmrelay.ai/claim?token=SIG-ABCD-EFGH',
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await SwarmRelayClient.register({ name: 'SDK Test', baseUrl: 'http://relay.test/' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://relay.test/api/v1/register');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: 'SDK Test' });
  assert.equal(result.apiKey, 'rl_live_register');
});

test('API key requests include auth headers, query params, and mapped errors', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes('/contacts')) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Conversation missing' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const client = new SwarmRelayClient({
    apiKey: 'rl_live_sdktest',
    baseUrl: 'http://relay.test/',
  });

  const contacts = await client.contacts.list({ limit: 5, offset: 10 });
  assert.deepEqual(contacts, { data: [] });

  const firstCall = calls[0];
  const firstHeaders = new Headers(firstCall.init?.headers);
  assert.equal(firstCall.url, 'http://relay.test/api/v1/contacts?limit=5&offset=10');
  assert.equal(firstHeaders.get('authorization'), 'Bearer rl_live_sdktest');

  await assert.rejects(
    client.conversations.get('missing-conversation'),
    (error: unknown) => error instanceof NotFoundError && error.message === 'Conversation missing',
  );
});

test('challenge-response auth signs once and reuses the cached JWT', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const keyPair = generateKeyPair();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/api/v1/auth/challenge')) {
      return new Response(JSON.stringify({
        challenge: 'challenge-123',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/api/v1/auth/verify')) {
      return new Response(JSON.stringify({
        token: 'jwt-token-123',
        agentId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const client = new SwarmRelayClient({
    publicKey: keyPair.publicKey,
    privateKey: keyPair.secretKey,
    baseUrl: 'http://relay.test',
  });

  await client.contacts.list();
  await client.contacts.list();

  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, 'http://relay.test/api/v1/auth/challenge');
  assert.equal(calls[1].url, 'http://relay.test/api/v1/auth/verify');
  assert.equal(calls[2].url, 'http://relay.test/api/v1/contacts');
  assert.equal(calls[3].url, 'http://relay.test/api/v1/contacts');

  const firstAuthorizedRequest = new Headers(calls[2].init?.headers);
  const secondAuthorizedRequest = new Headers(calls[3].init?.headers);
  assert.equal(firstAuthorizedRequest.get('authorization'), 'Bearer jwt-token-123');
  assert.equal(secondAuthorizedRequest.get('authorization'), 'Bearer jwt-token-123');
});
