import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = readFileSync(
  new URL("../openapi/daykeeper.yaml", import.meta.url),
);
const source = readFileSync(
  new URL("../openapi/SOURCE.md", import.meta.url),
  "utf8",
);
const canonicalContract = readFileSync(
  new URL("../../openapi/openapi/daykeeper.yaml", import.meta.url),
);

test("vendored contract matches the canonical workspace contract", () => {
  assert.deepEqual(contract, canonicalContract);
  assert.match(source, /draft of management contract `1\.8\.0`/);
});
