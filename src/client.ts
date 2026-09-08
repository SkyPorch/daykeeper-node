import { DaykeeperApiError, DaykeeperTransportError } from "./errors.js";
import {
  createRequestLifetime,
  discardResponse,
  discardReader,
} from "./requestLifetime.js";
import type {
  ApplyEmailChannelResult,
  ApplyPlanInput,
  ApplyTenantResult,
  AgentCredentialPage,
  CreateAgentCredentialInput,
  CreateAgentCredentialResult,
  CreateFlowInput,
  CreateFlowVersionInput,
  CreateCustomerSessionInput,
  CustomerSession,
  DaykeeperCapabilities,
  EntitlementStatus,
  UsageStatus,
  WebsiteChannel,
  InboxChannel,
  EmailChannel,
  EmailChannelPlan,
  EmailChannelSpec,
  Flow,
  FlowMutationResult,
  FlowVersion,
  FlowWithVersion,
  Operation,
  PublishFlowVersionInput,
  RevokeAgentCredentialResult,
  Tenant,
  TenantPlan,
  TenantSpec,
  DomainVerification,
  DomainVerificationInput,
  ApiInboxActivationReceipt,
  OperatorConversationList,
  OperatorConversationMessages,
  OperatorConversationReply,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

// The SDK calls a fixed contract surface. There is no caller-supplied path or
// passthrough method, and every request is checked against this list before it
// is resolved against the configured base URL.
const SEGMENT = "[^/?#]+";
const ALLOWED_PATHS: readonly RegExp[] = [
  "/v1/capabilities",
  "/v1/entitlements",
  "/v1/usage",
  "/v1/agent-credentials",
  `/v1/agent-credentials/${SEGMENT}/revoke`,
  "/v1/tenant-plans",
  "/v1/tenants",
  "/v1/tenants:apply",
  `/v1/tenants/${SEGMENT}`,
  `/v1/tenants/${SEGMENT}/website-channel`,
  `/v1/tenants/${SEGMENT}/inbox`,
  `/v1/tenants/${SEGMENT}/provisioning-operation`,
  `/v1/tenants/${SEGMENT}/email-channel-plans`,
  `/v1/tenants/${SEGMENT}/email-channel`,
  `/v1/tenants/${SEGMENT}/customer-sessions`,
  `/v1/tenants/${SEGMENT}/domain-verifications`,
  `/v1/tenants/${SEGMENT}/domain-verifications/${SEGMENT}`,
  `/v1/tenants/${SEGMENT}/domain-verifications/${SEGMENT}/verify`,
  `/v1/tenants/${SEGMENT}/domain-verifications/${SEGMENT}/revoke`,
  `/v1/tenants/${SEGMENT}/inbox-activations`,
  `/v1/tenants/${SEGMENT}/inbox-activations/${SEGMENT}`,
  `/v1/tenants/${SEGMENT}/inbox-activations/${SEGMENT}/revoke`,
  `/v1/tenants/${SEGMENT}/conversations`,
  `/v1/tenants/${SEGMENT}/conversations/[1-9][0-9]*/messages`,
  `/v1/tenants/${SEGMENT}/flows`,
  "/v1/email-channels:apply",
  `/v1/operations/${SEGMENT}`,
  `/v1/operations/${SEGMENT}/retry`,
  "/v1/flows",
  `/v1/flows/${SEGMENT}`,
  `/v1/flows/${SEGMENT}/versions`,
  `/v1/flows/${SEGMENT}/versions/[0-9]+`,
  `/v1/flows/${SEGMENT}/versions/[0-9]+/publish`,
].map((pattern) => new RegExp(`^${pattern}$`));

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

// Bounds for values projected out of a rejection the SDK did not author.
const MAX_CODE_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 1024;
const MAX_CORRELATION_ID_LENGTH = 128;
// A correlation identifier is an opaque token, never free text or a URL.
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Create a key for one logical mutation. Reuse the returned value when you
 * repeat a call whose outcome you do not know; never call this inside a retry.
 */
export function generateIdempotencyKey(): string {
  const random = globalThis.crypto;
  if (typeof random?.randomUUID !== "function") {
    throw configurationError(
      "A Web Crypto implementation with randomUUID is required",
    );
  }
  return validateIdempotencyKey(random.randomUUID());
}

export interface DaykeeperTokenRequest {
  forceRefresh: boolean;
  /** Cancel credential exchange when the request is aborted or expires. */
  signal?: AbortSignal;
}

export type DaykeeperTokenProvider = (
  request?: DaykeeperTokenRequest,
) => string | Promise<string>;

interface DaykeeperClientBaseOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export type DaykeeperClientOptions = DaykeeperClientBaseOptions &
  (
    | {
        /** Static server-side credential, including a reveal-once agent API key. */
        apiKey: string;
        token?: never;
      }
    | {
        /** OAuth access token or rotating token provider. */
        token: string | DaykeeperTokenProvider;
        apiKey?: never;
      }
  );

export interface DaykeeperRequestOptions {
  signal?: AbortSignal;
}

export interface DaykeeperApplyOptions extends DaykeeperRequestOptions {
  idempotencyKey: string;
}

export type DaykeeperIdempotencyOptions = DaykeeperApplyOptions;

export class DaykeeperClient {
  readonly capabilities: () => Promise<DaykeeperCapabilities>;
  readonly entitlements: {
    get: (options?: DaykeeperRequestOptions) => Promise<EntitlementStatus>;
  };
  readonly usage: {
    get: (options?: DaykeeperRequestOptions) => Promise<UsageStatus>;
  };
  readonly agentCredentials: {
    list: (options?: DaykeeperRequestOptions) => Promise<AgentCredentialPage>;
    create: (
      input: CreateAgentCredentialInput,
      options: DaykeeperIdempotencyOptions,
    ) => Promise<CreateAgentCredentialResult>;
    revoke: (
      credentialId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<RevokeAgentCredentialResult>;
  };
  readonly websiteChannels: {
    get: (
      tenantId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<WebsiteChannel>;
  };
  readonly inboxes: {
    get: (
      tenantId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<InboxChannel>;
  };
  readonly tenants: {
    plan: (spec: TenantSpec) => Promise<TenantPlan>;
    apply: (
      input: ApplyPlanInput,
      options: DaykeeperApplyOptions,
    ) => Promise<ApplyTenantResult>;
    list: () => Promise<readonly Tenant[]>;
    get: (tenantId: string) => Promise<Tenant>;
    getProvisioningOperation: (
      tenantId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<Operation>;
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
  readonly domainVerifications: {
    create: (
      tenantId: string,
      input: DomainVerificationInput,
      options: DaykeeperIdempotencyOptions,
    ) => Promise<DomainVerification>;
    get: (
      tenantId: string,
      verificationId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<DomainVerification>;
    verify: (
      tenantId: string,
      verificationId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<DomainVerification>;
    revoke: (
      tenantId: string,
      verificationId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<DomainVerification>;
  };
  readonly inboxActivations: {
    create: (
      tenantId: string,
      options: DaykeeperIdempotencyOptions,
    ) => Promise<ApiInboxActivationReceipt>;
    get: (
      tenantId: string,
      intent: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<ApiInboxActivationReceipt>;
    revoke: (
      tenantId: string,
      intent: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<ApiInboxActivationReceipt>;
  };
  readonly operatorConversations: {
    list: (
      tenantId: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<OperatorConversationList>;
    messages: (
      tenantId: string,
      conversationId: number,
      options?: DaykeeperRequestOptions,
    ) => Promise<OperatorConversationMessages>;
    reply: (
      tenantId: string,
      conversationId: number,
      content: string,
      options?: DaykeeperRequestOptions,
    ) => Promise<OperatorConversationReply>;
  };
  readonly operations: {
    get: (operationId: string) => Promise<Operation>;
    retry: (operationId: string) => Promise<Operation>;
  };
  readonly flows: {
    create: (
      tenantId: string,
      input: CreateFlowInput,
      options: DaykeeperIdempotencyOptions,
    ) => Promise<FlowMutationResult>;
    list: (tenantId?: string) => Promise<readonly Flow[]>;
    get: (flowId: string) => Promise<FlowWithVersion>;
    getVersion: (flowId: string, version: number) => Promise<FlowVersion>;
    createVersion: (
      flowId: string,
      input: CreateFlowVersionInput,
      options: DaykeeperIdempotencyOptions,
    ) => Promise<FlowMutationResult>;
    publishVersion: (
      flowId: string,
      version: number,
      input: PublishFlowVersionInput,
      options: DaykeeperIdempotencyOptions,
    ) => Promise<FlowMutationResult>;
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
    const hasApiKey =
      "apiKey" in options && typeof options.apiKey !== "undefined";
    const hasToken = "token" in options && typeof options.token !== "undefined";
    if (hasApiKey === hasToken) {
      throw configurationError("Provide exactly one apiKey or token");
    }
    this.#token = hasApiKey ? options.apiKey : options.token;
    if (typeof this.#token !== "string" && typeof this.#token !== "function") {
      throw configurationError(
        "A valid apiKey, token, or token provider is required",
      );
    }

    this.capabilities = () => this.#request("/v1/capabilities");
    this.entitlements = {
      get: (requestOptions = {}) =>
        this.#request("/v1/entitlements", { signal: requestOptions.signal }),
    };
    this.usage = {
      get: (requestOptions = {}) =>
        this.#request("/v1/usage", { signal: requestOptions.signal }),
    };
    this.agentCredentials = {
      list: (requestOptions = {}) =>
        this.#request("/v1/agent-credentials", {
          signal: requestOptions.signal,
        }),
      create: (input, requestOptions) =>
        this.#request("/v1/agent-credentials", {
          method: "POST",
          body: input,
          idempotencyKey: requestOptions.idempotencyKey,
          signal: requestOptions.signal,
        }),
      revoke: (credentialId, requestOptions = {}) =>
        this.#request(
          `/v1/agent-credentials/${pathSegment(credentialId)}/revoke`,
          {
            method: "POST",
            body: {},
            signal: requestOptions.signal,
          },
        ),
    };
    this.websiteChannels = {
      get: (tenantId, requestOptions = {}) =>
        this.#request(`/v1/tenants/${pathSegment(tenantId)}/website-channel`, {
          signal: requestOptions.signal,
        }),
    };
    this.inboxes = {
      get: (tenantId, requestOptions = {}) =>
        this.#request(`/v1/tenants/${pathSegment(tenantId)}/inbox`, {
          signal: requestOptions.signal,
        }),
    };
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
      getProvisioningOperation: (tenantId, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/provisioning-operation`,
          {
            signal: requestOptions.signal,
          },
        ),
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
    this.domainVerifications = {
      create: (tenantId, input, requestOptions) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/domain-verifications`,
          {
            method: "POST",
            body: validateDomainVerificationInput(input),
            idempotencyKey: requestOptions?.idempotencyKey,
            requireIdempotencyKey: true,
            signal: requestOptions?.signal,
          },
        ),
      get: (tenantId, verificationId, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/domain-verifications/${pathSegment(verificationId)}`,
          { signal: requestOptions.signal },
        ),
      verify: (tenantId, verificationId, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/domain-verifications/${pathSegment(verificationId)}/verify`,
          { method: "POST", body: {}, signal: requestOptions.signal },
        ),
      revoke: (tenantId, verificationId, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/domain-verifications/${pathSegment(verificationId)}/revoke`,
          { method: "POST", body: {}, signal: requestOptions.signal },
        ),
    };
    this.inboxActivations = {
      create: (tenantId, requestOptions) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/inbox-activations`,
          {
            method: "POST",
            body: {},
            idempotencyKey: requestOptions.idempotencyKey,
            requireIdempotencyKey: true,
            signal: requestOptions.signal,
          },
        ),
      get: (tenantId, activationIntent, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/inbox-activations/${pathSegment(validateActivationIntent(activationIntent))}`,
          { signal: requestOptions.signal },
        ),
      revoke: (tenantId, activationIntent, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/inbox-activations/${pathSegment(validateActivationIntent(activationIntent))}/revoke`,
          { method: "POST", body: {}, signal: requestOptions.signal },
        ),
    };
    this.operatorConversations = {
      list: (tenantId, requestOptions = {}) =>
        this.#request(`/v1/tenants/${pathSegment(tenantId)}/conversations`, {
          signal: requestOptions.signal,
        }),
      messages: async (tenantId, conversationId, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/conversations/${positiveSafeInteger(conversationId)}/messages`,
          { signal: requestOptions.signal },
        ),
      reply: async (tenantId, conversationId, content, requestOptions = {}) =>
        this.#request(
          `/v1/tenants/${pathSegment(tenantId)}/conversations/${positiveSafeInteger(conversationId)}/messages`,
          {
            method: "POST",
            body: { content: validateOperatorContent(content) },
            signal: requestOptions.signal,
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
      create: (tenantId, input, requestOptions) =>
        this.#request(`/v1/tenants/${pathSegment(tenantId)}/flows`, {
          method: "POST",
          body: input,
          idempotencyKey: requestOptions?.idempotencyKey,
          requireIdempotencyKey: true,
          signal: requestOptions?.signal,
        }),
      list: (tenantId) =>
        this.#request("/v1/flows", {
          query: tenantId === undefined ? undefined : { tenantId },
        }),
      get: (flowId) => this.#request(`/v1/flows/${pathSegment(flowId)}`),
      getVersion: (flowId, version) =>
        this.#request(
          `/v1/flows/${pathSegment(flowId)}/versions/${positiveInteger(version)}`,
        ),
      createVersion: (flowId, input, requestOptions) =>
        this.#request(`/v1/flows/${pathSegment(flowId)}/versions`, {
          method: "POST",
          body: input,
          idempotencyKey: requestOptions?.idempotencyKey,
          requireIdempotencyKey: true,
          signal: requestOptions?.signal,
        }),
      publishVersion: (flowId, version, input, requestOptions) =>
        this.#request(
          `/v1/flows/${pathSegment(flowId)}/versions/${positiveInteger(version)}/publish`,
          {
            method: "POST",
            body: input,
            idempotencyKey: requestOptions?.idempotencyKey,
            requireIdempotencyKey: true,
            signal: requestOptions?.signal,
          },
        ),
    };
  }

  async #request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
      requireIdempotencyKey?: boolean;
      query?: Readonly<Record<string, string>>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    if (options.requireIdempotencyKey && options.idempotencyKey === undefined) {
      throw configurationError(
        "This mutation requires an idempotencyKey; create one with generateIdempotencyKey() and reuse it to recover",
      );
    }
    const url = this.#resolveUrl(path, options.query);
    const lifetime = createRequestLifetime(this.#timeoutMs, options.signal);
    let response: Response | undefined;
    // True once a request has left the SDK. From that moment a mutation may
    // already have been applied, so a later failure has an unknown outcome.
    let dispatched = false;
    const mutates = method !== "GET";

    try {
      try {
        const send = async (forceRefresh: boolean) => {
          const token = validateHeaderValue(
            await lifetime.run(() =>
              resolveToken(this.#token, forceRefresh, lifetime.signal),
            ),
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
          return lifetime.run(() => {
            dispatched = true;
            return this.#fetch(url, {
              body:
                options.body === undefined
                  ? undefined
                  : JSON.stringify(options.body),
              headers,
              method,
              redirect: "error",
              credentials: "omit",
              signal: lifetime.signal,
            });
          }, discardResponse);
        };
        response = await send(false);
        // Replaying a write can duplicate it. Only a read, or a write the
        // server can recognize as a replay, may be sent a second time.
        const mayReplay = !mutates || options.idempotencyKey !== undefined;
        if (
          response.status === 401 &&
          typeof this.#token === "function" &&
          mayReplay
        ) {
          discardResponse(response);
          response = await send(true);
        }
      } catch (error) {
        throw this.#failure(error, {
          code: "NETWORK_ERROR",
          message: "The Daykeeper API could not be reached",
          outcomeUnknown: mutates && dispatched,
        });
      }

      let payload: unknown;
      let payloadFailure: DaykeeperTransportError | undefined;
      try {
        payload = await readJson(response, lifetime);
      } catch (error) {
        // The response status already settled the outcome, even for a mutation:
        // a 2xx applied the change and a 4xx did not. Only the result body is
        // missing, so this is not an unknown outcome.
        payloadFailure = this.#failure(error, {
          code: "NETWORK_ERROR",
          message: "The Daykeeper response could not be read",
          outcomeUnknown: false,
        });
        // A cancelled or expired read says nothing about the response status.
        if (
          payloadFailure.code === "REQUEST_TIMEOUT" ||
          payloadFailure.code === "REQUEST_ABORTED"
        ) {
          throw payloadFailure;
        }
      }
      // Check the status before the body. A proxy or load balancer can reject a
      // request with a non-JSON page, which is a status error, not a contract
      // violation by the Daykeeper API.
      if (!response.ok) {
        throw apiError(response, payloadFailure ? undefined : payload);
      }
      if (payloadFailure) throw payloadFailure;
      if (!isRecord(payload) || !("data" in payload)) {
        throw new DaykeeperTransportError({
          code: "INVALID_RESPONSE",
          message: "The Daykeeper API returned an invalid success envelope",
          retryable: true,
        });
      }
      return payload.data as T;
    } finally {
      if (response) discardResponse(response);
      lifetime.dispose();
    }
  }

  /**
   * Project any thrown value as a transport error. A dispatched mutation keeps
   * its original code but is reported as an unknown outcome and never as
   * automatically retryable.
   */
  #failure(
    error: unknown,
    fallback: {
      code: "NETWORK_ERROR";
      message: string;
      outcomeUnknown: boolean;
    },
  ): DaykeeperTransportError {
    if (error instanceof DaykeeperTransportError) {
      if (!fallback.outcomeUnknown || error.outcomeUnknown) return error;
      return new DaykeeperTransportError({
        code: error.code,
        message: error.message,
        outcomeUnknown: true,
        correlationId: error.correlationId,
      });
    }
    return new DaykeeperTransportError({
      code: fallback.code,
      message: fallback.message,
      retryable: !fallback.outcomeUnknown,
      outcomeUnknown: fallback.outcomeUnknown,
    });
  }

  #resolveUrl(path: string, query?: Readonly<Record<string, string>>): URL {
    if (!ALLOWED_PATHS.some((allowed) => allowed.test(path))) {
      throw configurationError("The requested Daykeeper endpoint is not known");
    }
    const url = new URL(path.replace(/^\/+/, ""), this.#baseUrl);
    for (const [name, value] of Object.entries(query ?? {})) {
      url.searchParams.set(name, value);
    }
    // Defence in depth: resolution must never escape the configured base.
    if (!url.href.startsWith(this.#baseUrl.href)) {
      throw configurationError("The requested Daykeeper endpoint is not known");
    }
    return url;
  }
}

async function resolveToken(
  token: string | DaykeeperTokenProvider,
  forceRefresh: boolean,
  signal: AbortSignal,
): Promise<string> {
  try {
    return await (typeof token === "function"
      ? token({ forceRefresh, signal })
      : token);
  } catch {
    throw new DaykeeperTransportError({
      code: "TOKEN_PROVIDER_ERROR",
      message: "The Daykeeper access token could not be obtained",
    });
  }
}

export function parseBaseUrl(value: string): URL {
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
  // A fixed reverse-proxy prefix is allowed. URL parsing already resolves dot
  // segments, but an encoded separator survives it and could hide a second
  // path level from the base, so reject it here.
  if (/%2f|%5c/i.test(url.pathname)) {
    throw configurationError("baseUrl cannot contain encoded path separators");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

export function validateTimeout(value: number): number {
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
  if (value === "." || value === "..") {
    throw configurationError("Resource identifiers cannot traverse the path");
  }
  return encodeURIComponent(value);
}

function positiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw configurationError(
      "Conversation identifiers must be positive safe integers",
    );
  return value;
}

function validateOperatorContent(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_000)
    throw configurationError(
      "Operator replies must contain 1 through 4000 characters",
    );
  return value.trim();
}

function validateActivationIntent(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(value))
    throw configurationError("The activation intent is invalid");
  return value;
}

function positiveInteger(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw configurationError("Version must be a positive integer");
  }
  return value;
}

function validateDomainVerificationInput(
  value: DomainVerificationInput,
): DomainVerificationInput {
  if (
    !value ||
    Object.keys(value).sort().join(",") !== "origin" ||
    typeof value.origin !== "string" ||
    value.origin.length < 1 ||
    value.origin.length > 253
  )
    throw configurationError("A valid domain verification origin is required");
  let url: URL;
  try {
    url = new URL(value.origin);
  } catch {
    throw configurationError("A valid domain verification origin is required");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    isIpLiteral(url.hostname)
  )
    throw configurationError("A valid domain verification origin is required");
  return { origin: value.origin };
}

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(":") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function validateHeaderValue(
  value: string,
  label: string,
  maxLength = 16_384,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maxLength ||
    /[\r\n]/.test(value)
  ) {
    throw configurationError(`The ${label} is invalid`);
  }
  return value;
}

function validateIdempotencyKey(value: string): string {
  if (typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value)) {
    return value;
  }
  throw configurationError(
    "The idempotency key must be 16 to 128 URL-safe characters",
  );
}

export async function readJson(
  response: Response,
  lifetime: ReturnType<typeof createRequestLifetime>,
): Promise<unknown> {
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
      const { done, value } = await lifetime.run(() => reader.read());
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw responseTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    discardReader(reader);
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
    code:
      boundedString(body.code, MAX_CODE_LENGTH) ?? `HTTP_${response.status}`,
    message:
      boundedString(body.message, MAX_MESSAGE_LENGTH) ??
      "The Daykeeper API rejected the request",
    retryable:
      typeof body.retryable === "boolean"
        ? body.retryable
        : response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
    nextActions: stringArray(body.nextActions),
    correlationId:
      boundedString(body.correlationId, MAX_CORRELATION_ID_LENGTH) ??
      safeCorrelationId(response.headers.get("x-request-id")),
    fields: stringArray(body.fields),
    outcomeUnknown: body.outcomeUnknown === true,
  });
}

// A rejection can come from a proxy, not from Daykeeper. Bound what is copied
// out of it so an oversized or shapeless value cannot ride along in a log line
// or an error report.
function boundedString(value: unknown, maxLength: number): string | undefined {
  const text = stringValue(value);
  if (text === undefined || !text || text.length > maxLength) return undefined;
  return text;
}

function safeCorrelationId(value: string | null): string | undefined {
  if (value === null) return undefined;
  return CORRELATION_ID_PATTERN.test(value) ? value : undefined;
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
