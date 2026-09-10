# Contract source

`daykeeper.yaml` is an exact, byte-for-byte copy of `openapi/daykeeper.yaml`
from `SkyPorch/daykeeper-openapi`, **unreleased** contract `1.3.0` candidate on
branch `codex/workspace-claims-contract`, commit
`fb205e6380755cff40441e434e36e935e8d1b48c`.

- SHA-256: `566e762294dd420c8c54eb5b93f77d8388138bf91c4f4843d4e77f5697741d4d`
- Git blob: `b3c6c8aeb2f2f2c1b0d5d712290af79019f91aed`

**This is a branch head, not a release tag.** `RELEASING.md` step 2 forbids a
branch head in a release, so `@skyporch/daykeeper` 0.3.0 must not be published
from this pin. When `daykeeper-openapi` merges the contract and creates the
immutable `v1.3.0` tag, the release pull request re-vendors from that tag and
updates the tag name, commit, SHA-256, and Git blob above. The bytes are not
expected to change, but the checksums are re-verified rather than assumed.

There is no local delta. This repository does not modify the vendored contract.

The upstream change adds machine-owner workspace claims: `POST`/`GET`
`/v1/workspace-claims` and `POST /v1/workspace-claims/{claimId}/revoke`, the
`WorkspaceClaim`, `CreateWorkspaceClaimInput`, `WorkspaceClaimResult` and
`WorkspaceClaimList` schemas with their envelopes, the `WorkspaceClaimId`
parameter, non-cacheable claim error and rate-limit responses, and the optional
`capabilities.workspaceClaims` boolean. Creation requires an `Idempotency-Key`
and reveals `token` and `claimUrl` exactly once; a replay returns both as
`null`. Every addition is additive and optional, so `info.version` moves from
`1.2.0` to `1.3.0` under the upstream `VERSIONING.md`.

The previous pin, tag `v1.2.0`, commit
`3140bbab0b683371ee1b1c17ff8db67a9ae1fa68`, widened `EntitlementPolicy.plan` to
the existing supported `free`, `pro`, and `scale` values and repaired the strict
`TenantProvisioningEntitlement.oneOf` examples by repeating the complete object
properties in each branch. That keeps `additionalProperties: false` while making
the canonical examples validate against the schema.

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
8. Machine-owner workspace claims (`daykeeper-openapi`
   `codex/workspace-claims-contract`). A claim is an owner invitation issued by
   the machine owner over the existing invitation lifecycle; it is not a second
   identity path. Human bearers and delegated agent credentials are rejected
   with `SCOPE_NOT_HELD`. The claim URL carries its token in the fragment and is
   revealed once. Discovery through `capabilities.workspaceClaims` does not
   enable the server feature or configure a console origin.

## Standing notes

This snapshot retains Apache-2.0 license metadata. The OAuth metadata declares
billing and credential-management scopes; it does not grant those scopes to
anyone. Resource counters are not billable outcomes or permission to write. The
snapshot adds opt-in activation but no billing mutation. Machine-owner credentials
are required for activation. The new SDK methods need the corresponding reviewed
server version; older servers remain compatible with existing account-only
methods.

The source commit above is an unreleased `daykeeper-openapi` branch head, not an
immutable release tag; see the note at the top of this file. CI verifies the
documented checksums, regenerates TypeScript declarations, and fails when the
committed output differs.
