# Changelog

## 0.3.0 (unreleased)

- Add the `workspaceClaims` namespace, so an agent that created a workspace can
  hand it to a person as owner: `workspaceClaims.create({ email }, { idempotencyKey })`,
  `workspaceClaims.list()` and `workspaceClaims.revoke(claimId)`. All three
  require a `dk_machine_` machine-owner bearer; a human bearer or a delegated
  agent credential is rejected by the server with `SCOPE_NOT_HELD` (403), which
  the SDK surfaces unchanged.
- `workspaceClaims.create` requires an explicit `idempotencyKey`, exactly like
  `agentCredentials.create`. A fresh result carries `token` and `claimUrl` and
  `replayed: false`; a replay of the exact same request under the same key
  carries `token: null`, `claimUrl: null` and `replayed: true`. The claim URL is
  a one-time secret that carries its token in the URL fragment: deliver it out
  of band, and never log or persist it. Daykeeper sends no email.
- The SDK rejects a malformed claim address locally before an idempotency key is
  bound or an hourly claim window is consumed. It mirrors the contract pattern:
  lowercase, at most 254 Unicode code points, dot-separated local atoms with no
  leading, trailing, or doubled dot, and a domain of hyphen-safe labels with at
  least one dot. The limit is counted in code points, the unit JSON Schema's
  `maxLength` uses, rather than UTF-16 code units. A create whose response is lost is reported as
  `outcomeUnknown` and is never retried automatically; repeat it with the same
  key, or inspect `workspaceClaims.list()` first.
- `WorkspaceClaimResult` is a union of the new `WorkspaceClaimCreated` and
  `WorkspaceClaimReplayed` types, discriminated by `replayed`, because the
  contract now gives `201` and `200` separate schemas. `create()` still returns
  the single `WorkspaceClaimResult` type; narrowing on `replayed` is what turns
  `token` and `claimUrl` from `string | null` into `string`.
- Add the `WorkspaceClaim`, `WorkspaceClaimState`, `CreateWorkspaceClaimInput`,
  `WorkspaceClaimResult`, `WorkspaceClaimCreated`, `WorkspaceClaimReplayed` and
  `WorkspaceClaimList` types, and the optional
  `capabilities().workspaceClaims` boolean. It is `false` when the server has no
  console origin configured, in which case the routes answer
  `FEATURE_UNAVAILABLE` (503); it is absent on servers that predate claims.
- A `WorkspaceClaim` now carries `acceptedAt` and `revokedAt`, both
  `string | null` and both always present. The server has always sent them; the
  contract omitted them under `additionalProperties: false`, which made every
  real claim response invalid. They are non-optional in the types so a caller
  never has to tell an absent field from an event that has not happened yet.
- `DaykeeperApiError` gains `retryAfterSeconds`, read from a `Retry-After`
  header the SDK can parse as a whole number of seconds between 1 and 86400. An
  HTTP-date or an out-of-range value leaves it `undefined` rather than guessed
  at, since converting a date needs a trusted clock. It appears in `toJSON()`
  only when it is known.
- Any `429` is now reported as retryable, whatever the body's own `retryable`
  flag says. Claim creation has two limits behind that status — the hourly claim
  window (`INVITATION_LIMIT_REACHED`) and the generic per-address and
  per-principal request limiter (`RATE_LIMITED`) — and neither applies a write.
  A request whose outcome is unknown stays non-retryable, as before.
- Vendor management contract 1.3.0 from the immutable `daykeeper-openapi` tag
  `v1.3.0` (commit `067465ed`); see `openapi/SOURCE.md`.
- No existing method, path, type, or status changes. This release is additive.

## 0.2.1

- Correct entitlement policy types to include the existing `pro` and `scale`
  server responses alongside `free`. Runtime request behavior is unchanged.
  TypeScript consumers that assumed `plan` was always `"free"` must handle the
  paid values too; compilation may now expose that earlier unsafe assumption.
- Correct the provisioning entitlement schema's allowed/denied branches while
  retaining their strict object validation.
- Verify vendored contract SHA-256 and Git blob checksums in the test suite.

## 0.2.0

- Add API-only inbox desired state (`inbox: { type: "api" }`) and
  `inboxes.get(tenantId)`. Matching server capabilities are required. Preparation
  does not activate customer traffic; no customer website or DNS setup is needed.
- Management requests now reject redirects and omit cookies. Configure the final
  API URL directly; a redirected write reports an uncertain outcome without retry.

### Breaking

- The vendored management contract moves to 0.2.0 and breaks callers in two
  ways. `flows.create`, `flows.createVersion` and `flows.publishVersion` now
  REQUIRE an `Idempotency-Key` header, so their `options` argument and its
  `idempotencyKey` are mandatory; a call without one is rejected as
  `INVALID_CONFIGURATION` and never reaches the server. Use
  `generateIdempotencyKey()` to mint one per logical mutation, and reuse the
  same key when you repeat a call.
- A replayed flow mutation now returns `200` alongside the existing `201`.
  Both are success. The result carries `replayed: true` when the stored result
  of an earlier identical request under the same key was returned and no write
  was applied, so code that treated `201` as "created" must read `replayed`
  instead of the status.
- This break comes from the management contract only. The customer contract
  (`openapi/customer.yaml`) stays at 0.1.0 and has no `Idempotency-Key`
  requirement, so customer-contract SDKs are unaffected by it.

### Changes

- Add machine-owner-only domain verification methods for creating, inspecting,
  verifying, and revoking DNS TXT challenges. Verification records are receipts
  and do not activate customer traffic.

- Allow machine-owned tenant plans to omit the optional legacy `administrator`
  contact metadata. When supplied, its name and email remain validated; it
  never establishes ownership or access.
- Add an unauthenticated, signed-body onboarding client for independent machine
  signup, credential rotation, and read-only current-credential recovery. No
  cookies, authorization headers, redirects, or automatic retries are used.
- Add a dependency-free WebCrypto ES256 machine owner signer with explicit key
  export, pinned audiences, and intent-bound proofs. Private keys and reveal-once
  credentials remain caller-managed secrets. These APIs do not enable hosted
  signup or customer traffic on their own.

- Require an explicit `idempotencyKey` on `flows.create`, `flows.createVersion`
  and `flows.publishVersion`, send it as `Idempotency-Key`, and expose
  `replayed` on the result. Add `generateIdempotencyKey()` for callers that want
  one; the SDK never generates a key inside a retry.
- Report a mutation that fails before any response arrives as
  `outcomeUnknown: true` and never retryable. Recover by repeating the same call
  with the same idempotency key, which returns the stored result instead of
  applying the change twice. Once a status has been received the outcome is
  known even if the body cannot be read, so an unreadable `201` or a timed-out
  `400` body reports `outcomeUnknown: false`.
- Restrict the single authentication refresh after a `401` to reads and to
  mutations that carry an idempotency key. A keyless mutation is never sent
  twice. Read behavior is unchanged.
- Call only the fixed contract path set, and reject a base URL that hides a
  path level behind an encoded separator.
- Project errors as contract fields only: `code`, `status`, `retryable`,
  `outcomeUnknown`, `correlationId`, `message`, `nextActions` and `fields`. No
  raw server body reaches the caller. `code`, `message` and `correlationId` are
  length-bounded, and a correlation identifier read from the `x-request-id`
  header must match an opaque token shape, so a proxy cannot push free text or a
  URL into a caller's error report.
- Keep a response that resolves exactly on the deadline instead of discarding it
  as a timeout. The deadline is now strictly exclusive, so a result that lands on
  the boundary survives the next lifetime check as well.
- Reject a flow mutation called without its options argument as
  `INVALID_CONFIGURATION` instead of throwing a synchronous `TypeError`.
- Classify a non-JSON rejection, such as a proxy `403` page, by its status
  instead of reporting a retryable `INVALID_RESPONSE`.
- Add typed agent credential list, reveal-once create, and revoke methods with
  explicit idempotency, cancellation, bounded metadata, and no automatic retry.
- Accept a mutually exclusive `apiKey` constructor option for static server-side
  credentials while retaining `token` and rotating token providers for OAuth.
- Add cancellable `tenants.getProvisioningOperation(tenantId)` for read-only
  recovery after a reload or lost apply response. No automatic retry, new tenant,
  or traffic activation is performed when an operation is absent.
- Add `usage.get()` for organization-wide resource-safety counters, with
  cancellation and existing bounded authentication refresh. No billing,
  assignment, reset or traffic activation operation is added.
- Add typed organization entitlement inspection with `entitlements.get()`.
- Accept optional website settings on the existing tenant plan and inspect
  preparation with `websiteChannels.get(tenantId)`. Prepared is not activated;
  no routing, credentials, billing or customer traffic is enabled by the SDK.
- Rewrite published source map `sources` so they stay inside `dist` instead of
  pointing at an unpublished `../src`. The original text was already embedded in
  `sourcesContent`, so debugger behavior improves and nothing is lost.
- Record the exact canonical contract snapshot. Existing account-only
  and customer-session methods retain their paths and behavior.

## 0.1.1

- Align vendored OpenAPI license metadata and record the exact source commit
  and checksum; generated types and runtime behavior are unchanged.
- Classify credential-provider failures as non-retryable `TOKEN_PROVIDER_ERROR`
  without exposing raw provider errors; timeout and cancellation stay distinct.
- Bound credential acquisition, authentication refresh, transport, and body
  reads by one request deadline; propagate cancellation to token providers.
- Prevent late dispatch after abort and release failed/late response bodies
  without waiting for custom transport cleanup.
- Add typed, purpose-limited customer-session exchange for trusted servers.
- Make public SDK and contract documentation infrastructure-provider neutral.

## 0.1.0

- Add typed tenant plan/apply and inspection APIs.
- Add typed email-channel plan/apply and readiness APIs.
- Add durable operation inspection and retry APIs.
- Add immutable flow create/version/publish APIs.
- Add structured API and transport errors with bounded response parsing.
