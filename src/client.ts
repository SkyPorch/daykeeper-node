import { DaykeeperApiError, DaykeeperTransportError } from "./errors.js";
import type {
  ApplyEmailChannelResult,
  ApplyPlanInput,
  ApplyTenantResult,
  CreateFlowInput,
  CreateFlowVersionInput,
  CreateCustomerSessionInput,
  CustomerSession,
  DaykeeperCapabilities,
  EmailChannel,
  EmailChannelPlan,
  EmailChannelSpec,
  Flow,
  FlowVersion,
  FlowWithVersion,
  Operation,
  PublishFlowVersionInput,
  Tenant,
  TenantPlan,
  TenantSpec,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface DaykeeperTokenRequest {
  forceRefresh: boolean;
}

export type DaykeeperTokenProvider = (
  request?: DaykeeperTokenRequest,
) => string | Promise<string>;

export interface DaykeeperClientOptions {
  baseUrl: string;
  token: string | DaykeeperTokenProvider;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface DaykeeperRequestOptions {
  signal?: AbortSignal;
}

export interface DaykeeperApplyOptions extends DaykeeperRequestOptions {
  idempotencyKey: string;
}

export class DaykeeperClient {
  readonly capabilities: () => Promise<DaykeeperCapabilities>;
  readonly tenants: {
    plan: (spec: TenantSpec) => Promise<TenantPlan>;
    apply: (
      input: ApplyPlanInput,
      options: DaykeeperApplyOptions,
    ) => Promise<ApplyTenantResult>;
    list: () => Promise<readonly Tenant[]>;
    get: (tenantId: string) => Promise<Tenant>;
  };
  readonly emailChannels: {
    plan: (
      tenantId: string,
      spec: EmailChannelSpec,
    ) => Promise<EmailChannelPlan>;
    apply: (
      input: ApplyPlanInput,
      options: DaykeeperApplyOptions,
    ) => Promise<ApplyEmailChannelResult>;
    get: (tenantId: string) => Promise<EmailChannel>;
  };
  readonly customerSessions: {
    create: (
      tenantId: string,
      input: CreateCustomerSessionInput,
      options?: DaykeeperRequestOptions,
    ) => Promise<CustomerSession>;
  };
  readonly operations: {
    get: (operationId: string) => Promise<Operation>;
    retry: (operationId: string) => Promise<Operation>;
  };
  readonly flows: {
    create: (
      tenantId: string,
      input: CreateFlowInput,
    ) => Promise<FlowWithVersion>;
    list: (tenantId?: string) => Promise<readonly Flow[]>;
    get: (flowId: string) => Promise<FlowWithVersion>;
    getVersion: (flowId: string, version: number) => Promise<FlowVersion>;
    createVersion: (
      flowId: string,
      input: CreateFlowVersionInput,
    ) => Promise<FlowWithVersion>;
    publishVersion: (
      flowId: string,
      version: number,
      input: PublishFlowVersionInput,
    ) => Promise<FlowWithVersion>;
  };

  readonly #baseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #token: string | DaykeeperTokenProvider;

  constructor(options: DaykeeperClientOptions) {
    this.#baseUrl = parseBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw configurationError("A Fetch API implementation is required");
    }
    this.#timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.#token = options.token;
    if (typeof this.#token !== "string" && typeof this.#token !== "function") {
      throw configurationError("A token or token provider is required");
    }

    this.capabilities = () => this.#request("/v1/capabilities");
    this.tenants = {
      plan: (spec) =>
        this.#request("/v1/tenant-plans", { method: "POST", body: spec }),
      apply: (input, requestOptions) =>
        this.#request("/v1/tenants:apply", {
          method: "POST",
          body: input,
          idempotencyKey: requestOptions.idempotencyKey,
          signal: requestOptions.signal,
        }),
      list: () => this.#request("/v1/tenants"),
      get: (tenantId) => this.#request(`/v1/tenants/${pathSegment(tenantId)}`),
    };
    this.emailChannels = {
      plan: (tenantId, spec) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/email-channel-plans`,
          {
            method: "POST",
            body: spec,
          },
        ),
      apply: (input, requestOptions) =>
        this.#request("/v1/email-channels:apply", {
          method: "POST",
          body: input,
          idempotencyKey: requestOptions.idempotencyKey,
          signal: requestOptions.signal,
        }),
      get: (tenantId) =>
        this.#request(`/v1/tenants/${pathSegment(tenantId)}/email-channel`),
    };
    this.customerSessions = {
      create: (tenantId, input, requestOptions) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/customer-sessions`,
          {
            method: "POST",
            body: input,
            signal: requestOptions?.signal,
          },
        ),
    };
    this.operations = {
      get: (operationId) =>
        this.#request(`/v1/operations/${pathSegment(operationId)}`),
      retry: (operationId) =>
        this.#request(`/v1/operations/${pathSegment(operationId)}/retry`, {
          method: "POST",
        }),
    };
    this.flows = {
      create: (tenantId, input) =>
        this.#request(`/v1/tenants/${pathSegment(tenantId)}/flows`, {
          method: "POST",
          body: input,
        }),
      list: (tenantId) =>
        this.#request(
          tenantId
            ? `/v1/flows?tenantId=${encodeURIComponent(tenantId)}`
            : "/v1/flows",
        ),
      get: (flowId) => this.#request(`/v1/flows/${pathSegment(flowId)}`),
      getVersion: (flowId, version) =>
        this.#request(
          `/v1/flows/${pathSegment(flowId)}/versions/${positiveInteger(version)}`,
        ),
      createVersion: (flowId, input) =>
        this.#request(`/v1/flows/${pathSegment(flowId)}/versions`, {
          method: "POST",
          body: input,
        }),
      publishVersion: (flowId, version, input) =>
        this.#request(
          `/v1/flows/${pathSegment(flowId)}/versions/${positiveInteger(version)}/publish`,
          { method: "POST", body: input },
        ),
    };
  }

  async #request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, this.#timeoutMs);
    const onCallerAbort = () => timeoutController.abort();
    if (options.signal?.aborted) timeoutController.abort();
    else
      options.signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      let response: Response;
      try {
        const send = async (forceRefresh: boolean) => {
          const token = validateHeaderValue(
            await resolveToken(this.#token, forceRefresh),
            "token",
          );
          const headers = new Headers({
            accept: "application/json",
            authorization: `Bearer ${token}`,
          });
          if (options.body !== undefined) {
            headers.set("content-type", "application/json");
          }
          if (options.idempotencyKey !== undefined) {
            headers.set(
              "idempotency-key",
              validateIdempotencyKey(options.idempotencyKey),
            );
          }
          return this.#fetch(new URL(path.replace(/^\/+/, ""), this.#baseUrl), {
            body:
              options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
            headers,
            method: options.method ?? "GET",
            signal: timeoutController.signal,
          });
        };
        response = await send(false);
        if (response.status === 401 && typeof this.#token === "function") {
          await response.body?.cancel().catch(() => undefined);
          response = await send(true);
        }
      } catch (error) {
        if (error instanceof DaykeeperTransportError) throw error;
        if (timedOut) {
          throw new DaykeeperTransportError({
            code: "REQUEST_TIMEOUT",
            message: `The Daykeeper request exceeded ${this.#timeoutMs}ms`,
            retryable: true,
          });
        }
        if (options.signal?.aborted) {
          throw new DaykeeperTransportError({
            code: "REQUEST_ABORTED",
            message: "The Daykeeper request was aborted",
          });
        }
        throw new DaykeeperTransportError({
          code: "NETWORK_ERROR",
          message: "The Daykeeper API could not be reached",
          retryable: true,
        });
      }

      let payload: unknown;
      try {
        payload = await readJson(response);
      } catch (error) {
        if (error instanceof DaykeeperTransportError) throw error;
        if (timedOut) {
          throw new DaykeeperTransportError({
            code: "REQUEST_TIMEOUT",
            message: `The Daykeeper request exceeded ${this.#timeoutMs}ms`,
            retryable: true,
          });
        }
        if (options.signal?.aborted) {
          throw new DaykeeperTransportError({
            code: "REQUEST_ABORTED",
            message: "The Daykeeper request was aborted",
          });
        }
        throw new DaykeeperTransportError({
          code: "NETWORK_ERROR",
          message: "The Daykeeper response could not be read",
          retryable: true,
        });
      }
      if (!response.ok) throw apiError(response, payload);
      if (!isRecord(payload) || !("data" in payload)) {
        throw new DaykeeperTransportError({
          code: "INVALID_RESPONSE",
          message: "The Daykeeper API returned an invalid success envelope",
          retryable: true,
        });
      }
      return payload.data as T;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

async function resolveToken(
  token: string | DaykeeperTokenProvider,
  forceRefresh: boolean,
): Promise<string> {
  return typeof token === "function" ? token({ forceRefresh }) : token;
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError("baseUrl must be a valid absolute URL");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw configurationError(
      "baseUrl must use HTTPS except for loopback development",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configurationError(
      "baseUrl cannot contain credentials, a query, or a fragment",
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function validateTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw configurationError(
      "timeoutMs must be an integer from 1000 through 60000",
    );
  }
  return value;
}

function pathSegment(value: string): string {
  if (!value.trim())
    throw configurationError("Resource identifiers cannot be empty");
  return encodeURIComponent(value);
}

function positiveInteger(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw configurationError("Version must be a positive integer");
  }
  return value;
}

function validateHeaderValue(
  value: string,
  label: string,
  maxLength = 16_384,
): string {
  if (!value || value.length > maxLength || /[\r\n]/.test(value)) {
    throw configurationError(`The ${label} is invalid`);
  }
  return value;
}

function validateIdempotencyKey(value: string): string {
  if (
    value.length >= 16 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    return value;
  }
  throw configurationError(
    "The idempotency key must be 16 to 128 URL-safe characters",
  );
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw responseTooLarge();
  }
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw responseTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DaykeeperTransportError({
      code: "INVALID_RESPONSE",
      message: "The Daykeeper API returned invalid JSON",
      retryable: true,
    });
  }
}

function apiError(response: Response, payload: unknown): DaykeeperApiError {
  const body =
    isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  return new DaykeeperApiError({
    status: response.status,
    code: stringValue(body.code) ?? `HTTP_${response.status}`,
    message:
      stringValue(body.message) ?? "The Daykeeper API rejected the request",
    retryable:
      typeof body.retryable === "boolean"
        ? body.retryable
        : response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
    nextActions: stringArray(body.nextActions),
    correlationId:
      stringValue(body.correlationId) ??
      response.headers.get("x-request-id") ??
      undefined,
    fields: stringArray(body.fields),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function responseTooLarge(): DaykeeperTransportError {
  return new DaykeeperTransportError({
    code: "RESPONSE_TOO_LARGE",
    message: "The Daykeeper API response exceeded 1 MiB",
  });
}

function configurationError(message: string): DaykeeperTransportError {
  return new DaykeeperTransportError({
    code: "INVALID_CONFIGURATION",
    message,
  });
}
