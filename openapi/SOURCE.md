# Contract source

`daykeeper.yaml` is a copy of `openapi/daykeeper.yaml` from
`SkyPorch/daykeeper-openapi`, commit
`4a2b82c9b23503073dc26fdeb5163e8869d007b8` (head of PR #13,
`codex/daykeeper-agent-credentials`, which supersedes commit `7251704`), plus
the local flow idempotency delta recorded below.

- Upstream SHA-256: `11c505448668028d093509bb1f9df2bb9ad85a14a525b74a84fdfa6744e582a2`
- Upstream Git blob: `b6a38cc9b8eed8a0a1388b1bd7e11fa9cbe4dc44`
- Tag status: unreleased commit snapshot; no new upstream tag is claimed.

## Ahead of contract: flow idempotency pending openapi PR

The reviewed server change `SkyPorch/daykeeper` PR #51
(`codex/daykeeper-idempotent-flow-mutations`) requires an `Idempotency-Key`
header on `POST /v1/tenants/{tenantId}/flows`, `POST /v1/flows/{flowId}/versions`
and `POST /v1/flows/{flowId}/versions/{version}/publish`, and returns a
`replayed` boolean on each result. The canonical contract repository does not
declare this yet. This vendored copy adds, in this repository only:

- the shared `IdempotencyKey` header parameter on those three operations;
- a `200` replay response alongside the existing `201` for create and version;
- `FlowMutationResult` and `FlowMutationResultResponse`, which extend
  `FlowWithVersion` with `replayed`.

Replace this delta with the upstream contract once the corresponding
`daykeeper-openapi` pull request merges, and record that commit here.

## Baseline

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`.
This snapshot retains Apache-2.0 license metadata and includes the unreleased
organization entitlement read, optional website tenant settings, capability
discovery, website preparation metadata, organization-only usage inspection and
read-only tenant provisioning operation recovery, and owner-managed reveal-once
agent credentials. Response envelopes `Capabilities`, `ErrorDetail`,
`CustomerError` and the returned `TenantSpec` are open to new fields so older
clients tolerate contract growth. The OAuth metadata declares billing and
credential-management scopes; it does not grant those scopes to anyone.
Resource counters are not billable outcomes or permission to write. The snapshot
adds no activation or billing mutation. Static credentials remain secondary to
hosted OAuth. The new SDK methods need the corresponding reviewed server version;
older servers remain compatible with existing account-only methods.

Release provenance must record an immutable `daykeeper-openapi` tag and its
full commit SHA. Before release, update this snapshot record to that reviewed
tag and verify the contract checksum. CI regenerates TypeScript declarations
and fails when the committed output differs.
