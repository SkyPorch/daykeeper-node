import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = readFileSync(
  new URL("../openapi/daykeeper.yaml", import.meta.url),
);
const source = readFileSync(
  new URL("../openapi/SOURCE.md", import.meta.url),
  "utf8",
);

test("vendored contract matches its documented SHA-256", () => {
  const documented = source.match(/^- SHA-256: `([a-f0-9]{64})`$/m)?.[1];
  assert.ok(documented, "SOURCE.md must document the SHA-256");
  assert.equal(createHash("sha256").update(contract).digest("hex"), documented);
});

test("vendored contract matches its documented Git blob", () => {
  const documented = source.match(/^- Git blob: `([a-f0-9]{40})`$/m)?.[1];
  assert.ok(documented, "SOURCE.md must document the Git blob");
  const actual = createHash("sha1")
    .update(`blob ${contract.length}\0`)
    .update(contract)
    .digest("hex");
  assert.equal(actual, documented);
});
