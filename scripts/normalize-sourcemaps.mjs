// tsup emits `../src/*.ts` source paths, which point outside the published
// `dist` directory — and `src` is not published, so a consumer's debugger
// resolves them to nothing. The original text is already embedded in
// `sourcesContent`, so rewrite the labels to stay inside `dist` and refuse to
// rewrite a map that has no embedded content to fall back on.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

for (const name of readdirSync(dist).filter((entry) =>
  entry.endsWith(".map"),
)) {
  const file = path.join(dist, name);
  const map = JSON.parse(readFileSync(file, "utf8"));
  const sources = map.sources ?? [];
  if (sources.length === 0) continue;
  assert.equal(
    (map.sourcesContent ?? []).length,
    sources.length,
    `${name} has no embedded sourcesContent; refusing to rewrite its source paths`,
  );
  delete map.sourceRoot;
  map.sources = sources.map((source) =>
    path.posix.normalize(source).replace(/^(\.\.\/)+/, ""),
  );
  for (const source of map.sources) {
    assert(
      !path.isAbsolute(source) && !source.startsWith(".."),
      `${name} still references ${source} outside dist`,
    );
  }
  writeFileSync(file, `${JSON.stringify(map)}\n`);
}
