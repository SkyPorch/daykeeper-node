# Changelog

## Unreleased

## 0.2.0 (unreleased)

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
