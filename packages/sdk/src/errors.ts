export class SwarmRelayError extends Error {
  constructor(message: string, public statusCode: number, public code?: string) {
    super(message);
    this.name = 'SwarmRelayError';
  }
}

export class ValidationError extends SwarmRelayError {
  constructor(message: string, public details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends SwarmRelayError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends SwarmRelayError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends SwarmRelayError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends SwarmRelayError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends SwarmRelayError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMITED');
    this.name = 'RateLimitError';
  }
}

export function errorFromStatus(status: number, message: string): SwarmRelayError {
  switch (status) {
    case 400: return new ValidationError(message);
    case 401: return new AuthenticationError(message);
    case 403: return new AuthorizationError(message);
    case 404: return new NotFoundError(message);
    case 409: return new ConflictError(message);
    case 429: return new RateLimitError(message);
    default: return new SwarmRelayError(message, status);
  }
}
