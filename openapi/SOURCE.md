# Contract source

`daykeeper.yaml` is an exact, byte-for-byte copy of `openapi/daykeeper.yaml`
from `SkyPorch/daykeeper-openapi` tag `v1.6.0`, commit
`f563df6fffca80d7d2c634e270604b6e61561152` (contract `1.6.0`, the squash merge
of `daykeeper-openapi` PR #34).

- SHA-256: `0e3c3b6d3d524366169c829164c85caa67b86445eea07e5b4d0979c0e230ff69`
- Git blob: `e8bfa74803c11bbab03889523dbd261f386271c6`

There is no local delta. This repository does not modify the vendored contract.

`1.6.0` adds agent credential rotation: `POST
/v1/agent-credentials/{agentCredentialId}/rotate` with a required
`Idempotency-Key`, `RotateAgentCredentialInput` (`overlapHours` 0 through 168,
default 24; `validityDays` as on create), and `RotateAgentCredentialResult`
(`credential`, `previousCredential`, reveal-once `token`, `replayed`).
`AgentCredential` gains optional `rotatedFromId`, `replacedById` and
`replacedAt`, and capabilities gain an optional `agentCredentials.rotation`.
The reusable `DaykeeperCredentialExpiresAt` header
(`Daykeeper-Credential-Expires-At`) is declared on every 2xx of the five
server-key operations and on `Error`. A server key rotating itself must not
send `overlapHours: 0`, and a server may reject it with `INVALID_INPUT`. It
also carries the untagged `1.5.0` change on upstream main (tenant-scoped server
keys: `tenantId`, lifecycle and erasure scopes).

The review fixes merged with it: `AgentCredential`, `AgentCredentialPage`, the
create, revoke and rotate results, and `capabilities.agentCredentials` now set
`additionalProperties: true`, as the upstream `VERSIONING.md` requires of
response schemas. The regenerated types gain an index signature, and
`AgentCredential` forbids `token` and `tokenHash` (`never`).
`AgentCredential.tenantId` is optional, because servers before tenant-scoped
keys omit it; absent means organization-wide. The contract's conditional
tenant and scope rules on `CreateAgentCredentialInput` generate no types, so
`src/types.ts` exports that input as a discriminated union instead.

The previous pin, tag `v1.4.0`, commit
`488cc39c3604882742c88b08d90a664e3d82e515`, made agent credentials last until
they are revoked by default: `CreateAgentCredentialInput.validityDays` is
`integer | null`, 1 through 365, default `null`, and `AgentCredential.expiresAt`
is `string | null`. It matches the server change in `SkyPorch/daykeeper` PR
#217.

The previous pin, tag `v1.3.0`, commit
`067465edfc6c94e63867a6dd0d9db02e12683877`, added machine-owner workspace claims: `POST`/`GET`
`/v1/workspace-claims` and `POST /v1/workspace-claims/{claimId}/revoke`, the
`WorkspaceClaim`, `CreateWorkspaceClaimInput`, `WorkspaceClaimCreated`,
`WorkspaceClaimReplayed`, `WorkspaceClaimResult` and `WorkspaceClaimList`
schemas with their envelopes, the `WorkspaceClaimId` parameter, non-cacheable
claim error and rate-limit responses, and the optional
`capabilities.workspaceClaims` boolean. Creation requires an `Idempotency-Key`
and reveals `token` and `claimUrl` exactly once; a replay returns both as
`null`. Every addition is additive and optional, so `info.version` moves from
`1.2.0` to `1.3.0` under the upstream `VERSIONING.md`.

The reconciliation fixes carried by this re-vendor, all within the same
unreleased `1.3.0`, settle four disagreements between the contract, the
reviewed server and this SDK:

`WorkspaceClaim` gains `acceptedAt` and `revokedAt`, required and nullable
date-times. The server has always emitted both, and `additionalProperties:
false` without them made every real response invalid against the contract.
They are required rather than optional so a client never has to tell "absent"
apart from "has not happened yet"; the regenerated types make both non-optional
`string | null`.

429 has two mechanisms behind it. The hourly claim window answers
`INVITATION_LIMIT_REACHED`, the existing invitation code the server raises; the
generic per-address and per-principal request limiters answer `RATE_LIMITED`
with `Retry-After`. Both are named in the contract now, and this SDK treats
either as retryable and reports the interval as `retryAfterSeconds` on the
raised error when the header is a readable delay.

`IDEMPOTENCY_KEY_REUSED`, `ORGANIZATION_ACCESS_REQUIRED` on every 403, and
`RESOURCE_NOT_FOUND` on revoke's 404 are documented where the server emits
them; revoke's 409 is `RESOURCE_STATE_CONFLICT`, the code the server actually
raises, not the `RESOURCE_CONFLICT` the contract had invented.

The list carries pending, accepted and revoked claims, newest first, with only
an expired pending claim hidden. That is what the server's filter already does.

The earlier review fixes, also within `1.3.0`: the two success bodies of `createWorkspaceClaim` are now
status-specific, `WorkspaceClaimCreated` for `201` and `WorkspaceClaimReplayed`
for `200`, with `WorkspaceClaimResult` kept as their `oneOf` so the SDK still
has one result type; `WorkspaceClaimList.items` lost its `maxItems: 100`, which
capped an unpaginated list; and `CreateWorkspaceClaimInput.email` moved from
"no uppercase, no whitespace, one @" to a real lowercase address rule. The last
is the only change that narrows what the contract accepts, and it narrows an
unreleased addition, so it is not a break for any published client.

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

The source above is the immutable `v1.6.0` tag, which satisfies `RELEASING.md`
step 2 for 0.5.0.
