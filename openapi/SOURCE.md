# Contract source

`daykeeper.yaml` is an exact copy of `openapi/daykeeper.yaml` from
`SkyPorch/daykeeper-openapi`, commit
`f2ae208de7c2c0422482d3f8b16c8c6f7542c347` (tenant provisioning operation discovery).

- SHA-256: `2d5d3db82cde8ed5c02c2774089c4f129e20536d9a8d9f52c563c01f64487bb5`
- Source Git blob: `2224e0d8db6760607f367e5f97c9e5bf916956e7`
- Tag status: unreleased commit snapshot; no new upstream tag is claimed.

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`.
This snapshot retains Apache-2.0 license metadata and includes the unreleased
organization entitlement read, optional website tenant settings, capability
discovery, website preparation metadata, organization-only usage inspection and
read-only tenant provisioning operation recovery. The OAuth metadata also declares
the already-required billing-read scope; it does not grant that scope to anyone.
Resource counters are not billable outcomes or permission to write. The snapshot
adds no activation or billing mutation. The new SDK methods need the corresponding reviewed server version;
older servers remain compatible with existing account-only methods.

Release provenance must record an immutable `daykeeper-openapi` tag and its
full commit SHA. Before release, update this snapshot record to that reviewed
tag and verify the contract checksum. CI regenerates TypeScript declarations
and fails when the committed output differs.
