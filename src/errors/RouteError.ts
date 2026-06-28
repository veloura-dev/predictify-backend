/**
 * Discriminated union representing all typed errors that can occur in route handlers.
 * Services return Result<T, RouteError> instead of throwing.
 * Middleware translates each variant to the appropriate HTTP status and envelope.
 */

/**
 * Standard error response envelope sent to clients.
 * All client-facing error responses follow this shape.
 */
export interface ErrorEnvelope {
  /** Machine-readable error code matching the RouteError kind. */
  code: string;
  /** Human-readable message safe to expose to clients. */
  message: string;
  /** Correlation ID for log tracing. */
  correlationId: string;
  /** Optional validation field errors (only for ValidationError). */
  fields?: Record<string, string[]>;
}

/**
 * Discriminated union of all possible handler errors.
 * Each variant uses 'kind' as the discriminant for exhaustive matching.
 */
export type RouteError =
  | {
      kind: "NotFound";
      message: string;
      resource?: string;
    }
  | {
      kind: "Unauthorized";
      message: string;
    }
  | {
      kind: "Forbidden";
      message: string;
      reason?: string;
    }
  | {
      kind: "ValidationError";
      message: string;
      fields?: Record<string, string[]>;
    }
  | {
      kind: "Conflict";
      message: string;
      resource?: string;
    }
  | {
      kind: "InternalError";
      message: string;
      cause?: unknown;
    }
  | {
      kind: "BadRequest";
      message: string;
      detail?: string;
    };

/**
 * HTTP status code for each RouteError variant.
 * Exhaustively maps all discriminant values to status codes.
 */
export const HTTP_STATUS: Record<RouteError["kind"], number> = {
  NotFound: 404,
  Unauthorized: 401,
  Forbidden: 403,
  ValidationError: 422,
  Conflict: 409,
  InternalError: 500,
  BadRequest: 400,
};

/**
 * Result type for service functions.
 * Either a successful value (ok: true) or a typed error (ok: false).
 * Services return this instead of throwing.
 */
export type Result<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: RouteError;
    };

/**
 * Construct an Ok result containing a successful value.
 * @param value The successful result value
 * @returns A Result in success state
 */
export const ok = <T>(value: T): Result<T> => ({
  ok: true,
  value,
});

/**
 * Construct an Err result containing a typed error.
 * @param error The RouteError to wrap
 * @returns A Result in error state (return type is never to signal control flow stops)
 */
export const err = (error: RouteError): Result<never> => ({
  ok: false,
  error,
});

/**
 * Type guard to detect if an unknown value is a RouteError.
 * Checks for the presence of the 'kind' discriminant.
 * @param e The value to check
 * @returns true if e is a RouteError, false otherwise
 */
export function isRouteError(e: unknown): e is RouteError {
  return typeof e === "object" && e !== null && "kind" in e;
}
