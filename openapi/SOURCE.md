# Contract source

`daykeeper.yaml` is an exact copy of `openapi/daykeeper.yaml` from
`SkyPorch/daykeeper-openapi`, commit
`e62cfd25228565b15fe169cd7b65a3279932b59f` (organization-scoped usage inspection).

- SHA-256: `ccdc02c537da1d88d08e6860e4fc0dbe4805ef1ca1f6ff6a0955edeee69a4fdc`
- Source Git blob: `90ea656244ac204f70d4b1485f55379d719ce8ee`
- Tag status: unreleased commit snapshot; no new upstream tag is claimed.

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`.
This snapshot retains Apache-2.0 license metadata and includes the unreleased
organization entitlement read, optional website tenant settings, capability
discovery, website preparation metadata and organization-only usage inspection.
Resource counters are not billable outcomes or permission to write. The snapshot
adds no activation or billing mutation. The new SDK methods need the corresponding reviewed server version;
older servers remain compatible with existing account-only methods.

Release provenance must record an immutable `daykeeper-openapi` tag and its
full commit SHA. Before release, update this snapshot record to that reviewed
tag and verify the contract checksum. CI regenerates TypeScript declarations
and fails when the committed output differs.
