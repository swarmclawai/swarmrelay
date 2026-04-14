import type { MessagingBackend } from '../backend.js';

export type Backend = MessagingBackend;

export function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function errorContent(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

export async function safeCall<T>(fn: () => Promise<T>) {
  try {
    const result = await fn();
    return jsonContent(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`SwarmRelay error: ${message}`);
  }
}
