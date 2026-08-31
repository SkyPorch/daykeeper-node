# Contract source

`daykeeper.yaml` is an exact copy of `openapi/daykeeper.yaml` from
`SkyPorch/daykeeper-openapi`, commit
`af2c607f15c27dacb2ed67a7dd73b98b5ff4f719` (first-inbox preparation contract).

- SHA-256: `7fc72829df73dc8df22ae597957b1268b4cf3f08e7afa39bf4bd34d7e445330c`
- Source Git blob: `de5c4494247bfe9c3d05ebe4442cd2f538407d62`
- Tag status: unreleased commit snapshot; no new upstream tag is claimed.

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`.
This snapshot retains Apache-2.0 license metadata and includes the unreleased
organization entitlement read, optional website tenant settings, capability
discovery and website preparation metadata. It adds no activation or billing
operation. The new SDK methods need the corresponding reviewed server version;
older servers remain compatible with existing account-only methods.

Release provenance must record an immutable `daykeeper-openapi` tag and its
full commit SHA. Before release, update this snapshot record to that reviewed
tag and verify the contract checksum. CI regenerates TypeScript declarations
and fails when the committed output differs.
