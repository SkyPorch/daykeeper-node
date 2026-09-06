import assert from "node:assert/strict";
import test from "node:test";
import { DaykeeperClient } from "../src/client.ts";

const receipt = {
  activationId: "activation-1",
  tenantId: "tenant-1",
  channelId: "channel-1",
  intent: "activation-intent-1",
  state: "active" as const,
  createdAt: 1_800_000_000,
  revokedAt: null,
  replayed: false,
};

test("inbox activation methods use the fixed paths, body, and idempotency contract", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "key",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json(
        { data: receipt },
        { status: request.method === "POST" ? 201 : 200 },
      );
    },
  });
  assert.deepEqual(
    await client.inboxActivations.create("tenant/acme", {
      idempotencyKey: "activation-intent-1",
    }),
    receipt,
  );
  assert.deepEqual(
    await client.inboxActivations.get("tenant/acme", "activation:intent1"),
    receipt,
  );
  assert.deepEqual(
    await client.inboxActivations.revoke("tenant/acme", "activation:intent1"),
    receipt,
  );
  const bodies = await Promise.all(
    requests.map((request) =>
      request
        .clone()
        .json()
        .catch(() => undefined),
    ),
  );
  assert.deepEqual(
    requests.map((request, index) => [
      request.method,
      new URL(request.url).pathname,
      request.headers.get("idempotency-key"),
      bodies[index],
    ]),
    [
      [
        "POST",
        "/v1/tenants/tenant%2Facme/inbox-activations",
        "activation-intent-1",
        {},
      ],
      [
        "GET",
        "/v1/tenants/tenant%2Facme/inbox-activations/activation%3Aintent1",
        null,
        undefined,
      ],
      [
        "POST",
        "/v1/tenants/tenant%2Facme/inbox-activations/activation%3Aintent1/revoke",
        null,
        {},
      ],
    ],
  );
});

test("create requires a valid idempotency key and activation intent is a path segment", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "key",
    fetch: async () => {
      calls++;
      return Response.json({ data: receipt });
    },
  });
  await assert.rejects(
    () => client.inboxActivations.create("tenant", {} as never),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.throws(
    () => client.inboxActivations.get("tenant", "short"),
    /activation intent/,
  );
  assert.throws(
    () => client.inboxActivations.revoke("tenant", ""),
    /activation intent/,
  );
  assert.equal(calls, 0);
});

test("uncertain activation mutations are never automatically retried and aborts are preserved", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "key",
    fetch: async () => {
      calls++;
      throw new Error("lost response");
    },
  });
  await assert.rejects(
    () =>
      client.inboxActivations.create("tenant", {
        idempotencyKey: "activation-intent-1",
      }),
    { code: "NETWORK_ERROR", outcomeUnknown: true },
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      client.inboxActivations.get("tenant", "activation-intent-1", {
        signal: controller.signal,
      }),
    { code: "REQUEST_ABORTED" },
  );
});
