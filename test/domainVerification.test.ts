import assert from "node:assert/strict";
import { test } from "node:test";
import { DaykeeperClient } from "../src/client.js";

const result = {
  challengeId: "ver-1",
  tenantId: "tenant-1",
  origin: "https://example.com",
  state: "pending",
  dns: { type: "TXT", name: "_daykeeper.example.com", value: "token" },
  expiresAt: 1_800_000_000,
  verifiedAt: null,
  revokedAt: null,
};

test("domain verification methods use the fixed contract and idempotency", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "key",
    fetch: async (requestInfo, init) => {
      const request = new Request(requestInfo, init);
      requests.push(request);
      return Response.json(
        { data: result },
        {
          status:
            request.method === "POST" &&
            new URL(request.url).pathname.endsWith("/domain-verifications")
              ? 201
              : 200,
        },
      );
    },
  });
  assert.deepEqual(
    await client.domainVerifications.create(
      "tenant-1",
      { origin: "https://example.com" },
      { idempotencyKey: "domain-create-0001" },
    ),
    result,
  );
  assert.deepEqual(
    await client.domainVerifications.get("tenant-1", "ver-1"),
    result,
  );
  assert.deepEqual(
    await client.domainVerifications.verify("tenant-1", "ver-1"),
    result,
  );
  assert.deepEqual(
    await client.domainVerifications.revoke("tenant-1", "ver-1"),
    result,
  );
  assert.deepEqual(
    requests.map((request) => [
      request.method,
      new URL(request.url).pathname,
      request.headers.get("idempotency-key"),
    ]),
    [
      [
        "POST",
        "/v1/tenants/tenant-1/domain-verifications",
        "domain-create-0001",
      ],
      ["GET", "/v1/tenants/tenant-1/domain-verifications/ver-1", null],
      ["POST", "/v1/tenants/tenant-1/domain-verifications/ver-1/verify", null],
      ["POST", "/v1/tenants/tenant-1/domain-verifications/ver-1/revoke", null],
    ],
  );
});

test("domain verification create validates origin and requires idempotency", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "key",
    fetch: async () => {
      calls += 1;
      return Response.json({ data: result });
    },
  });
  assert.throws(() =>
    client.domainVerifications.create(
      "tenant-1",
      { origin: "http://example.com" },
      { idempotencyKey: "domain-create-0001" },
    ),
  );
  assert.throws(() =>
    client.domainVerifications.create(
      "tenant-1",
      { origin: "https://127.0.0.1" },
      { idempotencyKey: "domain-create-0001" },
    ),
  );
  await assert.rejects(() =>
    client.domainVerifications.create(
      "tenant-1",
      { origin: "https://example.com" },
      {} as never,
    ),
  );
  await assert.rejects(
    () =>
      client.domainVerifications.create(
        "tenant-1",
        { origin: "https://example.com" },
        undefined as never,
      ),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.equal(calls, 0);
});

test("lost domain mutation responses are uncertain and never replayed", async () => {
  for (const action of ["verify", "revoke"] as const) {
    let calls = 0;
    const client = new DaykeeperClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      fetch: async () => {
        calls++;
        throw new Error("Synthetic lost accepted response");
      },
    });
    await assert.rejects(
      () => client.domainVerifications[action]("tenant-1", "ver-1"),
      { code: "NETWORK_ERROR", outcomeUnknown: true },
    );
    assert.equal(calls, 1);
  }
});
