import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const expectedTag = process.env.GITHUB_REF_NAME;

assert.notEqual(
  manifest.license,
  "UNLICENSED",
  "Choose a package license before publishing",
);
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
if (expectedTag) {
  assert.equal(
    expectedTag,
    `v${manifest.version}`,
    "Git tag must match the package version",
  );
}
assert.equal(manifest.name, "@skyporch/daykeeper");
assert.equal(
  manifest.repository.url,
  "git+https://github.com/SkyPorch/daykeeper-node.git",
);
for (const dependencies of [
  manifest.dependencies,
  manifest.optionalDependencies,
  manifest.peerDependencies,
]) {
  for (const version of Object.values(dependencies ?? {})) {
    assert(
      !String(version).startsWith("workspace:"),
      "Published dependencies cannot use workspace ranges",
    );
  }
}

const changelog = await readFile("CHANGELOG.md", "utf8");
assert(
  changelog.includes(manifest.version),
  "Changelog must include the package version",
);
