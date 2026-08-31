# Contract source

`daykeeper.yaml` is an exact copy of `openapi/daykeeper.yaml` from
`SkyPorch/daykeeper-openapi`, commit
`924dafc661952c2f97cb41e609e6b531c1f44a7b` (license metadata, PR #7).

- SHA-256: `fdc0fcc55a731d211f500c5d8945df83dbfc9a912cfff1eb9b470bd8570c3557`
- Source Git blob: `7b57b5124fea1e8ea1b0e4570945ddc7866d35ab`
- Tag status: unreleased commit snapshot; no new upstream tag is claimed.

The released baseline is tag `v1.0.0`, commit
`35f5bd45fe0c6a6901766543bff90dae6838b965`. Provider-neutral wording came from
PR #5, commit `fec6f9b88661fbfd04b7d7c66acce257f15ea6bd`.
This snapshot changes only `info.license` from that prior snapshot to match the
contract's Apache-2.0 license. Operations, schemas, scopes, and generated
TypeScript types are unchanged; PR #8 entitlement additions are not included.

Release provenance must record an immutable `daykeeper-openapi` tag and its
full commit SHA. Before release, update this snapshot record to that reviewed
tag and verify the contract checksum. CI regenerates TypeScript declarations
and fails when the committed output differs.
