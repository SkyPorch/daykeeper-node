import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  DaykeeperApiError,
  DaykeeperClient,
  DaykeeperTransportError,
  type DaykeeperCapabilities,
  type InboxChannel,
  type WebsiteChannel,
  type WebsiteInboxSpec,
} from "../src/index.ts";

const channel: WebsiteChannel = {
  id: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  tenantId: "20000000-0000-4000-8000-000000000001",
  spec: {
    websiteUrl: "https://example.test/",
    allowedOrigins: ["https://example.test"],
  },
  state: "prepared",
  trafficEnabled: false,
  version: 2,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:01:00.000Z",
};

test("API inbox reads use the dedicated path and preserve auth, encoding, and metadata", async () => {
  const requests: Request[] = [];
  const inbox: InboxChannel = {
    ...channel,
    spec: { type: "api" },
    trafficEnabled: false,
  };
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test/daykeeper-api",
    apiKey: "machine-api-key",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({ data: inbox });
    },
  });
  assert.deepEqual(await client.inboxes.get("tenant/one"), inbox);
  assert.equal(
    requests[0]?.url,
    "https://api.example.test/daykeeper-api/v1/tenants/tenant%2Fone/inbox",
  );
  assert.equal(requests[0]?.method, "GET");
  assert.equal(
    requests[0]?.headers.get("authorization"),
    "Bearer machine-api-key",
  );
  assert.equal(await requests[0]?.text(), "");
});

test("API inbox planning sends only the requested API desired state", async () => {
  const spec = {
    name: "Support",
    slug: "support",
    locale: "en",
    inbox: { type: "api" as const },
  };
  let calls = 0;
  const client = new DaykeeperClient({
    apiKey: "synthetic-key",
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      calls++;
      assert.equal(new URL(String(input)).pathname, "/v1/tenant-plans");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.credentials, "omit");
      assert.deepEqual(JSON.parse(String(init?.body)), spec);
      return Response.json({ data: { id: "plan-1", spec } });
    },
  });
  assert.deepEqual((await client.tenants.plan(spec)).spec, spec);
  assert.equal(calls, 1);
});

test("management SDK refuses real redirects without forwarding a request to their target", async (t) => {
  let targetCalls = 0;
  let initialCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === "/redirect-target") {
      targetCalls++;
      response.end(JSON.stringify({ data: {} }));
      return;
    }
    initialCalls++;
    response.writeHead(307, { location: "/redirect-target" });
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new DaykeeperClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: "synthetic-key",
  });
  await assert.rejects(client.inboxes.get("tenant-1"), {
    code: "NETWORK_ERROR",
  });
  await assert.rejects(
    client.tenants.plan({
      name: "Support",
      slug: "support",
      locale: "en",
      inbox: { type: "api" },
    }),
    { code: "NETWORK_ERROR", outcomeUnknown: true },
  );
  assert.equal(initialCalls, 2);
  assert.equal(targetCalls, 0);
});

test("website and entitlement reads preserve proxy prefixes, encode tenant paths, and never mutate", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test/daykeeper-api",
    token: "test-management-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({
        data: request.url.endsWith("/entitlements")
          ? { state: "unconfigured" }
          : channel,
      });
    },
  });
  assert.deepEqual(await client.websiteChannels.get("tenant/one"), channel);
  assert.equal((await client.entitlements.get()).state, "unconfigured");
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://api.example.test/daykeeper-api/v1/tenants/tenant%2Fone/website-channel",
      "https://api.example.test/daykeeper-api/v1/entitlements",
    ],
  );
  for (const request of requests) {
    assert.equal(request.method, "GET");
    assert.equal(
      request.headers.get("authorization"),
      "Bearer test-management-token",
    );
    assert.equal(await request.text(), "");
  }
  assert.deepEqual(Object.keys(client.websiteChannels), ["get"]);
  assert.deepEqual(Object.keys(client.entitlements), ["get"]);
});

test("website settings remain optional in existing tenant plan requests and server normalization stays authoritative", async () => {
  const bodies: unknown[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test",
    token: "token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.method, "POST");
      assert.equal(request.url, "https://api.example.test/v1/tenant-plans");
      bodies.push(await request.json());
      return Response.json({ data: { id: "plan-id" } });
    },
  });
  const account = {
    name: "Workspace",
    slug: "workspace",
    locale: "en",
    administrator: { name: "Owner", email: "owner@example.test" },
  };
  const website: WebsiteInboxSpec = { websiteUrl: "https://EXAMPLE.test:443/" };
  await client.tenants.plan(account);
  await client.tenants.plan({ ...account, website });
  assert.deepEqual(bodies, [account, { ...account, website }]);
});

test("machine-owned tenant plans may omit legacy administrator metadata", async () => {
  let body: unknown;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test",
    token: "token",
    fetch: async (_input, init) => {
      body = await new Request(_input, init).json();
      return Response.json({ data: { id: "plan-id" } });
    },
  });
  await client.tenants.plan({
    name: "Machine workspace",
    slug: "machine-workspace",
    locale: "en",
  });
  assert.deepEqual(body, {
    name: "Machine workspace",
    slug: "machine-workspace",
    locale: "en",
  });
});

test("older capability responses remain compatible and do not imply website or traffic support", async () => {
  const capabilities: DaykeeperCapabilities = {
    apiVersion: "v1",
    emailChannels: { enabled: false },
    customerSessions: { enabled: true },
    flows: { schemaVersion: "2026-08-01", execution: "management_only" },
  };
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test",
    token: "token",
    fetch: async () => Response.json({ data: capabilities }),
  });
  assert.equal((await client.capabilities()).websiteInboxes, undefined);
});

test("pre-aborted preparation reads never acquire credentials or dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test",
    token: () => {
      assert.fail("Unexpected token acquisition");
    },
    fetch: async () => {
      assert.fail("Unexpected request");
    },
  });
  for (const call of [
    () =>
      client.websiteChannels.get(channel.tenantId, {
        signal: controller.signal,
      }),
    () => client.inboxes.get(channel.tenantId, { signal: controller.signal }),
    () => client.entitlements.get({ signal: controller.signal }),
    () =>
      client.tenants.getProvisioningOperation(channel.tenantId, {
        signal: controller.signal,
      }),
  ]) {
    await assert.rejects(
      call(),
      (error) =>
        error instanceof DaykeeperTransportError &&
        error.code === "REQUEST_ABORTED",
    );
  }
});

test("tenant operation discovery preserves proxy prefixes, path encoding and read-only transport", async () => {
  const operation = {
    id: "operation-id",
    organizationId: channel.organizationId,
    tenantId: channel.tenantId,
    kind: "tenant.provision",
    state: "queued",
  };
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test/daykeeper-api",
    token: "test-management-token",
    fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(
        request.url,
        "https://api.example.test/daykeeper-api/v1/tenants/tenant%2Fone/provisioning-operation",
      );
      assert.equal(request.method, "GET");
      assert.equal(
        request.headers.get("authorization"),
        "Bearer test-management-token",
      );
      assert.equal(await request.text(), "");
      return Response.json({ data: operation });
    },
  });
  assert.deepEqual(
    await client.tenants.getProvisioningOperation("tenant/one"),
    operation,
  );
  assert.equal(calls, 1);
});

test("tenant operation discovery preserves authorization and missing-resource errors without another write", async () => {
  for (const [status, code] of [
    [403, "SCOPE_REQUIRED"],
    [404, "RESOURCE_NOT_FOUND"],
  ] as const) {
    let calls = 0;
    const client = new DaykeeperClient({
      baseUrl: "https://api.example.test",
      token: "test-management-token",
      fetch: async (_input, init) => {
        calls++;
        assert.equal(init?.method ?? "GET", "GET");
        return Response.json(
          {
            error: {
              code,
              message: "Operation unavailable",
              retryable: false,
              nextActions: [],
              correlationId: "request-1",
            },
          },
          { status },
        );
      },
    });
    await assert.rejects(
      client.tenants.getProvisioningOperation(channel.tenantId),
      (error) => error instanceof DaykeeperApiError && error.code === code,
    );
    assert.equal(calls, 1);
  }
});

test("website authorization and missing-resource errors stay structured without a fallback mutation", async () => {
  for (const [status, code] of [
    [403, "SCOPE_REQUIRED"],
    [404, "RESOURCE_NOT_FOUND"],
    [503, "FEATURE_UNAVAILABLE"],
  ] as const) {
    let calls = 0;
    const client = new DaykeeperClient({
      baseUrl: "https://api.example.test",
      token: "token",
      fetch: async (_input, init) => {
        calls++;
        assert.equal(init?.method ?? "GET", "GET");
        return Response.json(
          {
            error: {
              code,
              message: "Website unavailable",
              retryable: false,
              nextActions: ["inspect_capabilities"],
              correlationId: "request-1",
            },
          },
          { status },
        );
      },
    });
    await assert.rejects(
      client.websiteChannels.get(channel.tenantId),
      (error) =>
        error instanceof DaykeeperApiError &&
        error.status === status &&
        error.code === code &&
        error.correlationId === "request-1",
    );
    assert.equal(calls, 1);
  }
});

test("website reads preserve the one-refresh request budget without inferring traffic readiness from state", async () => {
  const tokens: boolean[] = [];
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test",
    token: (request) => {
      tokens.push(request?.forceRefresh ?? false);
      return "test-token";
    },
    fetch: async () =>
      ++calls === 1
        ? new Response(null, { status: 401 })
        : Response.json({
            data: { ...channel, state: "future-state", trafficEnabled: false },
          }),
  });
  const result = await client.websiteChannels.get(channel.tenantId);
  assert.deepEqual(tokens, [false, true]);
  assert.equal(calls, 2);
  assert.equal(result.state, "future-state");
  assert.equal(result.trafficEnabled, false);
});
