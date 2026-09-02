# Changelog

## Unreleased

## 0.2.0 (unreleased)

- Require an explicit `idempotencyKey` on `flows.create`, `flows.createVersion`
  and `flows.publishVersion`, send it as `Idempotency-Key`, and expose
  `replayed` on the result. Add `generateIdempotencyKey()` for callers that want
  one; the SDK never generates a key inside a retry.
- Report a mutation that fails after dispatch as `outcomeUnknown: true` and
  never retryable. Recover by repeating the same call with the same idempotency
  key, which returns the stored result instead of applying the change twice.
- Restrict the single authentication refresh after a `401` to reads and to
  mutations that carry an idempotency key. A keyless mutation is never sent
  twice. Read behavior is unchanged.
- Call only the fixed contract path set, and reject a base URL that hides a
  path level behind an encoded separator.
- Project errors as contract fields only: `code`, `status`, `retryable`,
  `outcomeUnknown`, `correlationId`, `message`, `nextActions` and `fields`. No
  raw server body reaches the caller.
- Keep a response that resolves exactly on the deadline instead of discarding it
  as a timeout.
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
- Record the exact unreleased canonical contract snapshot. Existing account-only
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
