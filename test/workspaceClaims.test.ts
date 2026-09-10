import assert from "node:assert/strict";
import test from "node:test";
import { DaykeeperClient } from "../src/client.ts";
import type {
  WorkspaceClaimCreated,
  WorkspaceClaimReplayed,
} from "../src/types.ts";

const claim = {
  id: "40000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  email: "gabriel@acme.com",
  role: "owner" as const,
  state: "pending" as const,
  expiresAt: "2026-09-13T01:00:00Z",
  createdAt: "2026-09-10T01:00:00Z",
};

const token = `dk_invite_${"A".repeat(43)}`;
const claimUrl = `https://console.daykeeper.example/claim#token=${token}`;

function client(
  handler: (request: Request) => Response | Promise<Response>,
  requests: Request[] = [],
) {
  return {
    requests,
    client: new DaykeeperClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return handler(request);
      },
    }),
  };
}

test("workspace claim methods use the fixed paths, body, and idempotency contract", async () => {
  const requests: Request[] = [];
  const { client: daykeeper } = client(
    (request) =>
      request.method === "POST" &&
      new URL(request.url).pathname === "/v1/workspace-claims"
        ? Response.json(
            { data: { claim, token, claimUrl, replayed: false } },
            { status: 201 },
          )
        : request.method === "GET"
          ? Response.json({ data: { items: [claim] } })
          : Response.json({ data: { ...claim, state: "revoked" } }),
    requests,
  );

  assert.deepEqual(
    await daykeeper.workspaceClaims.create(
      { email: "gabriel@acme.com" },
      { idempotencyKey: "workspace-claim-0001" },
    ),
    { claim, token, claimUrl, replayed: false },
  );
  assert.deepEqual(await daykeeper.workspaceClaims.list(), { items: [claim] });
  assert.deepEqual(await daykeeper.workspaceClaims.revoke("claim/one"), {
    ...claim,
    state: "revoked",
  });

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
        "/v1/workspace-claims",
        "workspace-claim-0001",
        { email: "gabriel@acme.com" },
      ],
      ["GET", "/v1/workspace-claims", null, undefined],
      ["POST", "/v1/workspace-claims/claim%2Fone/revoke", null, {}],
    ],
  );
});

test("a replayed claim returns the pending claim with no token or URL", async () => {
  const requests: Request[] = [];
  const { client: daykeeper } = client(
    () =>
      Response.json(
        { data: { claim, token: null, claimUrl: null, replayed: true } },
        { status: 200 },
      ),
    requests,
  );
  const result = await daykeeper.workspaceClaims.create(
    { email: "gabriel@acme.com" },
    { idempotencyKey: "workspace-claim-0001" },
  );
  assert.equal(result.replayed, true);
  assert.equal(result.token, null);
  assert.equal(result.claimUrl, null);
  assert.deepEqual(result.claim, claim);
  assert.equal(requests.length, 1);
});

test("the create result is a union the caller narrows on replayed", async () => {
  // The 201 and 200 bodies are separate contract schemas, so the single result
  // type is a union discriminated by `replayed`. Narrowing is what proves the
  // secret is only reachable on the fresh branch; the compiler checks the
  // annotations below and the assertions check the runtime shape.
  for (const replayed of [false, true]) {
    const { client: daykeeper } = client(() =>
      replayed
        ? Response.json(
            { data: { claim, token: null, claimUrl: null, replayed: true } },
            { status: 200 },
          )
        : Response.json(
            { data: { claim, token, claimUrl, replayed: false } },
            { status: 201 },
          ),
    );
    const result = await daykeeper.workspaceClaims.create(
      { email: "gabriel@acme.com" },
      { idempotencyKey: "workspace-claim-0001" },
    );
    if (result.replayed) {
      const narrowed: WorkspaceClaimReplayed = result;
      const secret: null = narrowed.token;
      assert.equal(replayed, true);
      assert.equal(secret, null);
      assert.equal(narrowed.claimUrl, null);
    } else {
      const narrowed: WorkspaceClaimCreated = result;
      const url: string = narrowed.claimUrl;
      assert.equal(replayed, false);
      assert.equal(narrowed.token, token);
      assert.equal(url, claimUrl);
      assert.match(url, /#token=dk_invite_/);
    }
  }
});

test("create requires an idempotency key and a lowercased address", async () => {
  let calls = 0;
  const { client: daykeeper } = client(() => {
    calls++;
    return Response.json({ data: { claim, token, claimUrl, replayed: false } });
  });
  await assert.rejects(
    () =>
      daykeeper.workspaceClaims.create(
        { email: "gabriel@acme.com" },
        {} as never,
      ),
    { code: "INVALID_CONFIGURATION" },
  );
  await assert.rejects(
    () =>
      daykeeper.workspaceClaims.create(
        { email: "gabriel@acme.com" },
        { idempotencyKey: "short" },
      ),
    { code: "INVALID_CONFIGURATION" },
  );
  // A malformed address is refused locally, before an idempotency key is bound
  // or an hourly claim window is consumed.
  for (const email of [
    "Gabriel@Acme.com",
    "gabriel.acme.com",
    "",
    "gabriel @acme.com",
    `${"a".repeat(250)}@acme.com`,
    // Mirrors the tightened contract pattern: no bare dots, no empty domain
    // label, no dotless or hyphen-edged domain, no doubled or edge dot in the
    // local part.
    ".@.",
    "user@.example",
    "gabriel..uribe@acme.com",
    ".gabriel@acme.com",
    "gabriel.@acme.com",
    "gabriel@acme",
    "gabriel@-acme.com",
    "gabriel@acme-.com",
    "gabriel@acme..com",
    "gabriel@@acme.com",
    "gabriel@acme.com ",
    // 255 code points is one past the contract's maxLength.
    `${"a".repeat(246)}@acme.com`,
  ]) {
    assert.throws(
      () =>
        daykeeper.workspaceClaims.create(
          { email },
          { idempotencyKey: "workspace-claim-0001" },
        ),
      { code: "INVALID_CONFIGURATION" },
      email,
    );
  }
  assert.throws(
    () =>
      daykeeper.workspaceClaims.create(
        { email: "gabriel@acme.com", role: "owner" } as never,
        { idempotencyKey: "workspace-claim-0001" },
      ),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.throws(() => daykeeper.workspaceClaims.revoke(" "), {
    code: "INVALID_CONFIGURATION",
  });
  assert.equal(calls, 0);
});

test("the local rule accepts real addresses up to the contract's 254", async () => {
  let calls = 0;
  const { client: daykeeper } = client(() => {
    calls++;
    return Response.json(
      { data: { claim, token, claimUrl, replayed: false } },
      { status: 201 },
    );
  });
  const accepted = [
    "gabriel@acme.com",
    "gabriel+claims@mail.acme.co.uk",
    "a@b.co",
    "first.last@sub.domain.example",
    "user!#$%&'*+/=?^_`{|}~-@example.com",
    // Exactly 254 code points, the contract's maxLength.
    `${"a".repeat(245)}@acme.com`,
  ];
  for (const email of accepted) {
    await daykeeper.workspaceClaims.create(
      { email },
      { idempotencyKey: "workspace-claim-0001" },
    );
  }
  assert.equal(calls, accepted.length);
});

test("pending, member, and rate-limit rejections surface as the server sent them", async () => {
  for (const [status, code, retryable] of [
    [409, "INVITATION_ALREADY_PENDING", false],
    [409, "ALREADY_A_MEMBER", false],
    [429, "RATE_LIMITED", true],
  ] as const) {
    let calls = 0;
    const { client: daykeeper } = client(() => {
      calls++;
      return Response.json(
        {
          error: {
            code,
            message: "rejected",
            retryable,
            nextActions: ["inspect_claims"],
            correlationId: "req-1",
          },
        },
        { status },
      );
    });
    await assert.rejects(
      () =>
        daykeeper.workspaceClaims.create(
          { email: "gabriel@acme.com" },
          { idempotencyKey: "workspace-claim-0001" },
        ),
      { name: "DaykeeperApiError", status, code, retryable },
    );
    // A rejected create is never automatically retried, even when retryable.
    assert.equal(calls, 1);
  }
});

test("a human or agent-credential 403 surfaces as SCOPE_NOT_HELD without retry", async () => {
  let calls = 0;
  const { client: daykeeper } = client(() => {
    calls++;
    return Response.json(
      {
        error: {
          code: "SCOPE_NOT_HELD",
          message: "A machine owner credential is required",
          retryable: false,
          nextActions: ["use_machine_owner_credential"],
          correlationId: "req-2",
        },
      },
      { status: 403 },
    );
  });
  for (const call of [
    () =>
      daykeeper.workspaceClaims.create(
        { email: "gabriel@acme.com" },
        { idempotencyKey: "workspace-claim-0001" },
      ),
    () => daykeeper.workspaceClaims.list(),
    () =>
      daykeeper.workspaceClaims.revoke("40000000-0000-4000-8000-000000000001"),
  ]) {
    await assert.rejects(call, {
      name: "DaykeeperApiError",
      status: 403,
      code: "SCOPE_NOT_HELD",
      retryable: false,
      outcomeUnknown: false,
    });
  }
  assert.equal(calls, 3);
});

test("a lost claim response is an unknown outcome and is never retried", async () => {
  let calls = 0;
  const { client: daykeeper } = client(() => {
    calls++;
    throw new Error("lost response");
  });
  await assert.rejects(
    () =>
      daykeeper.workspaceClaims.create(
        { email: "gabriel@acme.com" },
        { idempotencyKey: "workspace-claim-0001" },
      ),
    { code: "NETWORK_ERROR", outcomeUnknown: true, retryable: false },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      daykeeper.workspaceClaims.revoke("40000000-0000-4000-8000-000000000001"),
    { code: "NETWORK_ERROR", outcomeUnknown: true },
  );
  assert.equal(calls, 2);
  // A read has no write to reconcile.
  await assert.rejects(() => daykeeper.workspaceClaims.list(), {
    code: "NETWORK_ERROR",
    outcomeUnknown: false,
  });
  assert.equal(calls, 3);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => daykeeper.workspaceClaims.list({ signal: controller.signal }),
    { code: "REQUEST_ABORTED" },
  );
});

test("the claim service unavailable state is reported, not turned into a retry", async () => {
  let calls = 0;
  const { client: daykeeper } = client(() => {
    calls++;
    return Response.json(
      {
        error: {
          code: "FEATURE_UNAVAILABLE",
          message: "Workspace claims are not enabled",
          retryable: false,
          nextActions: ["check_capabilities"],
          correlationId: "req-3",
        },
      },
      { status: 503 },
    );
  });
  await assert.rejects(
    () =>
      daykeeper.workspaceClaims.create(
        { email: "gabriel@acme.com" },
        { idempotencyKey: "workspace-claim-0001" },
      ),
    {
      name: "DaykeeperApiError",
      status: 503,
      code: "FEATURE_UNAVAILABLE",
      retryable: false,
    },
  );
  assert.equal(calls, 1);
});
