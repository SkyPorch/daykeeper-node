import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DaykeeperClient,
  type AgentCredential,
  type CreateAgentCredentialInput,
} from "../src/index.js";

const previous = {
  id: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  tenantId: null,
  name: "Production server",
  hint: "dk_agent_30000000…CQkJ",
  scopes: ["daykeeper.accounts:read" as const],
  state: "active" as const,
  expiresAt: "2026-09-24T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-09-19T00:00:00.000Z",
  rotatedFromId: null,
  replacedById: "30000000-0000-4000-8000-000000000002",
  replacedAt: "2026-09-23T00:00:00.000Z",
};
const credential = {
  ...previous,
  id: "30000000-0000-4000-8000-000000000002",
  expiresAt: null,
  createdAt: "2026-09-23T00:00:00.000Z",
  rotatedFromId: previous.id,
  replacedById: null,
  replacedAt: null,
};

test("rotate posts the input with the caller's idempotency key and returns the new secret", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    apiKey: "dk_agent_static-example",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json(
        {
          data: {
            credential,
            previousCredential: previous,
            token: `dk_agent_${credential.id.replaceAll("-", "")}_${"A".repeat(43)}`,
            replayed: false,
          },
        },
        { status: 201 },
      );
    },
  });
  const result = await client.agentCredentials.rotate(
    previous.id,
    { overlapHours: 0 },
    { idempotencyKey: "credential-rotate-0001" },
  );
  const request = requests[0];
  assert.equal(
    request?.url,
    `https://api.daykeeper.example/v1/agent-credentials/${previous.id}/rotate`,
  );
  assert.equal(request?.method, "POST");
  assert.equal(
    request?.headers.get("idempotency-key"),
    "credential-rotate-0001",
  );
  assert.deepEqual(await request?.json(), { overlapHours: 0 });
  assert.equal(result.credential.rotatedFromId, previous.id);
  assert.equal(result.previousCredential.replacedById, credential.id);
  assert.match(result.token ?? "", /^dk_agent_/);

  await client.agentCredentials.rotate(
    previous.id,
    {},
    { idempotencyKey: "credential-rotate-0002" },
  );
  assert.deepEqual(await requests[1]?.json(), {});
});

test("rotate refuses to send without an idempotency key", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    apiKey: "dk_agent_static-example",
    fetch: async () => {
      calls += 1;
      return Response.json({}, { status: 500 });
    },
  });
  await assert.rejects(
    client.agentCredentials.rotate(
      previous.id,
      {},
      // A JavaScript caller can omit what the type requires.
      {} as { idempotencyKey: string },
    ),
  );
  assert.equal(calls, 0);
});

test("rotate does not automatically retry an uncertain response", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    apiKey: "dk_agent_static-example",
    fetch: async () => {
      calls += 1;
      throw new Error("synthetic uncertain response");
    },
  });
  await assert.rejects(
    client.agentCredentials.rotate(
      previous.id,
      {},
      { idempotencyKey: "credential-rotate-0003" },
    ),
  );
  assert.equal(calls, 1);
});

test("create input types keep the tenant and scope rules the server enforces", () => {
  const organizationWide: CreateAgentCredentialInput = {
    name: "Reporting",
    scopes: ["daykeeper.accounts:read", "daykeeper.customer-sessions:write"],
  };
  const tenantBound: CreateAgentCredentialInput = {
    name: "Support backend",
    tenantId: "20000000-0000-4000-8000-000000000001",
    scopes: ["daykeeper.customer-sessions:write", "daykeeper.lifecycle:write"],
  };
  // @ts-expect-error lifecycle and erasure scopes require tenantId
  const unbound: CreateAgentCredentialInput = {
    name: "Lifecycle without a tenant",
    scopes: ["daykeeper.lifecycle:write"],
  };
  // @ts-expect-error a tenant-bound key cannot administer the workspace
  const tooBroad: CreateAgentCredentialInput = {
    name: "Tenant key with account scopes",
    tenantId: "20000000-0000-4000-8000-000000000001",
    scopes: ["daykeeper.accounts:read"],
  };
  assert.equal(organizationWide.tenantId, undefined);
  assert.equal(tenantBound.scopes.length, 2);
  assert.ok(unbound && tooBroad);
});

test("a credential from a server before tenant-scoped keys still types", () => {
  const { tenantId: _omitted, ...older } = previous;
  const fromOlderServer: AgentCredential = older;
  // Absent means organization-wide.
  assert.equal(fromOlderServer.tenantId ?? null, null);
});
