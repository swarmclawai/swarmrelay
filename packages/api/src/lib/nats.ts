import {
  JSONCodec,
  connect,
  type NatsConnection,
  type JetStreamManager,
  AckPolicy,
  DeliverPolicy,
  RetentionPolicy,
  type ConsumerMessages,
} from 'nats';

/**
 * Lightweight event envelope for NATS messages.
 * Mirrors the SwarmDock pattern but scoped to SwarmRelay domains.
 */
export type NatsEventEnvelope = {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  originInstanceId: string;
  agentId?: string | null;
  conversationId?: string | null;
};

const codec = JSONCodec<NatsEventEnvelope>();
let connectionPromise: Promise<NatsConnection | null> | null = null;

const STREAM_NAME = 'SWARMRELAY';
const STREAM_SUBJECTS = [
  'swarmrelay.msg.>',
  'swarmrelay.presence.>',
  'swarmrelay.typing.>',
  'swarmrelay.system.>',
];

export function isNatsConfigured(): boolean {
  return Boolean(process.env.NATS_URL?.trim());
}

export async function getNatsConnection(): Promise<NatsConnection | null> {
  if (!isNatsConfigured()) {
    return null;
  }

  if (!connectionPromise) {
    connectionPromise = connect({
      servers: process.env.NATS_URL!,
      name: process.env.NATS_CLIENT_NAME ?? 'swarmrelay-api',
    }).catch((error) => {
      console.error('[NATS] connection failed:', error);
      connectionPromise = null;
      return null;
    });
  }

  return connectionPromise;
}

/**
 * Ensure the JetStream stream exists with the expected configuration.
 * Creates it if missing, updates subjects if they differ.
 */
async function ensureStream(jsm: JetStreamManager): Promise<void> {
  try {
    const info = await jsm.streams.info(STREAM_NAME);
    // Update subjects if needed
    const currentSubjects = info.config.subjects ?? [];
    const needsUpdate = STREAM_SUBJECTS.some((s) => !currentSubjects.includes(s));
    if (needsUpdate) {
      await jsm.streams.update(STREAM_NAME, {
        ...info.config,
        subjects: STREAM_SUBJECTS,
      });
    }
  } catch {
    // Stream doesn't exist — create it
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: STREAM_SUBJECTS,
      retention: RetentionPolicy.Limits,
      max_msgs: 1_000_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
      max_bytes: 512 * 1024 * 1024, // 512 MiB
      num_replicas: 1,
    });
    console.log('[NATS] created JetStream stream:', STREAM_NAME);
  }
}

/**
 * Publish an event to JetStream with at-least-once delivery guarantee.
 */
export async function publishNatsEvent(
  subject: string,
  event: NatsEventEnvelope,
): Promise<boolean> {
  const nc = await getNatsConnection();
  if (!nc) return false;

  try {
    const jsm = await nc.jetstreamManager();
    await ensureStream(jsm);
    const js = nc.jetstream();

    await js.publish(subject, codec.encode(event));
    return true;
  } catch (error) {
    console.error('[NATS] JetStream publish failed:', error);
    return false;
  }
}

/**
 * Subscribe to events using a JetStream durable consumer.
 * Messages are acked after successful handler execution.
 * On handler failure, messages are nacked for redelivery.
 */
export async function subscribeNatsEvents(
  onEvent: (subject: string, event: NatsEventEnvelope) => void | Promise<void>,
  consumerName = 'swarmrelay-worker',
): Promise<() => void> {
  const nc = await getNatsConnection();
  if (!nc) return () => {};

  let consumer: ConsumerMessages | null = null;

  try {
    const jsm = await nc.jetstreamManager();
    await ensureStream(jsm);

    // Ensure durable consumer exists
    try {
      await jsm.consumers.info(STREAM_NAME, consumerName);
    } catch {
      await jsm.consumers.add(STREAM_NAME, {
        durable_name: consumerName,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subjects: STREAM_SUBJECTS,
        max_deliver: 5,
        ack_wait: 30 * 1_000_000_000, // 30s in nanoseconds
      });
      console.log('[NATS] created durable consumer:', consumerName);
    }

    const js = nc.jetstream();
    consumer = await js.consumers.get(STREAM_NAME, consumerName).then((c) => c.consume());

    void (async () => {
      for await (const msg of consumer!) {
        try {
          const event = codec.decode(msg.data);
          await onEvent(msg.subject, event);
          msg.ack();
        } catch (error) {
          console.error('[NATS] event handler failed, nacking for redelivery:', error);
          msg.nak();
        }
      }
    })();
  } catch (error) {
    console.error('[NATS] JetStream subscription setup failed, falling back to basic sub:', error);
    // Fallback to basic pub/sub if JetStream isn't available
    return subscribeBasic(nc, onEvent);
  }

  return () => {
    consumer?.stop();
  };
}

/**
 * Fallback: basic pub/sub for environments without JetStream.
 */
function subscribeBasic(
  nc: NatsConnection,
  onEvent: (subject: string, event: NatsEventEnvelope) => void | Promise<void>,
): () => void {
  const subs = [
    nc.subscribe('swarmrelay.msg.*'),
    nc.subscribe('swarmrelay.presence.*'),
    nc.subscribe('swarmrelay.typing.*'),
    nc.subscribe('swarmrelay.system.*'),
  ];

  let closed = false;
  for (const sub of subs) {
    void (async () => {
      for await (const msg of sub) {
        if (closed) break;
        try {
          await onEvent(msg.subject, codec.decode(msg.data));
        } catch (error) {
          console.error('[NATS] event handler failed:', error);
        }
      }
    })();
  }

  return () => {
    closed = true;
    for (const sub of subs) sub.unsubscribe();
  };
}

/**
 * Graceful shutdown — drain the connection (flushes pending messages)
 * and release the singleton.
 */
export async function closeNats(): Promise<void> {
  if (!connectionPromise) return;
  const nc = await connectionPromise;
  connectionPromise = null;
  if (!nc) return;

  try {
    await nc.drain();
    console.log('[NATS] connection drained and closed');
  } catch (error) {
    console.error('[NATS] error during close:', error);
    try {
      await nc.close();
    } catch {}
  }
}
