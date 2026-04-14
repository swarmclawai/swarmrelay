import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrRegister, readCredentials, writeCredentials, resolveConfigPath } from '../src/credentials.ts';

type FetchImpl = typeof globalThis.fetch;

const REGISTER_PAYLOAD = {
  apiKey: 'rl_live_test_1234567890',
  agentId: 'agent-abc',
  ownerId: 'owner-abc',
  publicKey: 'pub-key-b64',
  privateKey: 'priv-key-b64',
  claimToken: 'CLAIM-AAAA-BBBB',
  claimUrl: 'https://swarmrelay.ai/claim?token=CLAIM-AAAA-BBBB',
};

let tmpDir: string;
let originalFetch: FetchImpl;
const originalEnv = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'swarmrelay-mcp-'));
  originalFetch = globalThis.fetch;
  delete process.env.SWARMRELAY_API_KEY;
  delete process.env.SWARMRELAY_API_URL;
  delete process.env.SWARMRELAY_PUBLIC_KEY;
  delete process.env.SWARMRELAY_PRIVATE_KEY;
  delete process.env.SWARMRELAY_MCP_CONFIG;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tmpDir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe('credentials', () => {
  it('resolveConfigPath honors env and override', () => {
    process.env.SWARMRELAY_MCP_CONFIG = '/tmp/env.json';
    assert.equal(resolveConfigPath(), '/tmp/env.json');
    assert.equal(resolveConfigPath('/custom/path.json'), '/custom/path.json');
  });

  it('readCredentials returns null when file is missing', () => {
    assert.equal(readCredentials(join(tmpDir, 'missing.json')), null);
  });

  it('readCredentials returns null when file lacks apiKey or baseUrl', () => {
    const path = join(tmpDir, 'bad.json');
    writeFileSync(path, JSON.stringify({ foo: 'bar' }));
    assert.equal(readCredentials(path), null);
  });

  it('writeCredentials creates parent dirs and JSON-encodes', () => {
    const path = join(tmpDir, 'nested', 'mcp.json');
    writeCredentials(path, { apiKey: 'k', baseUrl: 'https://example.com' });
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    assert.equal(parsed.apiKey, 'k');
    assert.equal(parsed.baseUrl, 'https://example.com');
  });

  it('loadOrRegister prefers env vars', async () => {
    process.env.SWARMRELAY_API_KEY = 'rl_env_key';
    process.env.SWARMRELAY_API_URL = 'https://env.example.com';
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response('should not be called');
    }) as FetchImpl;

    const creds = await loadOrRegister({ configPath: join(tmpDir, 'mcp.json') });
    assert.equal(creds.apiKey, 'rl_env_key');
    assert.equal(creds.baseUrl, 'https://env.example.com');
    assert.equal(fetchCalls, 0);
  });

  it('loadOrRegister reads existing config and does not call register', async () => {
    const configPath = join(tmpDir, 'mcp.json');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        apiKey: 'rl_file_key',
        baseUrl: 'https://file.example.com',
        agentId: 'agent-file',
        publicKey: 'pk',
        privateKey: 'sk',
      }),
    );
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response('should not be called');
    }) as FetchImpl;

    const creds = await loadOrRegister({ configPath });
    assert.equal(creds.apiKey, 'rl_file_key');
    assert.equal(creds.baseUrl, 'https://file.example.com');
    assert.equal(creds.agentId, 'agent-file');
    assert.equal(creds.privateKey, 'sk');
    assert.equal(fetchCalls, 0);
  });

  it('loadOrRegister auto-registers when no env or config is present', async () => {
    const configPath = join(tmpDir, 'mcp.json');
    let registerCalled = 0;
    let capturedBody: unknown;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      registerCalled += 1;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      assert.match(url, /\/api\/v1\/register$/);
      assert.equal(init?.method, 'POST');
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return new Response(JSON.stringify(REGISTER_PAYLOAD), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as FetchImpl;

    const creds = await loadOrRegister({
      configPath,
      baseUrl: 'https://test-api.example.com',
      agentName: 'test-agent',
    });

    assert.equal(registerCalled, 1);
    assert.deepEqual(capturedBody, { name: 'test-agent' });
    assert.equal(creds.apiKey, REGISTER_PAYLOAD.apiKey);
    assert.equal(creds.baseUrl, 'https://test-api.example.com');
    assert.equal(creds.agentId, REGISTER_PAYLOAD.agentId);
    assert.equal(creds.privateKey, REGISTER_PAYLOAD.privateKey);
    assert.equal(creds.publicKey, REGISTER_PAYLOAD.publicKey);
    assert.equal(creds.claimToken, REGISTER_PAYLOAD.claimToken);

    assert.ok(existsSync(configPath), 'config file was written');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.equal(saved.apiKey, REGISTER_PAYLOAD.apiKey);
    assert.equal(saved.privateKey, REGISTER_PAYLOAD.privateKey);
  });
});
