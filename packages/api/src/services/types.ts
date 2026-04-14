import type { AgentAuthPayload } from '@swarmrelay/shared';

/**
 * AgentContext is the caller identity attached to every service invocation.
 * It mirrors what the apiKeyAuth / challengeAuth middleware puts on the
 * Hono context, but is framework-agnostic so services can be used from
 * HTTP route handlers, the hosted MCP endpoint, WebSocket handlers, etc.
 */
export type AgentContext = AgentAuthPayload;

export type ServiceErrorCode =
  | 'not_found'
  | 'validation'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'no_agent_key'
  | 'invalid_state';

/**
 * Services throw ServiceError for expected, user-visible failures. The
 * route layer (or MCP tool handler) maps error.code to an HTTP status.
 */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly details?: unknown;

  constructor(code: ServiceErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }
}

export function serviceErrorToStatus(code: ServiceErrorCode): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'validation':
      return 400;
    case 'forbidden':
      return 403;
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'no_agent_key':
    case 'invalid_state':
      return 400;
  }
}
