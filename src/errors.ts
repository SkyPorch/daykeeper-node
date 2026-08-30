export type DaykeeperTransportErrorCode =
  | "INVALID_CONFIGURATION"
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
  status?: number;
  nextActions?: readonly string[];
  correlationId?: string;
  fields?: readonly string[];
}

export class DaykeeperApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
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
  }) {
    super(options.message);
    this.name = "DaykeeperApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
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
      nextActions: this.nextActions,
      correlationId: this.correlationId,
      fields: this.fields,
    });
  }
}

export class DaykeeperTransportError extends Error {
  readonly code: DaykeeperTransportErrorCode;
  readonly retryable: boolean;

  constructor(options: {
    code: DaykeeperTransportErrorCode;
    message: string;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "DaykeeperTransportError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }

  toJSON(): DaykeeperErrorJson {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
