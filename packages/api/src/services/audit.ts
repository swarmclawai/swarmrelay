import { db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export async function logAuditEvent(params: {
  eventType: string;
  actorId?: string;
  targetId?: string;
  targetType?: string;
  ownerId?: string;
  payload?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLog).values({
      eventType: params.eventType,
      actorId: params.actorId ?? null,
      targetId: params.targetId ?? null,
      targetType: params.targetType ?? null,
      ownerId: params.ownerId ?? null,
      payload: params.payload ?? null,
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}
