import assert from "node:assert/strict";
import test from "node:test";
import {
  DaykeeperApiError,
  DaykeeperClient,
  DaykeeperTransportError,
} from "../src/index.ts";

test("sends authenticated requests and unwraps success envelopes", async () => {
  let request: Request | undefined;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: async () => "secret-token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        data: {
          apiVersion: "v1",
          emailChannels: { enabled: true },
          customerSessions: { enabled: true },
          flows: { schemaVersion: "2026-08-01", execution: "management_only" },
        },
      });
    },
  });

  const result = await client.capabilities();

  assert.equal(result.apiVersion, "v1");
  assert.equal(request?.url, "https://api.daykeeper.example/v1/capabilities");
  assert.equal(request?.headers.get("authorization"), "Bearer secret-token");
  assert.equal(request?.headers.get("accept"), "application/json");
});

test("creates a purpose-limited customer session without exposing the signing key", async () => {
  let request: Request | undefined;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "management-token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        data: {
          token: "customer-session-token",
          tokenType: "Bearer",
          purpose: "customer",
          expiresAt: "2026-08-27T12:05:00.000Z",
        },
      });
    },
  });

  const session = await client.customerSessions.create("tenant/acme", {
    purpose: "customer",
    subject: "customer-user-1",
    email: "member@example.com",
    locale: "en",
    country: "GB",
    paymentProvider: "apple_iap",
  });

  assert.equal(session.token, "customer-session-token");
  assert.equal(
    request?.url,
    "https://api.daykeeper.example/v1/tenants/tenant%2Facme/customer-sessions",
  );
  assert.equal(
    request?.headers.get("authorization"),
    "Bearer management-token",
  );
  assert.deepEqual(await request?.json(), {
    purpose: "customer",
    subject: "customer-user-1",
    email: "member@example.com",
    locale: "en",
    country: "GB",
    paymentProvider: "apple_iap",
  });
});

test("sends idempotency keys separately from apply bodies", async () => {
  let request: Request | undefined;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "secret-token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        data: { tenant: {}, operation: {}, replayed: false },
      });
    },
  });

  await client.tenants.apply(
    { planId: "plan-id", planVersion: 1 },
    { idempotencyKey: "agent-run-123456" },
  );

  assert.equal(request?.url, "https://api.daykeeper.example/v1/tenants:apply");
  assert.equal(request?.headers.get("idempotency-key"), "agent-run-123456");
  assert.deepEqual(await request?.json(), {
    planId: "plan-id",
    planVersion: 1,
  });
});

test("creates reveal-once agent credentials with explicit idempotency", async () => {
  let request: Request | undefined;
  const credential = {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    name: "Production MCP",
    hint: "dk_agent_30000000…CQkJ",
    scopes: ["daykeeper.accounts:read" as const],
    state: "active" as const,
    expiresAt: "2026-10-01T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "owner-token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json(
        {
          data: {
            credential,
            token: `dk_agent_${credential.id.replaceAll("-", "")}_${"A".repeat(43)}`,
            replayed: false,
          },
        },
        { status: 201 },
      );
    },
  });

  const result = await client.agentCredentials.create(
    {
      name: "Production MCP",
      scopes: ["daykeeper.accounts:read"],
      validityDays: 30,
    },
    { idempotencyKey: "credential-create-0001" },
  );

  assert.equal(
    request?.url,
    "https://api.daykeeper.example/v1/agent-credentials",
  );
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers.get("authorization"), "Bearer owner-token");
  assert.equal(
    request?.headers.get("idempotency-key"),
    "credential-create-0001",
  );
  assert.deepEqual(await request?.json(), {
    name: "Production MCP",
    scopes: ["daykeeper.accounts:read"],
    validityDays: 30,
  });
  assert.equal(result.credential.id, credential.id);
  assert.match(result.token ?? "", /^dk_agent_/);
  assert.equal(result.replayed, false);
});

test("accepts a conventional apiKey without weakening OAuth token providers", async () => {
  let authorization: string | null = null;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    apiKey: "dk_agent_static-example",
    fetch: async (input, init) => {
      authorization = new Request(input, init).headers.get("authorization");
      return Response.json({ data: { items: [], hasMore: false } });
    },
  });

  await client.agentCredentials.list();
  assert.equal(authorization, "Bearer dk_agent_static-example");
  assert.throws(
    () =>
      new DaykeeperClient({
        baseUrl: "https://api.daykeeper.example",
        apiKey: "api-key",
        token: "oauth-token",
        fetch,
      } as unknown as ConstructorParameters<typeof DaykeeperClient>[0]),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "INVALID_CONFIGURATION",
  );
});

test("preserves null secrets on exact agent credential create replays", async () => {
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "owner-token",
    fetch: async () =>
      Response.json({
        data: {
          credential: {
            id: "30000000-0000-4000-8000-000000000001",
            organizationId: "10000000-0000-4000-8000-000000000001",
            name: "Production MCP",
            hint: "dk_agent_30000000…CQkJ",
            scopes: ["daykeeper.accounts:read"],
            state: "active",
            expiresAt: "2026-10-01T00:00:00.000Z",
            lastUsedAt: null,
            revokedAt: null,
            createdAt: "2026-09-01T00:00:00.000Z",
          },
          token: null,
          replayed: true,
        },
      }),
  });

  const result = await client.agentCredentials.create(
    { name: "Production MCP", scopes: ["daykeeper.accounts:read"] },
    { idempotencyKey: "credential-create-0001" },
  );

  assert.equal(result.token, null);
  assert.equal(result.replayed, true);
});

test("lists metadata and revokes without sending or recovering secrets", async () => {
  const requests: Request[] = [];
  const credential = {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    name: "Production MCP",
    hint: "dk_agent_30000000…CQkJ",
    scopes: ["daykeeper.accounts:read" as const],
    state: "active" as const,
    expiresAt: "2026-10-01T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "owner-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === "GET") {
        return Response.json({ data: { items: [credential], hasMore: false } });
      }
      return Response.json({
        data: {
          credential: {
            ...credential,
            state: "revoked",
            revokedAt: "2026-09-02T00:00:00.000Z",
          },
          replayed: false,
        },
      });
    },
  });

  const page = await client.agentCredentials.list();
  const revoked = await client.agentCredentials.revoke(credential.id);

  assert.deepEqual(page, { items: [credential], hasMore: false });
  assert.equal("token" in page.items[0], false);
  assert.equal(revoked.credential.state, "revoked");
  assert.deepEqual(
    requests.map((item) => [item.method, item.url]),
    [
      ["GET", "https://api.daykeeper.example/v1/agent-credentials"],
      [
        "POST",
        `https://api.daykeeper.example/v1/agent-credentials/${credential.id}/revoke`,
      ],
    ],
  );
  assert.deepEqual(await requests[1]?.json(), {});
  assert.equal(requests[1]?.headers.has("idempotency-key"), false);
});

test("does not automatically retry an uncertain agent credential create", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "owner-token",
    fetch: async () => {
      calls += 1;
      throw new Error("synthetic uncertain response");
    },
  });

  await assert.rejects(
    client.agentCredentials.create(
      { name: "Production MCP", scopes: ["daykeeper.accounts:read"] },
      { idempotencyKey: "credential-create-0001" },
    ),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "NETWORK_ERROR",
  );
  assert.equal(calls, 1);
});

test("supports cancelling agent credential operations", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "owner-token",
    fetch: async () => {
      called = true;
      return Response.json({ data: {} });
    },
  });

  await assert.rejects(
    client.agentCredentials.list({ signal: controller.signal }),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "REQUEST_ABORTED",
  );
  assert.equal(called, false);
});

test("refreshes a provider token once after an authentication rejection", async () => {
  const tokenRequests: boolean[] = [];
  const authorization: (string | null)[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: ({ forceRefresh } = { forceRefresh: false }) => {
      tokenRequests.push(forceRefresh);
      return forceRefresh ? "fresh-token" : "stale-token";
    },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      authorization.push(request.headers.get("authorization"));
      return authorization.length === 1
        ? Response.json({ error: { code: "TOKEN_EXPIRED" } }, { status: 401 })
        : Response.json({ data: [] });
    },
  });

  assert.deepEqual(await client.tenants.list(), []);
  assert.deepEqual(tokenRequests, [false, true]);
  assert.deepEqual(authorization, ["Bearer stale-token", "Bearer fresh-token"]);
});

test("returns structured API errors without exposing credentials", async () => {
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "do-not-leak",
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "RESOURCE_VERSION_CONFLICT",
            message: "The resource changed",
            retryable: false,
            nextActions: ["read_latest_version"],
            correlationId: "request-1",
            fields: ["expectedResourceVersion"],
          },
        },
        { status: 409 },
      ),
  });

  await assert.rejects(client.flows.get("flow-id"), (error) => {
    assert(error instanceof DaykeeperApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "RESOURCE_VERSION_CONFLICT");
    assert.equal(error.correlationId, "request-1");
    assert(!JSON.stringify(error).includes("do-not-leak"));
    return true;
  });
});

test("rejects insecure remote base URLs", () => {
  assert.throws(
    () =>
      new DaykeeperClient({
        baseUrl: "http://api.daykeeper.example",
        token: "token",
        fetch,
      }),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "INVALID_CONFIGURATION",
  );
});

test("preserves an explicit reverse-proxy base path", async () => {
  let request: Request | undefined;
  const client = new DaykeeperClient({
    baseUrl: "https://support.daykeeper.example/daykeeper-api",
    token: "token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({ data: [] });
    },
  });

  await client.tenants.list();
  assert.equal(
    request?.url,
    "https://support.daykeeper.example/daykeeper-api/v1/tenants",
  );
});

test("validates idempotency keys before sending a request", async () => {
  let called = false;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "token",
    fetch: async () => {
      called = true;
      return Response.json({ data: {} });
    },
  });

  await assert.rejects(
    client.tenants.apply(
      { planId: "plan-id", planVersion: 1 },
      { idempotencyKey: "too-short" },
    ),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "INVALID_CONFIGURATION",
  );
  assert.equal(called, false);
});

test("permits HTTP only on loopback development URLs", async () => {
  const client = new DaykeeperClient({
    baseUrl: "http://127.0.0.1:3000",
    token: "token",
    fetch: async () => Response.json({ data: [] }),
  });

  assert.deepEqual(await client.tenants.list(), []);
});

test("stops reading oversized responses", async () => {
  const oversized = new Uint8Array(1024 * 1024 + 1);
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "token",
    fetch: async () => new Response(oversized),
  });

  await assert.rejects(client.tenants.list(), (error) => {
    assert(error instanceof DaykeeperTransportError);
    assert.equal(error.code, "RESPONSE_TOO_LARGE");
    return true;
  });
});

test("uses stable encoded flow paths and version numbers", async () => {
  const urls: string[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "token",
    fetch: async (input, init) => {
      urls.push(new Request(input, init).url);
      return Response.json({ data: {} });
    },
  });

  await client.flows.getVersion("flow/one", 2);
  await client.flows.publishVersion("flow/one", 2, {
    expectedResourceVersion: 4,
  });

  assert.deepEqual(urls, [
    "https://api.daykeeper.example/v1/flows/flow%2Fone/versions/2",
    "https://api.daykeeper.example/v1/flows/flow%2Fone/versions/2/publish",
  ]);
});
