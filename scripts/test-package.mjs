import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), "daykeeper-package-test-"));
function run(command, args, cwd = directory) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${command} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

try {
  // Build precedes this check. Packing/installing never executes package scripts
  // and the consumer installation is offline: no registry or credentials needed.
  const [packed] = JSON.parse(
    run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
      root,
    ),
  );
  assert.equal(packed.name, "@skyporch/daykeeper");
  assert.deepEqual(packed.files.map((file) => file.path).sort(), [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "dist/index.cjs",
    "dist/index.cjs.map",
    "dist/index.d.cts",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/index.js.map",
    "package.json",
  ]);
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "daykeeper-package-consumer-test",
      private: true,
      type: "module",
    }),
  );
  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    path.join(directory, packed.filename),
  ]);
  const installed = JSON.parse(
    readFileSync(
      path.join(directory, "node_modules/@skyporch/daykeeper/package.json"),
      "utf8",
    ),
  );
  assert.equal(installed.version, packed.version);
  assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
  writeFileSync(
    path.join(directory, "consumer.mjs"),
    `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { DaykeeperClient as EsmClient } from '@skyporch/daykeeper';
    const { DaykeeperClient: CjsClient } = createRequire(import.meta.url)('@skyporch/daykeeper');
    for (const Client of [EsmClient, CjsClient]) {
      const paths = [];
      const client = new Client({ baseUrl: 'https://api.example.test', token: 'synthetic-token', fetch: async (input, init) => {
        assert.equal(init?.method ?? 'GET', 'GET');
        const path = new URL(input).pathname;
        paths.push(path);
        return Response.json({ data: path.endsWith('/entitlements') ? { state: 'unconfigured' } : { state: 'prepared', trafficEnabled: false } });
      } });
      assert.equal((await client.entitlements.get()).state, 'unconfigured');
      assert.equal((await client.websiteChannels.get('tenant/one')).trafficEnabled, false);
      assert.deepEqual(paths, ['/v1/entitlements', '/v1/tenants/tenant%2Fone/website-channel']);
      assert.deepEqual(Object.keys(client.websiteChannels), ['get']);
    }
  `,
  );
  run(process.execPath, ["consumer.mjs"]);
  writeFileSync(
    path.join(directory, "consumer.mts"),
    `
    import { DaykeeperClient, type WebsiteInboxSpec, type WebsiteChannel, type EntitlementStatus } from '@skyporch/daykeeper';
    const client = new DaykeeperClient({ baseUrl: 'https://example.test', token: 'test-token' });
    const channel: Promise<WebsiteChannel> = client.websiteChannels.get('tenant');
    const entitlements: Promise<EntitlementStatus> = client.entitlements.get();
    const spec: WebsiteInboxSpec = { websiteUrl: 'https://example.test' };
    // @ts-expect-error Provider security settings are not public overrides.
    const unsafe: WebsiteInboxSpec = { websiteUrl: 'https://example.test', hmacMandatory: false };
    // @ts-expect-error Preparation does not expose an activation operation.
    client.websiteChannels.activate('tenant');
    void channel; void entitlements; void spec; void unsafe;
  `,
  );
  writeFileSync(
    path.join(directory, "consumer.cts"),
    `
    import sdk = require('@skyporch/daykeeper');
    const client = new sdk.DaykeeperClient({ baseUrl: 'https://example.test', token: 'test-token' });
    const channel: Promise<sdk.WebsiteChannel> = client.websiteChannels.get('tenant');
    void channel;
  `,
  );
  run(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "consumer.mts",
    "consumer.cts",
  ]);
  console.log(
    `Packed ${packed.name}@${packed.version}: offline ESM, CommonJS and both declaration consumers passed`,
  );
} finally {
  // Only the exact fresh directory owned by this invocation is removed.
  rmSync(directory, { recursive: true, force: true });
}
