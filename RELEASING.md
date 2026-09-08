# Releasing `@skyporch/daykeeper`

Releases are immutable and use semantic versioning. Every release records the
exact `SkyPorch/daykeeper-openapi` tag and commit used to generate its types.

## Provenance status of 0.1.0

`@skyporch/daykeeper@0.1.0` was published by hand. It carries **no provenance
attestation**, even though `package.json` declares `publishConfig.provenance:
true`: a hand-run publish from a workstation has no OIDC identity for npm to
attest. This cannot be fixed retroactively — npm does not add an attestation to
an already-published version, and a republish of the same version is not
allowed. The first release driven by `release.yml` through trusted publishing is
what fixes this going forward; from that release on, every version can be
verified with the post-publish check in step 7 below.

## One-time bootstrap

1. Choose and commit the approved package license; `UNLICENSED` deliberately
   blocks release automation.
2. Make this repository public only after a complete history and secret scan.
3. Confirm SkyPorch controls the `@skyporch` npm organization and requires 2FA.
4. An npm owner publishes the reviewed first version interactively. npm cannot
   stage a brand-new package. (This is what produced the unattested 0.1.0.)
5. Configure npm trusted publishing for organization `SkyPorch`, repository
   `daykeeper-node`, workflow `release.yml`, and GitHub environment
   `daykeeper-npm-production`.
6. Protect the environment with a non-author reviewer and then restrict package
   publishing to trusted publishers.

## Normal release, in order

1. **Tag the contract first.** In `SkyPorch/daykeeper-openapi`, merge the
   contract change to main and create the immutable release tag
   `vMAJOR.MINOR.PATCH`. Releases there are tags, never branches, and a tag is
   never moved.
2. **Point `openapi/SOURCE.md` at that tag.** This repository vendors the
   management contract, so `openapi/SOURCE.md` must record the immutable tag
   name _and_ its full commit SHA, plus the file checksum. A branch head or an
   unmerged pull request head is not acceptable in a release. Re-vendor the
   contract from the tag and re-run `pnpm check:generated`.

   > Today `openapi/SOURCE.md` points at commit
   > `16f1ba8f59699e27c804947fd5d5cca88edd1143`, the head of the unmerged
   > `daykeeper-openapi` PR #15. It is labelled there as an unreleased commit
   > snapshot, which is honest but **not releasable**. Shipping 0.2.0 requires
   > that PR to merge, a `daykeeper-openapi` tag to exist, and this file to be
   > updated to that tag. No such tag exists yet; do not invent one.

3. **Finalize the changelog.** The section for the version being released must
   carry the real version heading with no `unreleased` marker left anywhere in
   it, and must include a `### Breaking` subsection when the release breaks
   callers.
4. **One reviewed version-bump commit.** Update `package.json`, `CHANGELOG.md`,
   `COMPATIBILITY.md` and `openapi/SOURCE.md` together in a single pull request,
   have a non-author review it, run `pnpm check`, inspect the exact `npm pack`
   contents, and merge it to `main`.
5. **Create the GitHub release from a tag on main.** Tag the merge commit on
   `main` as `vMAJOR.MINOR.PATCH` and publish a matching GitHub Release. The
   workflow refuses any tag that is not an ancestor of `origin/main`, and any
   release whose target is not `main`. Mark prereleases in GitHub so they use
   npm's `next` tag.
6. **`release.yml` publishes with provenance.** The workflow verifies the tag,
   runs `pnpm check` and `scripts/verify-release.mjs`, then submits the package
   through npm trusted publishing with `npm stage publish --provenance` over
   OIDC. No long-lived npm publishing token exists in GitHub. A maintainer then
   downloads and reviews the staged tarball and approves it with npm 2FA.
7. **Verify provenance after publishing.** Both of these must show an
   attestation for the new version:

   ```sh
   curl -fsS "https://registry.npmjs.org/-/npm/v1/attestations/@skyporch/daykeeper@<version>"
   npm view "@skyporch/daykeeper@<version>" dist.attestations
   ```

   If either is empty, the release did not go through trusted publishing.
   Record the result on the release.

## Rehearsing a release

`release.yml` also accepts `workflow_dispatch` with `dry_run` (default `true`).
The dry run performs every step of the real release up to and including
`npm publish --dry-run --provenance`, and never stages or publishes anything.
The tag ancestry gate is skipped for a dry run only, because a dry run has no
release tag.

No long-lived npm publishing token belongs in GitHub.
