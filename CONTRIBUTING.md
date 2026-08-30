# Contributing

API changes start in `SkyPorch/daykeeper-openapi`. Update the vendored tagged
contract, regenerate types with `pnpm generate`, and keep ergonomic methods as
thin wrappers over stable OpenAPI operation identifiers.

Run `pnpm check` before requesting review. Add transport tests for retries,
timeouts, aborts, response limits, error envelopes, and any new operation. Never
log tokens, request bodies, or provider response bodies.
