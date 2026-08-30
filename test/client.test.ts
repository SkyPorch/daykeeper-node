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
