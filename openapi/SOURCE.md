# Contract source

`daykeeper.yaml` is an exact copy of `openapi/daykeeper.yaml` from
`SkyPorch/daykeeper-openapi`, commit
`d78e2f08573f8e8b90cb666caae1cac2983f9f25` (agent credential management).

- SHA-256: `e2d53b2e53900afe1021551d0ced1345eafb42dea8f414b3c813778430f21390`
- Source Git blob: `7895a2428ba0565de6bde9fdcd838991d2ea8de6`
- Tag status: unreleased commit snapshot; no new upstream tag is claimed.

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`.
This snapshot retains Apache-2.0 license metadata and includes the unreleased
organization entitlement read, optional website tenant settings, capability
discovery, website preparation metadata, organization-only usage inspection and
read-only tenant provisioning operation recovery, and owner-managed reveal-once
agent credentials. The OAuth metadata declares billing and credential-management
scopes; it does not grant those scopes to anyone.
Resource counters are not billable outcomes or permission to write. The snapshot
adds no activation or billing mutation. Static credentials remain secondary to
hosted OAuth. The new SDK methods need the corresponding reviewed server version;
older servers remain compatible with existing account-only methods.

Release provenance must record an immutable `daykeeper-openapi` tag and its
full commit SHA. Before release, update this snapshot record to that reviewed
tag and verify the contract checksum. CI regenerates TypeScript declarations
and fails when the committed output differs.
