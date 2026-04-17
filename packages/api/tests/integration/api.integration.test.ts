import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { connect as connectNats, type NatsConnection } from 'nats';
import {
  A2A_PROTOCOL_VERSION,
  API_KEY_PREFIX,
  WS_EVENTS,
  generateKeyPair,
  signMessage,
  type A2AJsonRpcResponse,
  type WebSocketMessage,
} from '@swarmrelay/shared';
import {
  startApiHarness,
  waitForNatsMessage,
  waitForWebSocketEvent,
  type ApiHarness,
} from './helpers.ts';

type JsonRpcResult<T> = {
  res: Response;
  json: A2AJsonRpcResponse;
  result: T;
};

async function startExternalAgentCardServer(publicKey: string) {
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/agent-card.json') {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      name: 'External Worker',
      description: 'External A2A test agent',
      version: '1.0.0',
      protocolVersion: A2A_PROTOCOL_VERSION,
      apiEndpoint: 'https://external.example/relay',
      capabilities: [],
      skills: [],
      authMethods: ['ed25519'],
      publicKey,
      supportsStreaming: false,
      supportsAsync: true,
      metadata: { source: 'integration-test' },
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, 'string');

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

async function callA2A<T>(
  harness: ApiHarness,
  method: string,
  params: Record<string, unknown>,
  auth?: { agentId: string; secretKey: string },
): Promise<JsonRpcResult<T>> {
  const body = {
    jsonrpc: '2.0' as const,
    id: `${method}-${Date.now()}`,
    method,
    params,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    headers['x-a2a-agent-id'] = auth.agentId;
    headers['x-a2a-signature'] = signMessage(
      new TextEncoder().encode(JSON.stringify(body)),
      auth.secretKey,
    );
  }

  const res = await fetch(`${harness.baseUrl}/a2a/relay`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = await res.json() as A2AJsonRpcResponse;
  assert.equal(json.error, undefined, JSON.stringify(json.error));

  return {
    res,
    json,
    result: json.result as T,
  };
}

test('repo integration coverage: auth, realtime flows, and A2A/NATS', async (t) => {
  const harness = await startApiHarness();
  const nats = await connectNats({ servers: harness.natsUrl });
  const externalKeyPair = generateKeyPair();
  const externalCard = await startExternalAgentCardServer(externalKeyPair.publicKey);

  t.after(async () => {
    await stopServer(externalCard.server);
    await nats.close();
    await harness.cleanup();
  });

  const alice = await harness.registerAgent('Alice');
  const bob = await harness.registerAgent('Bob');
  const charlie = await harness.registerAgent('Charlie');

  assert.match(alice.apiKey, new RegExp(`^${API_KEY_PREFIX}`));

  const { res: dmRes, json: dm } = await harness.requestJson<{ id: string }>(
    '/api/v1/conversations',
    {
      method: 'POST',
      token: alice.apiKey,
      body: { type: 'dm', members: [bob.agentId] },
    },
  );
  assert.equal(dmRes.status, 201);

  const { json: dmAgain } = await harness.requestJson<{ id: string }>(
    '/api/v1/conversations',
    {
      method: 'POST',
      token: alice.apiKey,
      body: { type: 'dm', members: [bob.agentId] },
    },
  );
  assert.equal(dmAgain.id, dm.id);

  const bobSocket = await harness.openWebSocket(bob.apiKey);
  t.after(() => {
    bobSocket.close();
  });

  const createMessageEvent = waitForWebSocketEvent(
    bobSocket,
    (event) => event.event === WS_EVENTS.MESSAGE_NEW,
  );
  const { res: sendRes, json: sentMessage } = await harness.requestJson<{
    id: string;
    conversationId: string;
    senderId: string;
  }>(
    `/api/v1/conversations/${dm.id}/messages`,
    {
      method: 'POST',
      token: alice.apiKey,
      body: {
        type: 'text',
        ciphertext: Buffer.from('hello, bob').toString('base64'),
        nonce: Buffer.from('0'.repeat(48), 'hex').toString('base64'),
        signature: Buffer.from('1'.repeat(128), 'hex').toString('base64'),
      },
    },
  );
  assert.equal(sendRes.status, 201);

  const createdEvent = await createMessageEvent;
  assert.equal(createdEvent.data.id, sentMessage.id);
  assert.equal(createdEvent.data.conversationId, dm.id);

  const editMessageEvent = waitForWebSocketEvent(
    bobSocket,
    (event) => event.event === WS_EVENTS.MESSAGE_EDITED,
  );
  const { res: editRes } = await harness.requestJson(
    `/api/v1/messages/${sentMessage.id}`,
    {
      method: 'PATCH',
      token: alice.apiKey,
      body: {
        ciphertext: Buffer.from('edited message').toString('base64'),
        nonce: Buffer.from('2'.repeat(48), 'hex').toString('base64'),
        signature: Buffer.from('3'.repeat(128), 'hex').toString('base64'),
      },
    },
  );
  assert.equal(editRes.status, 200);

  const editedEvent = await editMessageEvent;
  assert.equal(editedEvent.data.id, sentMessage.id);
  assert.equal(editedEvent.data.conversationId, dm.id);

  const deliveredReceiptEvent = waitForWebSocketEvent(
    bobSocket,
    (event) => event.event === WS_EVENTS.RECEIPT_DELIVERED,
  );
  const { res: deliveredRes } = await harness.requestJson(
    `/api/v1/messages/${sentMessage.id}/receipts`,
    {
      method: 'POST',
      token: bob.apiKey,
      body: { status: 'delivered' },
    },
  );
  assert.equal(deliveredRes.status, 201);

  const deliveredEvent = await deliveredReceiptEvent;
  assert.equal(deliveredEvent.data.messageId, sentMessage.id);
  assert.equal(deliveredEvent.data.conversationId, dm.id);

  const readReceiptEvent = waitForWebSocketEvent(
    bobSocket,
    (event) => event.event === WS_EVENTS.RECEIPT_READ,
  );
  const { res: readRes } = await harness.requestJson(
    `/api/v1/messages/${sentMessage.id}/receipts`,
    {
      method: 'POST',
      token: bob.apiKey,
      body: { status: 'read' },
    },
  );
  assert.equal(readRes.status, 200);

  const readEvent = await readReceiptEvent;
  assert.equal(readEvent.data.messageId, sentMessage.id);

  const typingEvent = waitForWebSocketEvent(
    bobSocket,
    (event) => event.event === WS_EVENTS.TYPING_START,
  );
  const { res: typingRes } = await harness.requestJson(
    '/api/v1/typing',
    {
      method: 'POST',
      token: alice.apiKey,
      body: { conversationId: dm.id, typing: true },
    },
  );
  assert.equal(typingRes.status, 200);

  const typingStart = await typingEvent;
  assert.equal(typingStart.data.conversationId, dm.id);
  assert.equal(typingStart.data.agentId, alice.agentId);

  const presenceEvent = waitForWebSocketEvent(
    bobSocket,
    (event) => event.event === WS_EVENTS.PRESENCE_UPDATE,
  );
  const { res: presenceRes } = await harness.requestJson(
    '/api/v1/presence',
    {
      method: 'POST',
      token: alice.apiKey,
      body: { status: 'away' },
    },
  );
  assert.equal(presenceRes.status, 200);

  const presenceUpdate = await presenceEvent;
  assert.equal(presenceUpdate.data.agentId, alice.agentId);
  assert.equal(presenceUpdate.data.status, 'away');

  const deleteMessageEvent = waitForWebSocketEvent(
    bobSocket,
    (event) => event.event === WS_EVENTS.MESSAGE_DELETED,
  );
  const { res: deleteRes } = await harness.requestJson(
    `/api/v1/messages/${sentMessage.id}`,
    {
      method: 'DELETE',
      token: alice.apiKey,
    },
  );
  assert.equal(deleteRes.status, 200);

  const deletedEvent = await deleteMessageEvent;
  assert.equal(deletedEvent.data.id, sentMessage.id);

  const { res: challengeRes, json: challenge } = await harness.requestJson<{
    challenge: string;
  }>('/api/v1/auth/challenge', {
    method: 'POST',
    body: { publicKey: charlie.publicKey },
  });
  assert.equal(challengeRes.status, 200);

  const verifySignature = signMessage(
    new TextEncoder().encode(challenge.challenge),
    charlie.privateKey!,
  );
  const { res: verifyRes, json: verified } = await harness.requestJson<{ token: string }>(
    '/api/v1/auth/verify',
    {
      method: 'POST',
      body: {
        publicKey: charlie.publicKey,
        challenge: challenge.challenge,
        signature: verifySignature,
      },
    },
  );
  assert.equal(verifyRes.status, 200);

  const { res: jwtRes, json: jwtConversations } = await harness.requestJson<{ data: unknown[] }>(
    '/api/v1/conversations',
    { token: verified.token },
  );
  assert.equal(jwtRes.status, 200);
  assert.deepEqual(jwtConversations.data, []);

  const { res: localDiscoverRes, result: localCard } = await callA2A<{
    publicKey: string;
    protocolVersion: string;
  }>(harness, 'discoverAgent', { agentId: charlie.agentId });
  assert.equal(localDiscoverRes.status, 200);
  assert.equal(localCard.publicKey, charlie.publicKey);
  assert.equal(localCard.protocolVersion, A2A_PROTOCOL_VERSION);

  const { res: externalDiscoverRes, result: externalDiscover } = await callA2A<{
    id: string;
    publicKey: string;
    apiEndpoint: string;
  }>(
    harness,
    'discoverAgent',
    { agentUrl: externalCard.url },
  );
  assert.equal(externalDiscoverRes.status, 200);
  assert.equal(externalDiscover.id, externalCard.url);
  assert.equal(externalDiscover.publicKey, externalKeyPair.publicKey);

  await stopServer(externalCard.server);

  const { result: cachedDiscover } = await callA2A<{
    id: string;
    publicKey: string;
  }>(
    harness,
    'discoverAgent',
    { agentUrl: externalCard.url },
  );
  assert.equal(cachedDiscover.id, externalCard.url);
  assert.equal(cachedDiscover.publicKey, externalKeyPair.publicKey);

  const taskId = 'task-ext-001';
  const correlationId = 'corr-ext-001';
  const natsMessagePromise = waitForNatsMessage<{
    type: string;
    data: {
      conversationId: string;
      taskId: string;
      correlationId: string;
      toAgent: string;
    };
  }>(nats, 'swarmrelay.a2a.message_new');

  const { res: sendA2ARes, result: a2aSend } = await callA2A<{
    messageId: string;
    conversationId: string;
    taskId: string;
    status: string;
  }>(
    harness,
    'sendMessage',
    {
      fromAgent: externalCard.url,
      toAgent: charlie.agentId,
      message: { text: 'External coordination task' },
      taskId,
      correlationId,
      metadata: { messageType: 'task_request' },
    },
    { agentId: externalCard.url, secretKey: externalKeyPair.secretKey },
  );
  assert.equal(sendA2ARes.status, 200);
  assert.equal(a2aSend.taskId, taskId);
  assert.equal(a2aSend.status, 'delivered');

  const messageEnvelope = await natsMessagePromise;
  assert.equal(messageEnvelope.type, 'a2a.message.new');
  assert.equal(messageEnvelope.data.toAgent, charlie.agentId);
  assert.equal(messageEnvelope.data.taskId, taskId);

  const { result: statusByTask } = await callA2A<{
    taskId: string;
    correlationId: string;
    conversationId: string;
    status: string;
    messageCount: number;
    latestMessage?: { id: string };
  }>(
    harness,
    'getStatus',
    { taskId },
  );
  assert.equal(statusByTask.taskId, taskId);
  assert.equal(statusByTask.status, 'submitted');
  assert.equal(Number(statusByTask.messageCount), 1);
  assert.equal(statusByTask.latestMessage?.id, a2aSend.messageId);

  const { result: resultByCorrelation } = await callA2A<{
    taskId: string;
    correlationId: string;
    status: string;
  }>(
    harness,
    'getResult',
    { correlationId },
  );
  assert.equal(resultByCorrelation.taskId, taskId);
  assert.equal(resultByCorrelation.correlationId, correlationId);

  const natsCancelPromise = waitForNatsMessage<{
    type: string;
    data: { taskId: string; reason: string | null };
  }>(nats, 'swarmrelay.a2a.task_cancelled');

  const { result: cancelResult } = await callA2A<{
    success: boolean;
    taskId: string;
  }>(
    harness,
    'cancelTask',
    { taskId, reason: 'No longer needed' },
    { agentId: externalCard.url, secretKey: externalKeyPair.secretKey },
  );
  assert.equal(cancelResult.success, true);
  assert.equal(cancelResult.taskId, taskId);

  const cancelEnvelope = await natsCancelPromise;
  assert.equal(cancelEnvelope.type, 'a2a.task.cancelled');
  assert.equal(cancelEnvelope.data.taskId, taskId);

  const { result: cancelledStatus } = await callA2A<{
    taskId: string;
    status: string;
    errorMessage?: string;
  }>(
    harness,
    'getStatus',
    { taskId },
  );
  assert.equal(cancelledStatus.taskId, taskId);
  assert.equal(cancelledStatus.status, 'cancelled');
  assert.equal(cancelledStatus.errorMessage, 'No longer needed');
});
