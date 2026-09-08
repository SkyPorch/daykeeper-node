export type DaykeeperTransportErrorCode =
  | "INVALID_CONFIGURATION"
  | "TOKEN_PROVIDER_ERROR"
  | "NETWORK_ERROR"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "INVALID_RESPONSE"
  | "RESPONSE_TOO_LARGE";

export interface DaykeeperErrorJson {
  name: string;
  code: string;
  message: string;
  retryable: boolean;
  /** True when the server may have applied the mutation despite the failure. */
  outcomeUnknown: boolean;
  status?: number;
  nextActions?: readonly string[];
  correlationId?: string;
  fields?: readonly string[];
}

/**
 * A rejection carrying an HTTP status. It is normally the Daykeeper API's own
 * error envelope, but a proxy or load balancer can reject a request too, in
 * which case the code is derived from the status. Only contract fields are
 * projected, each length-bounded, and a correlation identifier taken from a
 * response header must match an opaque token shape. No other part of the
 * response body, and no other header, reaches the caller.
 */
export class DaykeeperApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  /** True when the server says a dispatched mutation's outcome is unknown. */
  readonly outcomeUnknown: boolean;
  readonly nextActions: readonly string[];
  readonly correlationId?: string;
  readonly fields?: readonly string[];

  constructor(options: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
    nextActions?: readonly string[];
    correlationId?: string;
    fields?: readonly string[];
    outcomeUnknown?: boolean;
  }) {
    super(options.message);
    this.name = "DaykeeperApiError";
    this.status = options.status;
    this.code = options.code;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    this.retryable = this.outcomeUnknown ? false : options.retryable;
    this.nextActions = options.nextActions ?? [];
    this.correlationId = options.correlationId;
    this.fields = options.fields;
  }

  toJSON(): DaykeeperErrorJson {
    return compact({
      name: this.name,
      status: this.status,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      outcomeUnknown: this.outcomeUnknown,
      nextActions: this.nextActions,
      correlationId: this.correlationId,
      fields: this.fields,
    });
  }
}

/**
 * A failure the SDK detected locally. `outcomeUnknown` is true when the request
 * may already have reached the server: recover by repeating the same call with
 * the same idempotency key, never with a new one.
 */
export class DaykeeperTransportError extends Error {
  readonly code: DaykeeperTransportErrorCode;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  /** Undefined: no server response was projected. */
  readonly status?: number;
  readonly correlationId?: string;

  constructor(options: {
    code: DaykeeperTransportErrorCode;
    message: string;
    retryable?: boolean;
    outcomeUnknown?: boolean;
    correlationId?: string;
  }) {
    super(options.message);
    this.name = "DaykeeperTransportError";
    this.code = options.code;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    // An unknown outcome is never automatically retryable: only the caller
    // knows whether the same idempotency key still applies.
    this.retryable = this.outcomeUnknown ? false : (options.retryable ?? false);
    this.correlationId = options.correlationId;
  }

  toJSON(): DaykeeperErrorJson {
    return compact({
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      outcomeUnknown: this.outcomeUnknown,
      correlationId: this.correlationId,
    });
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
