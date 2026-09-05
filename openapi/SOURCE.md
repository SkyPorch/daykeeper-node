# Contract source

`daykeeper.yaml` is an exact, byte-for-byte copy of `openapi/daykeeper.yaml`
from `SkyPorch/daykeeper-openapi`, commit
`8c4badfa3dac3e09431f1db3923e566d3d9f2942`
(`codex/daykeeper-optional-admin-metadata`, stacked on PR #16,
`codex/daykeeper-machine-onboarding-contract`, commit
`7d461325c7abffb190f597bd58c8cda0cb596487`).

- SHA-256: `f771b9566088a54459dc6654f470d41c8575719110f3b0f466c377c682aaab93`
- Git blob: `9bdefb37d51ff65a7eae95befaf4a7f124225934`
- Tag status: unreleased commit snapshot; no new upstream tag is claimed.

There is no local delta. This repository does not modify the vendored contract.

## What this snapshot adds over the released baseline

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`. Relative to that
baseline this snapshot carries five unreleased upstream changes:

1. Organization entitlement reads, optional website tenant settings, capability
   discovery, website preparation metadata, organization-only usage inspection
   and read-only tenant provisioning operation recovery.
2. Owner-managed reveal-once agent credentials (`daykeeper-openapi` PR #13).
3. `additionalProperties: true` on the `Capabilities`, `TenantSpec` and
   `ErrorDetail` schemas, so an older client tolerates new response fields
   instead of rejecting them (`daykeeper-openapi` PR #13). `CustomerError` and
   `ErrorDetail` are declared there as well.
4. Idempotent flow mutations (`daykeeper-openapi` PR #15): a required
   `Idempotency-Key` header on `POST /v1/tenants/{tenantId}/flows`,
   `POST /v1/flows/{flowId}/versions` and
   `POST /v1/flows/{flowId}/versions/{version}/publish`; a `200` replay
   response beside the existing `201` for create and version; the shared
   `IdempotencyKeyReused` response; and `FlowMutationResult` /
   `FlowMutationResultResponse`, which extend `FlowWithVersion` with
   `replayed`. This matches the reviewed server change in `SkyPorch/daykeeper`
   PR #51, `codex/daykeeper-idempotent-flow-mutations`.
5. Independent machine enrollment, signed credential rotation and read-only
   current-credential inspection. These five signed-body routes explicitly
   disable inherited OAuth requirements, expose raw response objects, and keep
   secret-bearing issuance separate from metadata-only replay and recovery.
   Tenant administrator contact metadata is now optional; supplying it never
   establishes human ownership or grants provider access. Existing metadata is
   still validated and preserved.

## Standing notes

This snapshot retains Apache-2.0 license metadata. The OAuth metadata declares
billing and credential-management scopes; it does not grant those scopes to
anyone. Resource counters are not billable outcomes or permission to write. The
snapshot adds no activation or billing mutation. Static credentials remain
secondary to hosted OAuth. The new SDK methods need the corresponding reviewed
server version; older servers remain compatible with existing account-only
methods.

These upstream pull requests are unmerged. Release provenance must record an
immutable `daykeeper-openapi` tag and its full commit SHA. Before release,
update this snapshot record to that reviewed tag and verify the contract
checksum above. CI regenerates TypeScript declarations and fails when the
committed output differs.
