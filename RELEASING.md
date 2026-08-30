# Releasing `@skyporch/daykeeper`

Releases are immutable and use semantic versioning. Every release records the
exact `SkyPorch/daykeeper-openapi` tag and commit used to generate its types.

## One-time bootstrap

1. Choose and commit the approved package license; `UNLICENSED` deliberately
   blocks release automation.
2. Make this repository public only after a complete history and secret scan.
3. Confirm SkyPorch controls the `@skyporch` npm organization and requires 2FA.
4. An npm owner publishes the reviewed first version interactively. npm cannot
   stage a brand-new package.
5. Configure npm trusted publishing for organization `SkyPorch`, repository
   `daykeeper-node`, workflow `release.yml`, and GitHub environment
   `daykeeper-npm-production`.
6. Protect the environment with a non-author reviewer and then restrict package
   publishing to trusted publishers.

## Normal release

1. Update the version and changelog in a reviewed pull request.
2. Run `pnpm check` and inspect the exact `npm pack` contents.
3. Tag the merge commit as `vMAJOR.MINOR.PATCH` and create a matching GitHub
   Release. Mark prereleases in GitHub when they should use npm's `next` tag.
4. The release workflow verifies the tag and package, then submits it through
   npm trusted publishing with `npm stage publish`.
5. A maintainer downloads and reviews the staged tarball, then approves it with
   npm 2FA. Stable versions use `latest`; prereleases use `next`.

No long-lived npm publishing token belongs in GitHub.
