import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export async function connectRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('Redis unavailable — no REDIS_URL configured');
    return;
  }
  try {
    client = createClient({ url });
    client.on('error', (err) => console.warn('Redis error:', err.message));
    await client.connect();
    console.log('Redis connected');
  } catch (err) {
    console.warn('Redis unavailable:', (err as Error).message);
    client = null;
  }
}

function getClient(): RedisClientType | null {
  return client;
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    return await getClient()?.get(key) ?? null;
  } catch {
    return null;
  }
}

export async function redisSetex(key: string, seconds: number, value: string): Promise<void> {
  try {
    await getClient()?.setEx(key, seconds, value);
  } catch {}
}

export async function redisSet(key: string, value: string, ttl?: number): Promise<void> {
  try {
    if (ttl) {
      await getClient()?.setEx(key, ttl, value);
    } else {
      await getClient()?.set(key, value);
    }
  } catch {}
}

export async function redisIncr(key: string): Promise<number | null> {
  try {
    return await getClient()?.incr(key) ?? null;
  } catch {
    return null;
  }
}

export async function redisPexpire(key: string, milliseconds: number): Promise<void> {
  try {
    await getClient()?.pExpire(key, milliseconds);
  } catch {}
}

export async function redisDel(key: string): Promise<void> {
  try {
    await getClient()?.del(key);
  } catch {}
}

export async function redisPublish(channel: string, message: string): Promise<void> {
  try {
    await getClient()?.publish(channel, message);
  } catch {}
}

export async function createSubscriber(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const sub = createClient({ url }) as RedisClientType;
    await sub.connect();
    return sub;
  } catch {
    return null;
  }
}
