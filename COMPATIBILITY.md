# Compatibility

`@skyporch/daykeeper` is a MANAGEMENT contract SDK. Its types are generated from
the vendored `openapi/daykeeper.yaml`, and every release records the exact
`SkyPorch/daykeeper-openapi` tag and commit it was generated from. See
`openapi/SOURCE.md` for the current snapshot and `RELEASING.md` for the ordering
rule: the contract is tagged first, and only an immutable tag may be recorded in
a release.

| SDK version        | Management contract | Contract tag                                      | Contract commit                                                          | Notes                                                                                                                                                       |
| ------------------ | ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2.0 (unreleased) | 0.2.0               | none yet — `daykeeper-openapi` PR #15 is unmerged | `16f1ba8f59699e27c804947fd5d5cca88edd1143` (unreleased PR head snapshot) | Breaking: `Idempotency-Key` is required on flow mutations, and a replay answers `200` beside `201`. Not releasable until the contract is merged and tagged. |
| 0.1.1              | 0.1.0               | `v1.0.0`                                          | `35f5bd45fe0c6a6901766543bff90dae6838b965`                               | Vendored contract metadata aligned; no runtime contract change.                                                                                             |
| 0.1.0              | 0.1.0               | `v1.0.0`                                          | `35f5bd45fe0c6a6901766543bff90dae6838b965`                               | Published by hand with no provenance attestation.                                                                                                           |

## Server requirement

0.2.0 requires a Daykeeper server that implements management contract 0.2.0.
Against an older server the flow mutations will be rejected, because the server
does not honour `Idempotency-Key`. Account-only and customer-session methods
that existed in 0.1.x keep their paths and behavior.

## Customer contract

The customer contract (`openapi/customer.yaml`) is a separate document and is
still 0.1.0. It has no `Idempotency-Key` header, and the required-header break
described above **does not apply to it**. Customer-contract consumers
(`daykeeper-react-native`, `daykeeper-web`) are unaffected by this SDK's break;
this package does not consume the customer contract.
