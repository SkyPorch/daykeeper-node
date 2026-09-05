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
    env: {
      ...process.env,
      npm_config_cache: path.join(directory, "npm-cache"),
      npm_config_update_notifier: "false",
    },
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
    import * as esm from '@skyporch/daykeeper';
    const cjs = createRequire(import.meta.url)('@skyporch/daykeeper');
    const EsmClient = esm.DaykeeperClient;
    const CjsClient = cjs.DaykeeperClient;
    for (const sdk of [esm, cjs]) {
      const signer = await sdk.DaykeeperMachineSigner.generate();
      const restored = await sdk.DaykeeperMachineSigner.fromPrivateKey(await signer.exportPrivateKey());
      assert.deepEqual(restored.publicKey, signer.publicKey);
      let calls = 0;
      const onboarding = new sdk.DaykeeperOnboardingClient({ baseUrl: 'https://api.example.test', fetch: async (url, init) => {
        calls++;
        assert.equal(new URL(url).pathname, '/v1/machine-enrollments/challenges');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'error');
        assert.equal(new Headers(init.headers).has('authorization'), false);
        return Response.json({error:{code:'BOOTSTRAP_UNAVAILABLE',message:'untrusted'}}, {status:503});
      }});
      await assert.rejects(() => onboarding.enrollments.challenge({name:'Acme',idempotencyKey:'signup-intent-0001',publicKey:signer.publicKey}), error => error instanceof sdk.DaykeeperOnboardingApiError && error.outcomeUnknown && !error.retryable && !error.message.includes('untrusted'));
      assert.equal(calls, 1);
    }
    for (const Client of [EsmClient, CjsClient]) {
      const paths = [];
      const client = new Client({ baseUrl: 'https://api.example.test', apiKey: 'synthetic-api-key', fetch: async (input, init) => {
        assert.equal(init?.method ?? 'GET', 'GET');
        const path = new URL(input).pathname;
        paths.push(path);
        return Response.json({ data: path.endsWith('/provisioning-operation') ? { id: 'operation-id', kind: 'tenant.provision', state: 'queued' } : path.endsWith('/usage') ? { state: 'unconfigured', writeAdmission: 'not_evaluated' } : path.endsWith('/entitlements') ? { state: 'unconfigured' } : { state: 'prepared', trafficEnabled: false } });
      } });
      assert.equal((await client.entitlements.get()).state, 'unconfigured');
      assert.equal((await client.websiteChannels.get('tenant/one')).trafficEnabled, false);
      assert.equal((await client.usage.get()).writeAdmission, 'not_evaluated');
      assert.equal((await client.tenants.getProvisioningOperation('tenant/one')).id, 'operation-id');
      assert.deepEqual(paths, ['/v1/entitlements', '/v1/tenants/tenant%2Fone/website-channel', '/v1/usage', '/v1/tenants/tenant%2Fone/provisioning-operation']);
      assert.deepEqual(Object.keys(client.websiteChannels), ['get']);
      assert.deepEqual(Object.keys(client.usage), ['get']);
      assert.deepEqual(Object.keys(client.agentCredentials), ['list', 'create', 'revoke']);
    }
  `,
  );
  run(process.execPath, ["consumer.mjs"]);
  writeFileSync(
    path.join(directory, "consumer.mts"),
    `
    import { DaykeeperClient, type AgentCredentialPage, type CreateAgentCredentialResult, type WebsiteInboxSpec, type WebsiteChannel, type EntitlementStatus, type UsageStatus, type UsageResourceStatus, type Operation } from '@skyporch/daykeeper';
    const client = new DaykeeperClient({ baseUrl: 'https://example.test', token: 'test-token' });
    import { DaykeeperOnboardingClient, DaykeeperMachineSigner, type MachineChallenge } from '@skyporch/daykeeper';
    const onboarding = new DaykeeperOnboardingClient({baseUrl:'https://example.test'});
    const signer = await DaykeeperMachineSigner.generate();
    const intent = {name:'Acme',idempotencyKey:'signup-intent-0001',publicKey:signer.publicKey};
    const challenge: MachineChallenge = await onboarding.enrollments.challenge(intent);
    const proof: string = await signer.signEnrollment(challenge,intent,{audience:'https://example.test/enrollment'});
    // @ts-expect-error Onboarding must not accept a management credential.
    new DaykeeperOnboardingClient({baseUrl:'https://example.test',apiKey:'secret'});
    void proof;
    const machineInboxPlan = client.tenants.plan({name:'Acme',slug:'acme',locale:'en',website:{websiteUrl:'https://example.test'}});
    void machineInboxPlan;
    const agent = new DaykeeperClient({ baseUrl: 'https://example.test', apiKey: 'test-api-key' });
    const channel: Promise<WebsiteChannel> = client.websiteChannels.get('tenant');
    const operation: Promise<Operation> = client.tenants.getProvisioningOperation('tenant', {signal: AbortSignal.timeout(5000)});
    const entitlements: Promise<EntitlementStatus> = client.entitlements.get();
    const usage: Promise<UsageStatus> = client.usage.get({signal: AbortSignal.timeout(5000)});
    const credentials: Promise<AgentCredentialPage> = client.agentCredentials.list({signal: AbortSignal.timeout(5000)});
    const created: Promise<CreateAgentCredentialResult> = client.agentCredentials.create({name:'Production MCP',scopes:['daykeeper.accounts:read']},{idempotencyKey:'credential-create-0001'});
    const counter: UsageResourceStatus = {used:0,limit:null,remaining:null,limitReached:null};
    // @ts-expect-error Usage does not accept an organization selector.
    client.usage.get({organizationId:'other'});
    // @ts-expect-error Usage does not expose a reset operation.
    client.usage.reset();
    const spec: WebsiteInboxSpec = { websiteUrl: 'https://example.test' };
    // @ts-expect-error Provider security settings are not public overrides.
    const unsafe: WebsiteInboxSpec = { websiteUrl: 'https://example.test', hmacMandatory: false };
    // @ts-expect-error Preparation does not expose an activation operation.
    client.websiteChannels.activate('tenant');
    // @ts-expect-error Static API keys and OAuth tokens are mutually exclusive.
    new DaykeeperClient({baseUrl:'https://example.test',apiKey:'key',token:'token'});
    // @ts-expect-error Agent credentials cannot delegate credential administration.
    client.agentCredentials.create({name:'Overbroad',scopes:['daykeeper.credentials:write']},{idempotencyKey:'credential-create-0002'});
    void channel; void entitlements; void spec; void unsafe; void usage; void counter; void operation; void credentials; void created;
  `,
  );
  writeFileSync(
    path.join(directory, "consumer.cts"),
    `
    import sdk = require('@skyporch/daykeeper');
    const client = new sdk.DaykeeperClient({ baseUrl: 'https://example.test', token: 'test-token' });
    const onboarding = new sdk.DaykeeperOnboardingClient({baseUrl:'https://example.test'});
    async function signupTypes() {
      const signer = await sdk.DaykeeperMachineSigner.generate();
      const intent = {name:'Acme',idempotencyKey:'signup-intent-0001',publicKey:signer.publicKey};
      const challenge: sdk.MachineChallenge = await onboarding.enrollments.challenge(intent);
      return signer.signEnrollment(challenge,intent,{audience:'https://example.test/enrollment'});
    }
    void signupTypes;
    const machineInboxPlan = client.tenants.plan({name:'Acme',slug:'acme',locale:'en',website:{websiteUrl:'https://example.test'}});
    void machineInboxPlan;
    const channel: Promise<sdk.WebsiteChannel> = client.websiteChannels.get('tenant');
    const operation: Promise<sdk.Operation> = client.tenants.getProvisioningOperation('tenant');
    const usage: Promise<sdk.UsageStatus> = client.usage.get();
    const agent = new sdk.DaykeeperClient({ baseUrl: 'https://example.test', apiKey: 'test-api-key' });
    const credentials: Promise<sdk.AgentCredentialPage> = client.agentCredentials.list();
    void channel; void usage; void operation; void credentials;
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
