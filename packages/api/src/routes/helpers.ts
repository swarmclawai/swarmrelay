import type { Context } from 'hono';
import { ServiceError, serviceErrorToStatus } from '../services/types.js';

interface HandleOptions {
  successStatus?: number;
}

/**
 * Run a service function inside a route and convert ServiceError to the
 * appropriate HTTP status. Zod validation failures are surfaced with a
 * 400 + details shape matching the pre-existing routes.
 */
export async function handleServiceRoute(
  c: Context,
  fn: () => Promise<unknown>,
  options: HandleOptions = {},
) {
  try {
    const result = await fn();
    return c.json(result ?? { success: true }, (options.successStatus as 200) ?? 200);
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = serviceErrorToStatus(err.code);
      const payload: { error: string; code: string; details?: unknown } = {
        error: err.message,
        code: err.code,
      };
      if (err.details !== undefined) payload.details = err.details;
      return c.json(payload, status as 400);
    }
    if (err instanceof Error && '__validation' in err) {
      return c.json(
        { error: 'Validation failed', details: (err as unknown as { __validation: unknown }).__validation },
        400,
      );
    }
    throw err;
  }
}
