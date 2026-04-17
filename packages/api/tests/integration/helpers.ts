import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connect as connectNats, JSONCodec, type NatsConnection } from 'nats';
import { createClient } from 'redis';
import type { RegisterResponse, WebSocketMessage } from '@swarmrelay/shared';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const apiEntry = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
const tsxLoader = fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url));

const POSTGRES_IMAGE = process.env.SWARMRELAY_TEST_POSTGRES_IMAGE ?? 'pgvector/pgvector:pg16';
const REDIS_IMAGE = process.env.SWARMRELAY_TEST_REDIS_IMAGE ?? 'redis:7-alpine';
const NATS_IMAGE = process.env.SWARMRELAY_TEST_NATS_IMAGE ?? 'nats:2-alpine';

function runCommand(command: string, args: string[], options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const result = spawnSync(command, args, {
    cwd: options?.cwd ?? repoRoot,
    env: options?.env ?? process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ].filter(Boolean).join('\n'),
    );
  }

  return result.stdout.trim();
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, 'string');
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs = 30_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(intervalMs);
    }
  }

  throw new Error(`${label} timed out${lastError ? `: ${(lastError as Error).message}` : ''}`);
}

async function isPostgresReady(connectionString: string) {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function isRedisReady(url: string) {
  const client = createClient({ url });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  } finally {
    await client.quit().catch(() => {});
  }
}

async function isNatsReady(servers: string) {
  let connection: NatsConnection | null = null;
  try {
    connection = await connectNats({
      servers,
      timeout: 1000,
      maxReconnectAttempts: 0,
    });
    return true;
  } catch {
    return false;
  } finally {
    await connection?.close().catch(() => {});
  }
}

function dockerPort(containerId: string, privatePort: number) {
  const output = runCommand('docker', ['port', containerId, `${privatePort}/tcp`]);
  const line = output
    .split('\n')
    .map((value) => value.trim())
    .find(Boolean);

  if (!line) {
    throw new Error(`No mapped port found for ${containerId}:${privatePort}`);
  }

  const match = line.match(/:(\d+)$/);
  if (!match) {
    throw new Error(`Unexpected docker port output: ${line}`);
  }

  return Number(match[1]);
}

async function startPostgresContainer() {
  const containerId = runCommand('docker', [
    'run',
    '-d',
    '--rm',
    '-e',
    'POSTGRES_USER=swarmrelay',
    '-e',
    'POSTGRES_PASSWORD=swarmrelay',
    '-e',
    'POSTGRES_DB=swarmrelay',
    '-p',
    '0:5432',
    POSTGRES_IMAGE,
  ]);
  const port = dockerPort(containerId, 5432);
  const databaseUrl = `postgresql://swarmrelay:swarmrelay@127.0.0.1:${port}/swarmrelay`;

  await waitFor('postgres readiness', async () => {
    if (!await isPostgresReady(databaseUrl)) {
      throw new Error('Postgres not accepting connections yet');
    }
    return true;
  });

  return {
    containerId,
    databaseUrl,
    adminUrl: `postgresql://swarmrelay:swarmrelay@127.0.0.1:${port}/postgres`,
  };
}

async function startRedisContainer() {
  const containerId = runCommand('docker', [
    'run',
    '-d',
    '--rm',
    '-p',
    '0:6379',
    REDIS_IMAGE,
  ]);
  const port = dockerPort(containerId, 6379);
  const redisUrl = `redis://127.0.0.1:${port}`;

  await waitFor('redis readiness', async () => {
    if (!await isRedisReady(redisUrl)) {
      throw new Error('Redis not accepting connections yet');
    }
    return true;
  });

  return {
    containerId,
    redisUrl,
  };
}

async function startNatsContainer() {
  const containerId = runCommand('docker', [
    'run',
    '-d',
    '--rm',
    '-p',
    '0:4222',
    '-p',
    '0:8222',
    NATS_IMAGE,
    '--jetstream',
    '--store_dir=/data',
  ]);
  const port = dockerPort(containerId, 4222);
  const natsUrl = `nats://127.0.0.1:${port}`;

  await waitFor('nats readiness', async () => {
    if (!await isNatsReady(natsUrl)) {
      throw new Error('NATS not accepting connections yet');
    }
    return true;
  });

  return {
    containerId,
    natsUrl,
  };
}

async function stopDockerContainer(containerId: string) {
  runCommand('docker', ['stop', containerId]);
}

async function startDockerServices() {
  const postgres = await startPostgresContainer();
  const redis = await startRedisContainer();
  const nats = await startNatsContainer();

  return {
    postgres,
    redis,
    nats,
    async cleanup() {
      await Promise.all([
        stopDockerContainer(nats.containerId),
        stopDockerContainer(redis.containerId),
        stopDockerContainer(postgres.containerId),
      ]);
    },
  };
}

async function createDatabase(baseDatabaseUrl: string) {
  const baseUrl = new URL(baseDatabaseUrl);
  const dbName = `swarmrelay_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${dbName}`;

  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  return {
    dbName,
    databaseUrl: testUrl.toString(),
    adminUrl: adminUrl.toString(),
  };
}

function createIsolatedRedisUrl(baseRedisUrl: string) {
  const url = new URL(baseRedisUrl);
  const dbIndex = Math.floor(Math.random() * 14) + 1;
  url.pathname = `/${dbIndex}`;
  return url.toString();
}

async function pushSchema(databaseUrl: string) {
  runCommand(
    'pnpm',
    ['exec', 'drizzle-kit', 'push', '--force', '--config', 'drizzle.config.ts'],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    },
  );
}

async function stopProcess(process: ChildProcessWithoutNullStreams, timeoutMs = 10_000) {
  if (process.exitCode !== null) return;

  process.kill('SIGTERM');
  const exitPromise = once(process, 'exit');
  const timeoutPromise = sleep(timeoutMs).then(() => {
    if (process.exitCode === null) {
      process.kill('SIGKILL');
    }
  });

  await Promise.race([exitPromise, timeoutPromise]);
}

async function readWebSocketMessageData(data: unknown) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer).toString('utf8');
  if (data && typeof data === 'object' && 'text' in data && typeof data.text === 'function') {
    return await (data as Blob).text();
  }
  return String(data);
}

export async function waitForWebSocketEvent(
  socket: WebSocket,
  predicate: (event: WebSocketMessage) => boolean,
  timeoutMs = 5_000,
) {
  return new Promise<WebSocketMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket event'));
    }, timeoutMs);

    const handleMessage = (messageEvent: MessageEvent) => {
      void (async () => {
        const raw = await readWebSocketMessageData(messageEvent.data);
        const parsed = JSON.parse(raw) as WebSocketMessage;

        if (predicate(parsed)) {
          cleanup();
          resolve(parsed);
        }
      })().catch((error) => {
        cleanup();
        reject(error);
      });
    };

    const handleError = () => {
      cleanup();
      reject(new Error('WebSocket error while waiting for event'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('message', handleMessage as EventListener);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('message', handleMessage as EventListener);
    socket.addEventListener('error', handleError);
  });
}

export async function waitForNatsMessage<T>(
  connection: NatsConnection,
  subject: string,
  timeoutMs = 5_000,
) {
  const codec = JSONCodec<T>();
  const subscription = connection.subscribe(subject, { max: 1 });

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`Timed out waiting for NATS message on ${subject}`));
    }, timeoutMs);

    void (async () => {
      for await (const message of subscription) {
        clearTimeout(timer);
        resolve(codec.decode(message.data));
        return;
      }

      clearTimeout(timer);
      reject(new Error(`Subscription ended before receiving a message on ${subject}`));
    })().catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export interface ApiHarness {
  baseUrl: string;
  wsUrl: string;
  natsUrl: string;
  requestJson: <T = unknown>(
    path: string,
    options?: {
      method?: string;
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    },
  ) => Promise<{ res: Response; json: T }>;
  registerAgent: (name: string) => Promise<RegisterResponse>;
  openWebSocket: (token: string) => Promise<WebSocket>;
  logs: () => string;
  cleanup: () => Promise<void>;
}

export async function startApiHarness(): Promise<ApiHarness> {
  const docker = await startDockerServices();
  const database = await createDatabase(docker.postgres.databaseUrl);
  const redisUrl = createIsolatedRedisUrl(docker.redis.redisUrl);
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  await pushSchema(database.databaseUrl);

  const logs: string[] = [];
  const child = spawn(process.execPath, ['--import', tsxLoader, apiEntry], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: database.databaseUrl,
      REDIS_URL: redisUrl,
      NATS_URL: docker.nats.natsUrl,
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret',
      AGENT_KEY_ENCRYPTION_KEY: '0'.repeat(64),
      CORS_ORIGINS: 'http://localhost:3600',
      DASHBOARD_URL: 'http://localhost:3600',
      API_URL: baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    logs.push(String(chunk));
  });
  child.stderr.on('data', (chunk) => {
    logs.push(String(chunk));
  });

  await waitFor('API health check', async () => {
    if (child.exitCode !== null) {
      throw new Error(`API exited early:\n${logs.join('')}`);
    }

    const res = await fetch(`${baseUrl}/api/v1/health`);
    if (!res.ok) {
      throw new Error(`Health check returned ${res.status}`);
    }

    return true;
  });

  let cleanedUp = false;

  return {
    baseUrl,
    wsUrl,
    natsUrl: docker.nats.natsUrl,
    async requestJson<T = unknown>(path: string, options?: {
      method?: string;
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    }) {
      const headers = new Headers(options?.headers);

      if (options?.token) {
        headers.set('Authorization', `Bearer ${options.token}`);
      }

      if (options?.body !== undefined) {
        headers.set('Content-Type', 'application/json');
      }

      const res = await fetch(`${baseUrl}${path}`, {
        method: options?.method ?? 'GET',
        headers,
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      const text = await res.text();
      return {
        res,
        json: (text ? JSON.parse(text) : null) as T,
      };
    },
    async registerAgent(name: string) {
      const { res, json } = await this.requestJson<RegisterResponse>('/api/v1/register', {
        method: 'POST',
        body: { name },
      });
      assert.equal(res.status, 201);
      return json;
    },
    async openWebSocket(token: string) {
      const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Timed out opening WebSocket connection'));
        }, 5_000);

        const handleOpen = () => {
          cleanup();
          resolve();
        };

        const handleError = () => {
          cleanup();
          reject(new Error('WebSocket failed to open'));
        };

        const cleanup = () => {
          clearTimeout(timer);
          socket.removeEventListener('open', handleOpen);
          socket.removeEventListener('error', handleError);
        };

        socket.addEventListener('open', handleOpen);
        socket.addEventListener('error', handleError);
      });

      return socket;
    },
    logs() {
      return logs.join('');
    },
    async cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;

      await stopProcess(child);

      const redisClient = createClient({ url: redisUrl });
      await redisClient.connect();
      await redisClient.flushDb();
      await redisClient.quit();

      const admin = new pg.Client({ connectionString: database.adminUrl });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS "${database.dbName}" WITH (FORCE)`);
      await admin.end();

      await docker.cleanup();
    },
  };
}
