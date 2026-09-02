import assert from "node:assert/strict";
import test from "node:test";
import {
  DaykeeperApiError,
  DaykeeperClient,
  DaykeeperTransportError,
  generateIdempotencyKey,
} from "../src/index.ts";
import { createRequestLifetime } from "../src/requestLifetime.ts";

const DEFINITION = {
  schemaVersion: "2026-08-01",
  conditions: [],
  actions: [],
} as never;

function flowResult(replayed: boolean) {
  return {
    flow: { id: "flow-1", latestVersion: 1, publishedVersion: null },
    version: { version: 1 },
    replayed,
  };
}

function makeClient(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: "management-token",
    fetch: fetchImpl,
    timeoutMs,
  });
}

test("flow mutations send the idempotency key as a header and expose replayed", async () => {
  const requests: Request[] = [];
  const client = makeClient(async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({ data: flowResult(false) }, { status: 201 });
  });

  const created = await client.flows.create(
    "tenant-1",
    { name: "Handoff", slug: "handoff", definition: DEFINITION },
    { idempotencyKey: "flow-create-key-000001" },
  );
  await client.flows.createVersion(
    "flow-1",
    { expectedLatestVersion: 1, definition: DEFINITION },
    { idempotencyKey: "flow-version-key-00001" },
  );
  await client.flows.publishVersion(
    "flow-1",
    2,
    { expectedResourceVersion: 2 },
    { idempotencyKey: "flow-publish-key-00001" },
  );

  assert.equal(created.replayed, false);
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://api.daykeeper.example/v1/tenants/tenant-1/flows",
      "https://api.daykeeper.example/v1/flows/flow-1/versions",
      "https://api.daykeeper.example/v1/flows/flow-1/versions/2/publish",
    ],
  );
  assert.deepEqual(
    requests.map((request) => request.headers.get("idempotency-key")),
    [
      "flow-create-key-000001",
      "flow-version-key-00001",
      "flow-publish-key-00001",
    ],
  );
  // The key travels in the header only; the contract body stays unchanged.
  assert.deepEqual(await requests[0]?.json(), {
    name: "Handoff",
    slug: "handoff",
    definition: DEFINITION,
  });
});

test("replaying the same key returns the original flow with replayed true", async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls++;
    return calls === 1
      ? Response.json({ data: flowResult(false) }, { status: 201 })
      : Response.json({ data: flowResult(true) }, { status: 200 });
  });
  const input = {
    name: "Handoff",
    slug: "handoff",
    definition: DEFINITION,
  };
  const options = { idempotencyKey: "flow-create-key-000002" };

  const first = await client.flows.create("tenant-1", input, options);
  const replay = await client.flows.create("tenant-1", input, options);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.flow.id, first.flow.id);
});

test("reusing a key for a different request surfaces the server code", async () => {
  const client = makeClient(async () =>
    Response.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "The idempotency key was reused for a different request",
          retryable: false,
          nextActions: ["use_new_idempotency_key"],
          correlationId: "correlation-1",
        },
      },
      { status: 409 },
    ),
  );

  await assert.rejects(
    client.flows.create(
      "tenant-1",
      { name: "Changed", slug: "changed", definition: DEFINITION },
      { idempotencyKey: "flow-create-key-000002" },
    ),
    (error) => {
      assert(error instanceof DaykeeperApiError);
      assert.equal(error.code, "IDEMPOTENCY_KEY_REUSED");
      assert.equal(error.status, 409);
      assert.equal(error.retryable, false);
      assert.equal(error.outcomeUnknown, false);
      assert.equal(error.correlationId, "correlation-1");
      assert.deepEqual(error.nextActions, ["use_new_idempotency_key"]);
      return true;
    },
  );
});

test("flow mutations refuse to send an invalid or missing idempotency key", async () => {
  let called = false;
  const client = makeClient(async () => {
    called = true;
    return Response.json({ data: flowResult(false) });
  });

  await assert.rejects(
    client.flows.create(
      "tenant-1",
      { name: "Handoff", slug: "handoff", definition: DEFINITION },
      { idempotencyKey: "too-short" },
    ),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "INVALID_CONFIGURATION",
  );
  await assert.rejects(
    async () =>
      client.flows.publishVersion("flow-1", 1, { expectedResourceVersion: 1 }, {
        idempotencyKey: undefined,
      } as never),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "INVALID_CONFIGURATION",
  );
  assert.equal(called, false);
});

test("generateIdempotencyKey produces distinct keys the contract accepts", () => {
  const keys = new Set(
    Array.from({ length: 8 }, () => generateIdempotencyKey()),
  );

  assert.equal(keys.size, 8);
  for (const key of keys) assert.match(key, /^[A-Za-z0-9._:-]{16,128}$/);
});

test("a mutation that times out after dispatch reports an unknown outcome", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = makeClient(async () => new Promise<Response>(() => {}), 1000);

  const rejected = assert.rejects(
    client.flows.create(
      "tenant-1",
      { name: "Handoff", slug: "handoff", definition: DEFINITION },
      { idempotencyKey: "flow-create-key-000003" },
    ),
    (error) => {
      assert(error instanceof DaykeeperTransportError);
      assert.equal(error.code, "REQUEST_TIMEOUT");
      assert.equal(error.outcomeUnknown, true);
      // Recovery is the caller's decision: repeat with the same key.
      assert.equal(error.retryable, false);
      return true;
    },
  );
  await nextTurn();
  t.mock.timers.tick(1000);
  await rejected;
});

test("recovering from an unknown outcome with the same key returns the stored result", async () => {
  const keys: (string | null)[] = [];
  const client = makeClient(async (input, init) => {
    const request = new Request(input, init);
    keys.push(request.headers.get("idempotency-key"));
    if (keys.length === 1) throw new Error("private socket failure");
    return Response.json({ data: flowResult(true) }, { status: 200 });
  });
  const input = {
    name: "Handoff",
    slug: "handoff",
    definition: DEFINITION,
  };
  const key = "flow-create-key-000004";

  await assert.rejects(
    client.flows.create("tenant-1", input, { idempotencyKey: key }),
    (error) => {
      assert(error instanceof DaykeeperTransportError);
      assert.equal(error.outcomeUnknown, true);
      assert(!JSON.stringify(error).includes("private"));
      return true;
    },
  );
  const recovered = await client.flows.create("tenant-1", input, {
    idempotencyKey: key,
  });

  assert.equal(recovered.replayed, true);
  assert.deepEqual(keys, [key, key]);
});

test("a keyless mutation is never replayed after an authentication rejection", async () => {
  const attempts: boolean[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: ({ forceRefresh } = { forceRefresh: false }) => {
      attempts.push(forceRefresh);
      return forceRefresh ? "fresh-token" : "stale-token";
    },
    fetch: async () =>
      Response.json({ error: { code: "TOKEN_EXPIRED" } }, { status: 401 }),
  });

  await assert.rejects(
    client.customerSessions.create("tenant-1", {
      purpose: "customer",
      subject: "customer-1",
    }),
    (error) => {
      assert(error instanceof DaykeeperApiError);
      assert.equal(error.status, 401);
      return true;
    },
  );
  assert.deepEqual(attempts, [false]);
});

test("a keyed mutation keeps the single authentication refresh", async () => {
  const attempts: boolean[] = [];
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: ({ forceRefresh } = { forceRefresh: false }) => {
      attempts.push(forceRefresh);
      return forceRefresh ? "fresh-token" : "stale-token";
    },
    fetch: async () => {
      calls++;
      return calls === 1
        ? Response.json({ error: { code: "TOKEN_EXPIRED" } }, { status: 401 })
        : Response.json({ data: flowResult(false) }, { status: 201 });
    },
  });

  const created = await client.flows.create(
    "tenant-1",
    { name: "Handoff", slug: "handoff", definition: DEFINITION },
    { idempotencyKey: "flow-create-key-000005" },
  );

  assert.equal(created.replayed, false);
  assert.deepEqual(attempts, [false, true]);
});

test("reads keep the single authentication refresh unchanged", async () => {
  const attempts: boolean[] = [];
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.daykeeper.example",
    token: ({ forceRefresh } = { forceRefresh: false }) => {
      attempts.push(forceRefresh);
      return "token";
    },
    fetch: async () => {
      calls++;
      return calls === 1
        ? Response.json({ error: { code: "TOKEN_EXPIRED" } }, { status: 401 })
        : Response.json({ data: [] });
    },
  });

  assert.deepEqual(await client.flows.list("tenant-1"), []);
  assert.deepEqual(attempts, [false, true]);
});

test("the client only calls the fixed contract endpoints", async () => {
  let called = false;
  const client = makeClient(async () => {
    called = true;
    return Response.json({ data: {} });
  });

  await assert.rejects(
    async () => client.flows.get(".."),
    (error) => {
      assert(error instanceof DaykeeperTransportError);
      assert.equal(error.code, "INVALID_CONFIGURATION");
      return true;
    },
  );
  assert.equal(called, false);

  // An identifier that looks like a path stays one encoded segment under the
  // configured base, and the list filter is a query parameter rather than a
  // caller-supplied path.
  const urls: string[] = [];
  const listing = makeClient(async (input, init) => {
    urls.push(new Request(input, init).url);
    return Response.json({ data: [] });
  });
  await listing.flows.get("../../v1/tenants");
  await listing.flows.list("tenant/one");
  assert.deepEqual(urls, [
    "https://api.daykeeper.example/v1/flows/..%2F..%2Fv1%2Ftenants",
    "https://api.daykeeper.example/v1/flows?tenantId=tenant%2Fone",
  ]);
});

test("base URLs cannot hide a path level behind an encoded separator", () => {
  for (const baseUrl of [
    "https://api.daykeeper.example/a%2Fb",
    "https://api.daykeeper.example/daykeeper-api/..%2fadmin",
    "https://api.daykeeper.example/daykeeper-api%5cadmin",
  ]) {
    assert.throws(
      () => new DaykeeperClient({ baseUrl, token: "token", fetch }),
      (error) =>
        error instanceof DaykeeperTransportError &&
        error.code === "INVALID_CONFIGURATION",
    );
  }
});

test("a non-JSON rejection is classified by status, not as an invalid response", async () => {
  const client = makeClient(
    async () =>
      new Response("<html>Forbidden by the load balancer</html>", {
        status: 403,
        headers: { "content-type": "text/html", "x-request-id": "edge-1" },
      }),
  );

  await assert.rejects(client.flows.get("flow-1"), (error) => {
    assert(error instanceof DaykeeperApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "HTTP_403");
    assert.equal(error.retryable, false);
    assert.equal(error.correlationId, "edge-1");
    // The rejecting page never reaches the caller.
    assert(!JSON.stringify(error).includes("load balancer"));
    return true;
  });
});

test("a non-JSON success body is still an invalid response", async () => {
  const client = makeClient(
    async () => new Response("not json", { status: 200 }),
  );

  await assert.rejects(client.flows.get("flow-1"), (error) => {
    assert(error instanceof DaykeeperTransportError);
    assert.equal(error.code, "INVALID_RESPONSE");
    return true;
  });
});

test("errors project only contract fields to the caller", async () => {
  const client = makeClient(async () =>
    Response.json(
      {
        error: {
          code: "RESOURCE_VERSION_CONFLICT",
          message: "The resource changed",
          retryable: false,
          nextActions: ["read_latest_version"],
          correlationId: "correlation-2",
          fields: ["expectedResourceVersion"],
          stack: "private server stack",
          upstream: { provider: "private provider detail" },
        },
      },
      { status: 409 },
    ),
  );

  await assert.rejects(client.flows.get("flow-1"), (error) => {
    assert(error instanceof DaykeeperApiError);
    const projected = JSON.parse(JSON.stringify(error)) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(projected).sort(), [
      "code",
      "correlationId",
      "fields",
      "message",
      "name",
      "nextActions",
      "outcomeUnknown",
      "retryable",
      "status",
    ]);
    assert(!JSON.stringify(error).includes("private"));
    return true;
  });
});

test("a value resolving on the deadline boundary is delivered, not discarded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  const lifetime = createRequestLifetime(1000);

  const value = await lifetime.run(() => {
    elapsed = 1000;
    return "on-time";
  });

  assert.equal(value, "on-time");
  lifetime.dispose();
});

function nextTurn() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
