import type { WebSocketMessage, WsEventType } from '@swarmrelay/shared';
import { WS_EVENTS } from '@swarmrelay/shared';
import { redisPublish } from './redis.js';

async function publish(channel: string, event: WsEventType, data: Record<string, unknown>) {
  const payload: WebSocketMessage = { event, data };
  await redisPublish(channel, JSON.stringify(payload));
}

export async function publishConversationEvent(
  conversationId: string,
  event: WsEventType,
  data: Record<string, unknown>,
) {
  await publish(`msg:${conversationId}`, event, data);
}

export async function publishPresenceEvent(data: Record<string, unknown>) {
  await publish('presence:update', WS_EVENTS.PRESENCE_UPDATE, data);
}
