# Contract source

`daykeeper.yaml` is an exact, byte-for-byte copy of `openapi/daykeeper.yaml`
from `SkyPorch/daykeeper-openapi`, commit
`291e6f7581913dbb7a24fbd3a233cb602623e272`.

- SHA-256: `8486c8e63909c5051daa58bd0204d3e5493e691e042a62817570b7a3477cd6f5`
- Git blob: `f044295425c32c92587143c2b80241b93ee36889`

There is no local delta. This repository does not modify the vendored contract.

The upstream change widens `EntitlementPolicy.plan` to the existing supported
`free`, `pro`, and `scale` values. It does not change the response shape or
make billing/traffic capability claims.

## What this snapshot adds over the released baseline

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`. Relative to that
baseline this snapshot carries these upstream changes:

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
6. Bounded domain observation workflows and API-only inbox desired state,
   generic inbox inspection and capability discovery. API and website inbox
   settings are mutually exclusive; preparation does not activate traffic.
7. Machine-owner API inbox activation, retained receipt inspection and revocation.
   Public receipts omit installation identity and database role metadata. Optional
   activation capability does not imply a deployed or currently ready tenant.

## Standing notes

This snapshot retains Apache-2.0 license metadata. The OAuth metadata declares
billing and credential-management scopes; it does not grant those scopes to
anyone. Resource counters are not billable outcomes or permission to write. The
snapshot adds opt-in activation but no billing mutation. Machine-owner credentials
are required for activation. The new SDK methods need the corresponding reviewed
server version; older servers remain compatible with existing account-only
methods.

Release provenance records the immutable `daykeeper-openapi` tag and full
commit SHA above. CI regenerates TypeScript declarations and fails when the
committed output differs.
