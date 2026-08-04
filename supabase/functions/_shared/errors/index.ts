// supabase/functions/_shared/errors/index.ts
//
// Every error thrown inside an Edge Function handler should be one of these
// classes (or a domain-specific subclass a future phase adds — WalletError,
// EscrowError etc. are declared here as the base classes future phases
// extend, but this framework contains no logic that would ever throw them
// itself, per "no business logic").

export abstract class EdgeFunctionError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toResponseBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class AuthenticationError extends EdgeFunctionError {
  readonly code = "AUTH_INVALID_CREDENTIALS";
  readonly httpStatus = 401;
}

export class AuthorizationError extends EdgeFunctionError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
}

export class ValidationError extends EdgeFunctionError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
}

export class NotFoundError extends EdgeFunctionError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
}

export class ConflictError extends EdgeFunctionError {
  readonly code = "CONFLICT";
  readonly httpStatus = 409;
}

export class RateLimitError extends EdgeFunctionError {
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly httpStatus = 429;

  constructor(
    message: string,
    public readonly retryAfterSeconds: number,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

export class IdempotencyConflictError extends EdgeFunctionError {
  readonly code = "IDEMPOTENCY_KEY_REUSED";
  readonly httpStatus = 409;
}

export class InternalServerError extends EdgeFunctionError {
  readonly code = "INTERNAL_ERROR";
  readonly httpStatus = 500;
}

/**
 * Base classes for future business-domain errors. Declared here so every
 * future phase subclasses a common shape (and so error-handling middleware
 * in this framework can catch `EdgeFunctionError` generically) — none of
 * these are thrown anywhere in this framework itself.
 */
export class WalletError extends EdgeFunctionError {
  readonly code = "WALLET_ERROR";
  readonly httpStatus = 422;
}

export class EscrowError extends EdgeFunctionError {
  readonly code = "ESCROW_ERROR";
  readonly httpStatus = 409;
}

export class ChallengeError extends EdgeFunctionError {
  readonly code = "CHALLENGE_ERROR";
  readonly httpStatus = 409;
}

export class TournamentError extends EdgeFunctionError {
  readonly code = "TOURNAMENT_ERROR";
  readonly httpStatus = 409;
}

export class PaymentError extends EdgeFunctionError {
  readonly code = "PAYMENT_ERROR";
  readonly httpStatus = 402;
}

export class StorageError extends EdgeFunctionError {
  readonly code = "STORAGE_ERROR";
  readonly httpStatus = 500;
}

/** Converts an unknown thrown value into an EdgeFunctionError, defaulting
 * to InternalServerError for anything that isn't already one — so handler
 * code never needs its own top-level try/catch just to normalize errors. */
export function toEdgeFunctionError(err: unknown): EdgeFunctionError {
  if (err instanceof EdgeFunctionError) return err;
  if (err instanceof Error) return new InternalServerError(err.message);
  return new InternalServerError("An unexpected error occurred.");
}
