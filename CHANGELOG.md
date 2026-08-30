# Changelog

## Unreleased

## 0.1.1

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
