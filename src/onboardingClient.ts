import {
  DaykeeperApiError,
  DaykeeperTransportError,
  type DaykeeperErrorJson,
} from "./errors.js";
import {
  parseBaseUrl,
  readJson,
  validateTimeout,
  type DaykeeperRequestOptions,
} from "./client.js";
import { createRequestLifetime, discardResponse } from "./requestLifetime.js";
import type {
  MachineEnrollmentInput,
  MachineChallenge,
  MachineProofInput,
  MachineEnrollmentResult,
  MachineRotationInput,
  MachineRotationResult,
  MachineCredentialMetadata,
} from "./types.js";

export interface DaykeeperOnboardingClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export class DaykeeperOnboardingApiError extends DaykeeperApiError {
  override readonly outcomeUnknown: boolean;
  readonly retryAfterSeconds?: number;
  constructor(
    status: number,
    code: string,
    unknownOutcome: boolean,
    retryAfterSeconds?: number,
  ) {
    super({
      status,
      code,
      message: "The Daykeeper onboarding request was rejected",
      retryable: !unknownOutcome && (status === 429 || status >= 500),
    });
    this.outcomeUnknown = unknownOutcome;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  override toJSON(): DaykeeperErrorJson & { retryAfterSeconds?: number } {
    return {
      ...super.toJSON(),
      ...(this.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: this.retryAfterSeconds }),
    };
  }
}

/** No management credential or automatic retry. Persist key and intent before
 * issuing mutations; an uncertain result must be recovered explicitly. */
export class DaykeeperOnboardingClient {
  readonly #base: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeout: number;
  readonly enrollments = {
    challenge: (
      input: MachineEnrollmentInput,
      options?: DaykeeperRequestOptions,
    ) =>
      this.#request<MachineChallenge>(
        "/v1/machine-enrollments/challenges",
        enrollmentInput(input),
        "challenge",
        options,
      ),
    create: (input: MachineProofInput, options?: DaykeeperRequestOptions) =>
      this.#request<MachineEnrollmentResult>(
        "/v1/machine-enrollments",
        proofInput(input),
        "enrollment",
        options,
      ),
  };
  readonly credentialRotations = {
    challenge: (
      input: MachineRotationInput,
      options?: DaykeeperRequestOptions,
    ) =>
      this.#request<MachineChallenge>(
        "/v1/machine-credential-rotations/challenges",
        rotationInput(input),
        "challenge",
        options,
      ),
    create: (input: MachineProofInput, options?: DaykeeperRequestOptions) =>
      this.#request<MachineRotationResult>(
        "/v1/machine-credential-rotations",
        proofInput(input),
        "rotation",
        options,
      ),
    current: (input: MachineProofInput, options?: DaykeeperRequestOptions) =>
      this.#request<MachineCredentialMetadata>(
        "/v1/machine-credential-rotations/current",
        proofInput(input),
        "metadata",
        options,
      ),
  };
  constructor(options: DaykeeperOnboardingClientOptions) {
    if (
      !record(options) ||
      Object.keys(options).some(
        (key) => !["baseUrl", "fetch", "timeoutMs"].includes(key),
      ) ||
      typeof options.baseUrl !== "string" ||
      /[?#]/.test(options.baseUrl)
    )
      throw invalidConfiguration();
    this.#base = parseBaseUrl(options.baseUrl);
    this.#timeout = validateTimeout(options.timeoutMs ?? 30_000);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") throw invalidConfiguration();
  }
  async #request<T>(
    path: string,
    input: unknown,
    kind: "challenge" | "enrollment" | "rotation" | "metadata",
    options?: DaykeeperRequestOptions,
  ): Promise<T> {
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).byteLength > 8192)
      throw invalidConfiguration();
    const lifetime = createRequestLifetime(this.#timeout, options?.signal);
    let dispatched = false;
    let response: Response | undefined;
    const mutation = kind !== "metadata";
    try {
      response = await lifetime.run(() => {
        dispatched = true;
        return this.#fetch(new URL(path.slice(1), this.#base), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body,
          signal: lifetime.signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
      }, discardResponse);
      let payload: unknown;
      try {
        payload = await readJson(response, lifetime);
      } catch (error) {
        if (
          response.ok ||
          (error instanceof DaykeeperTransportError &&
            ["REQUEST_TIMEOUT", "REQUEST_ABORTED"].includes(error.code))
        )
          throw error;
      }
      if (!response.ok) {
        const candidate =
          record(payload) && record(payload.error)
            ? payload.error.code
            : undefined;
        const code =
          typeof candidate === "string" && errorCodes.has(candidate)
            ? candidate
            : `HTTP_${response.status}`;
        const raw = response.headers.get("retry-after");
        const retry =
          raw !== null && /^\d{1,5}$/.test(raw) ? Number(raw) : undefined;
        throw new DaykeeperOnboardingApiError(
          response.status,
          code,
          mutation && (response.status >= 500 || response.status < 400),
          retry,
        );
      }
      if (!validResult(kind, payload))
        throw new DaykeeperTransportError({
          code: "INVALID_RESPONSE",
          message: "The Daykeeper onboarding response is invalid",
        });
      if (
        !validStatus(kind, response.status, payload as Record<string, unknown>)
      )
        throw new DaykeeperTransportError({
          code: "INVALID_RESPONSE",
          message: "The Daykeeper onboarding response status is invalid",
        });
      return payload as T;
    } catch (error) {
      if (error instanceof DaykeeperOnboardingApiError) throw error;
      throw new DaykeeperTransportError({
        code:
          error instanceof DaykeeperTransportError
            ? error.code
            : "NETWORK_ERROR",
        message: "The Daykeeper onboarding request could not be completed",
        outcomeUnknown: dispatched && mutation,
        retryable:
          !mutation &&
          !(
            error instanceof DaykeeperTransportError &&
            error.code === "REQUEST_ABORTED"
          ),
      });
    } finally {
      if (response) discardResponse(response);
      lifetime.dispose();
    }
  }
}
const errorCodes = new Set([
  "INVALID_INPUT",
  "AUTHENTICATION_REQUIRED",
  "BOOTSTRAP_UNAVAILABLE",
  "BOOTSTRAP_LIMIT_REACHED",
  "IDEMPOTENCY_KEY_REUSED",
  "FREE_WORKSPACE_ALREADY_CLAIMED",
  "IDENTITY_INACTIVE",
  "RESOURCE_VERSION_CONFLICT",
  "RATE_LIMITED",
  "RESOURCE_NOT_FOUND",
]);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const string = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function proofInput(input: unknown) {
  if (
    !exact(input, ["challengeId", "proof"]) ||
    !uuid(input.challengeId) ||
    !string(input.proof, 4096)
  )
    throw invalidConfiguration();
  return { challengeId: input.challengeId, proof: input.proof };
}
function enrollmentInput(input: unknown) {
  if (
    !exact(input, ["name", "idempotencyKey", "publicKey"]) ||
    !string(input.name, 120) ||
    input.name.trim().length < 2 ||
    typeof input.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey) ||
    !exact(input.publicKey, ["kty", "crv", "x", "y"]) ||
    input.publicKey.kty !== "EC" ||
    input.publicKey.crv !== "P-256" ||
    ![input.publicKey.x, input.publicKey.y].every((value) => canonical32(value))
  )
    throw invalidConfiguration();
  return {
    name: input.name,
    idempotencyKey: input.idempotencyKey,
    publicKey: { ...input.publicKey },
  };
}
function rotationInput(input: unknown) {
  if (
    !exact(input, ["ownerId", "expectedCredentialId", "intentId"]) ||
    ![input.ownerId, input.expectedCredentialId, input.intentId].every(uuid)
  )
    throw invalidConfiguration();
  return { ...input };
}
const date = (value: unknown) =>
  typeof value === "string" &&
  value.length <= 64 &&
  /(Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));
function canonicalAudience(value: unknown): value is string {
  if (typeof value !== "string" || /[?#]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.href === value
    );
  } catch {
    return false;
  }
}
function canonical32(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
    return false;
  const bytes = Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  return (
    bytes.length === 32 &&
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "") === value
  );
}
function metadata(value: Record<string, unknown>, idField = "credentialId") {
  return (
    uuid(value.ownerId) &&
    uuid(value.organizationId) &&
    uuid(value[idField]) &&
    date(value.expiresAt) &&
    (value.revokedAt === null || date(value.revokedAt))
  );
}
function token(value: unknown, id: unknown) {
  return (
    typeof value === "string" &&
    typeof id === "string" &&
    new RegExp(
      `^dk_machine_${id.replaceAll("-", "").toLowerCase()}_[A-Za-z0-9_-]{43}$`,
    ).test(value)
  );
}
function validResult(kind: string, value: unknown): boolean {
  if (!record(value)) return false;
  if (kind === "challenge")
    return (
      exact(value, [
        "challengeId",
        "audience",
        "nonce",
        "keyThumbprint",
        "requestHash",
        "createdAt",
        "expiresAt",
      ]) &&
      uuid(value.challengeId) &&
      canonicalAudience(value.audience) &&
      [value.nonce, value.keyThumbprint].every(
        (item) => typeof item === "string" && /^[A-Za-z0-9_-]{43}$/.test(item),
      ) &&
      typeof value.requestHash === "string" &&
      /^[0-9a-f]{64}$/.test(value.requestHash) &&
      Number.isSafeInteger(value.createdAt) &&
      Number.isSafeInteger(value.expiresAt) &&
      (value.createdAt as number) >= 0 &&
      (value.expiresAt as number) > (value.createdAt as number) &&
      (value.expiresAt as number) - (value.createdAt as number) <= 300
    );
  if (kind === "metadata")
    return (
      exact(value, [
        "ownerId",
        "organizationId",
        "credentialId",
        "expiresAt",
        "revokedAt",
      ]) && metadata(value)
    );
  if (kind === "rotation")
    return (
      exact(value, [
        "ownerId",
        "organizationId",
        "credentialId",
        "predecessorId",
        "intentId",
        "expiresAt",
        "revokedAt",
        "replayed",
        "token",
      ]) &&
      metadata(value) &&
      uuid(value.predecessorId) &&
      uuid(value.intentId) &&
      typeof value.replayed === "boolean" &&
      (value.replayed
        ? value.token === null
        : token(value.token, value.credentialId) && value.revokedAt === null)
    );
  return (
    exact(value, [
      "ownerId",
      "organizationId",
      "organizationSlug",
      "replayed",
      "credential",
      "credentialIssued",
      "token",
    ]) &&
    uuid(value.ownerId) &&
    uuid(value.organizationId) &&
    string(value.organizationSlug, 128) &&
    typeof value.replayed === "boolean" &&
    typeof value.credentialIssued === "boolean" &&
    exact(value.credential, [
      "id",
      "expiresAt",
      "revokedAt",
      "policyVersion",
    ]) &&
    uuid(value.credential.id) &&
    date(value.credential.expiresAt) &&
    (value.credential.revokedAt === null || date(value.credential.revokedAt)) &&
    value.credential.policyVersion === "machine-onboarding-v1" &&
    (value.credentialIssued
      ? token(value.token, value.credential.id) &&
        value.credential.revokedAt === null
      : value.token === null)
  );
}
function validStatus(
  kind: string,
  status: number,
  value: Record<string, unknown>,
) {
  if (kind === "challenge") return status === 201;
  if (kind === "metadata") return status === 200;
  if (kind === "rotation") return status === (value.replayed ? 200 : 201);
  return status === (value.credentialIssued ? 201 : 200);
}
function invalidConfiguration() {
  return new DaykeeperTransportError({
    code: "INVALID_CONFIGURATION",
    message: "The Daykeeper onboarding configuration or request is invalid",
  });
}
