// Verifies that `npm pack` is reproducible and that the published tarball
// contains only intended files. Node 20+, ESM, no dependencies.
//
// The tarball itself is NOT hashed: gzip embeds a timestamp, so two identical
// packs differ byte-for-byte. Both packs are extracted instead and every
// entry's content bytes are hashed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
    },
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

function pack(label) {
  const directory = mkdtempSync(path.join(tmpdir(), `daykeeper-pack-${label}-`));
  const [packed] = JSON.parse(
    run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
      root,
    ),
  );
  const extracted = path.join(directory, "extracted");
  run("mkdir", ["-p", extracted], directory);
  // tar -x, then hash file bytes; mtime is never read.
  run("tar", ["-x", "-f", path.join(directory, packed.filename), "-C", extracted], directory);
  return { directory, packed, root: path.join(extracted, "package") };
}

function walk(base, prefix = "") {
  const entries = [];
  for (const name of readdirSync(base).sort()) {
    const absolute = path.join(base, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (statSync(absolute).isDirectory()) {
      entries.push(...walk(absolute, relative));
    } else {
      entries.push(relative);
    }
  }
  return entries;
}

function digestTree(base) {
  const digests = new Map();
  for (const relative of walk(base)) {
    digests.set(
      relative,
      createHash("sha256").update(readFileSync(path.join(base, relative))).digest("hex"),
    );
  }
  return digests;
}

const first = pack("a");
const second = pack("b");

try {
  // 1. Reproducibility: same file list, same content hashes.
  const a = digestTree(first.root);
  const b = digestTree(second.root);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  const diff = [];
  for (const name of names) {
    const left = a.get(name);
    const right = b.get(name);
    if (left === right) continue;
    if (!left) diff.push(`  + ${name} (only in the second pack)`);
    else if (!right) diff.push(`  - ${name} (only in the first pack)`);
    else diff.push(`  ~ ${name}\n      first:  ${left}\n      second: ${right}`);
  }
  if (diff.length > 0) {
    failures.push(`npm pack is not reproducible:\n${diff.join("\n")}`);
  }

  // 2. No test or fixture paths may ship.
  const forbidden = [
    /(^|\/)tests?\//,
    /(^|\/)__tests__\//,
    /(^|\/)fixtures\//,
    /(^|\/)smoke\//,
    /\.test\.[^/]+$/,
  ];
  const leaked = names.filter((name) => forbidden.some((pattern) => pattern.test(name)));
  if (leaked.length > 0) {
    failures.push(`Test or fixture paths are packed:\n${leaked.map((n) => `  ${n}`).join("\n")}`);
  }

  // 3. Every source map must reference files inside the published dist.
  for (const name of names.filter((n) => n.endsWith(".map"))) {
    let map;
    try {
      map = JSON.parse(readFileSync(path.join(first.root, name), "utf8"));
    } catch (error) {
      failures.push(`${name} is not readable JSON: ${error.message}`);
      continue;
    }
    const mapDirectory = path.posix.dirname(name);
    for (const source of map.sources ?? []) {
      if (path.isAbsolute(source) || /^[a-zA-Z]:[\\/]/.test(source) || /^\w+:\/\//.test(source)) {
        failures.push(`${name} has an absolute source path: ${source}`);
        continue;
      }
      const resolved = path.posix.normalize(path.posix.join(mapDirectory, source));
      if (!resolved.startsWith("dist/")) {
        failures.push(`${name} escapes dist with source: ${source} -> ${resolved}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`verify-pack failed:\n\n${failures.join("\n\n")}`);
    process.exitCode = 1;
  } else {
    console.log(
      `verify-pack: ${first.packed.name}@${first.packed.version} packs reproducibly ` +
        `(${names.length} files), no test or fixture paths, all source maps stay inside dist`,
    );
  }
} finally {
  // Only the exact fresh directories owned by this invocation are removed.
  rmSync(first.directory, { recursive: true, force: true });
  rmSync(second.directory, { recursive: true, force: true });
}
