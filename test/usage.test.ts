import assert from "node:assert/strict";
import test from "node:test";
import {
  DaykeeperClient,
  DaykeeperApiError,
  DaykeeperTransportError,
  type UsageStatus,
} from "../src/index.ts";

const status: UsageStatus = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  kind: "resource_safety",
  aggregation: "organization_single_cell",
  asOf: "2026-08-31T12:00:00.000Z",
  period: {
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: "2026-09-01T00:00:00.000Z",
    timezone: "UTC",
  },
  state: "unconfigured",
  assignmentVersion: null,
  policy: null,
  resources: {
    contactRecords: {
      used: 0,
      limit: null,
      remaining: null,
      limitReached: null,
    },
    conversationRecords: {
      used: 0,
      limit: null,
      remaining: null,
      limitReached: null,
    },
    messageRecords: {
      used: Number.MAX_SAFE_INTEGER,
      limit: null,
      remaining: null,
      limitReached: null,
    },
  },
  writeAdmission: "not_evaluated",
  nextActions: ["contact_organization_owner"],
};

test("usage is a typed prefix-preserving GET with no selectors or policy mutation", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test/daykeeper-api",
    token: "synthetic-usage-token",
    fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(
        request.url,
        "https://api.example.test/daykeeper-api/v1/usage",
      );
      assert.equal(request.method, "GET");
      assert.equal(await request.text(), "");
      assert.equal(
        request.headers.get("authorization"),
        "Bearer synthetic-usage-token",
      );
      return Response.json({ data: status });
    },
  });
  const result: UsageStatus = await client.usage.get();
  assert.deepEqual(result, status);
  assert.equal(result.resources.messageRecords.used, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(Object.keys(client.usage), ["get"]);
  assert.equal(calls, 1);
});

test("usage preserves scope errors and older-server 404 without fallback or retries", async () => {
  for (const [httpStatus, code] of [
    [403, "SCOPE_REQUIRED"],
    [403, "ORGANIZATION_ACCESS_REQUIRED"],
    [404, "RESOURCE_NOT_FOUND"],
  ] as const) {
    let calls = 0;
    let tokens = 0;
    const client = new DaykeeperClient({
      baseUrl: "https://api.example.test",
      token: () => {
        tokens++;
        return "synthetic-token";
      },
      fetch: async () => {
        calls++;
        return Response.json(
          {
            error: {
              code,
              message: "Usage read unavailable",
              retryable: false,
              correlationId: "test-request",
              nextActions: ["request_organization_access"],
            },
          },
          { status: httpStatus },
        );
      },
    });
    await assert.rejects(client.usage.get(), (error) => {
      assert.ok(error instanceof DaykeeperApiError);
      assert.equal(error.code, code);
      assert.equal(error.status, httpStatus);
      assert.equal(error.retryable, false);
      assert.deepEqual(error.nextActions, ["request_organization_access"]);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(tokens, 1);
  }
});

test("pre-aborted usage does not acquire credentials or dispatch; auth refresh stays bounded", async () => {
  const aborted = new DaykeeperClient({
    baseUrl: "https://api.example.test",
    token: () => assert.fail("No token request after abort"),
    fetch: async () => assert.fail("No fetch after abort"),
  });
  await assert.rejects(
    aborted.usage.get({ signal: AbortSignal.abort() }),
    (error) =>
      error instanceof DaykeeperTransportError &&
      error.code === "REQUEST_ABORTED",
  );
  const refreshed: boolean[] = [];
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.test",
    token: (request) => {
      refreshed.push(request?.forceRefresh ?? false);
      return "synthetic-token";
    },
    fetch: async () => {
      calls++;
      return calls === 1
        ? Response.json(
            {
              error: {
                code: "AUTHENTICATION_REQUIRED",
                message: "Refresh",
                retryable: false,
              },
            },
            { status: 401 },
          )
        : Response.json({ data: status });
    },
  });
  assert.deepEqual(await client.usage.get(), status);
  assert.deepEqual(refreshed, [false, true]);
  assert.equal(calls, 2);
});
