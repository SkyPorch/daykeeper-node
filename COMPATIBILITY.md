# Compatibility

`@skyporch/daykeeper` is a MANAGEMENT contract SDK. Its types are generated from
the vendored `openapi/daykeeper.yaml`, and every release records the exact
`SkyPorch/daykeeper-openapi` tag and commit it was generated from. See
`openapi/SOURCE.md` for the current snapshot and `RELEASING.md` for the ordering
rule: the contract is tagged first, and only an immutable tag may be recorded in
a release.

| SDK version        | Management contract | Contract tag | Contract commit                            | Notes                                                                                                                                                        |
| ------------------ | ------------------- | ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.5.0 (unreleased) | 1.6.0               | untagged     | `a095fef618ac946e0a6a64d65db677c818236891` | Adds `agentCredentials.rotate`. Branch head of daykeeper-openapi `claude/agent-key-rotation`; re-pin to `v1.6.0` before release.                             |
| 0.4.0              | 1.4.0               | `v1.4.0`     | `488cc39c3604882742c88b08d90a664e3d82e515` | Agent credentials last until revoked by default; `expiresAt` is nullable.                                                                                    |
| 0.3.0              | 1.3.0               | `v1.3.0`     | `067465edfc6c94e63867a6dd0d9db02e12683877` | Published by hand with no provenance attestation. Adds machine-owner workspace claims.                                                                       |
| 0.2.1              | 1.2.0               | `v1.2.0`     | `3140bbab0b683371ee1b1c17ff8db67a9ae1fa68` | Correct existing paid-policy types and provisioning schema branches; no runtime request changes. Staged but never approved, so not on npm; 0.3.0 carries it. |
| 0.2.0              | 1.1.0               | `v1.1.0`     | `c9a0175d0053f1a2d57c9329f6d3a36ec6acdb71` | Published. `Idempotency-Key` is required on flow mutations; replays return `200` beside `201`.                                                               |
| 0.1.1              | 0.1.0               | `v1.0.0`     | `35f5bd45fe0c6a6901766543bff90dae6838b965` | Vendored contract metadata aligned; no runtime contract change.                                                                                              |
| 0.1.0              | 0.1.0               | `v1.0.0`     | `35f5bd45fe0c6a6901766543bff90dae6838b965` | Published by hand with no provenance attestation.                                                                                                            |

## Server requirement

The unreleased 0.3.0 `workspaceClaims` methods require a server that implements
the workspace claim routes and has a console origin configured; check
`capabilities().workspaceClaims` first. The field is absent on older servers and
`false` when the origin is unset, in which case the routes answer
`FEATURE_UNAVAILABLE` (503). Every other 0.2.x method is unchanged.

The 0.2.x SDK requires the corresponding Daykeeper management capabilities,
including idempotent flow mutations. Older servers without those operations
are not supported for flow mutations. Account-only and customer-session methods
that existed in 0.1.x keep their paths and behavior. Version 0.2.1 corrects types
for paid policy responses already returned by deployed servers. Consumers that
assumed `policy.plan` could only be `"free"` must also handle `"pro"` and `"scale"`.

## Customer contract

The customer contract (`openapi/customer.yaml`) is a separate document and is
still 0.1.0. It has no `Idempotency-Key` header, and the required-header break
described above **does not apply to it**. Customer-contract consumers
(`daykeeper-react-native`, `daykeeper-web`) are unaffected by this SDK's break;
this package does not consume the customer contract.
