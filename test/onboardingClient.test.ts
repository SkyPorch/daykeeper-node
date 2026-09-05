import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  DaykeeperOnboardingClient,
  DaykeeperOnboardingApiError,
} from "../src/onboardingClient.js";
import type {
  MachineEnrollmentInput,
  MachineProofInput,
} from "../src/types.js";

const input: MachineEnrollmentInput = {
  name: "Example workspace",
  idempotencyKey: "signup-intent-0001",
  publicKey: {
    kty: "EC",
    crv: "P-256",
    x: "A".repeat(43),
    y: "A".repeat(43),
  },
};
const proof: MachineProofInput = {
  challengeId: randomUUID(),
  proof: "private-signature",
};
const credentialId = randomUUID();
const token = `dk_machine_${credentialId.replaceAll("-", "")}_${"x".repeat(43)}`;
const metadata = {
  ownerId: randomUUID(),
  organizationId: randomUUID(),
  credentialId,
  expiresAt: "2026-09-12T00:00:00Z",
  revokedAt: null,
};
const issued = {
  ownerId: metadata.ownerId,
  organizationId: metadata.organizationId,
  organizationSlug: "machine-example",
  replayed: false,
  credentialIssued: true,
  token,
  credential: {
    id: credentialId,
    expiresAt: metadata.expiresAt,
    revokedAt: null,
    policyVersion: "machine-onboarding-v1",
  },
};
const challenge = {
  challengeId: proof.challengeId,
  audience: "https://api.example.test/v1/machine-enrollments",
  nonce: "A".repeat(43),
  keyThumbprint: "A".repeat(43),
  requestHash: "a".repeat(64),
  createdAt: 1800000000,
  expiresAt: 1800000120,
};

test("onboarding uses fixed unauthenticated paths and raw typed responses without retries", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new DaykeeperOnboardingClient({
    baseUrl: "https://api.example.test/prefix",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init! });
      const path = new URL(String(url)).pathname;
      const payload = path.endsWith("/challenges")
        ? challenge
        : path.endsWith("/current")
          ? metadata
          : path.endsWith("/machine-enrollments")
            ? issued
            : {
                ...metadata,
                predecessorId: randomUUID(),
                intentId: randomUUID(),
                replayed: true,
                token: null,
              };
      return Response.json(payload, {
        status: path.endsWith("/challenges")
          ? 201
          : path.endsWith("/current")
            ? 200
            : path.endsWith("/machine-enrollments")
              ? 201
              : 200,
      });
    },
  });
  assert.equal(
    (await client.enrollments.challenge(input)).challengeId,
    proof.challengeId,
  );
  assert.equal((await client.enrollments.create(proof)).token, token);
  const intent = {
    ownerId: metadata.ownerId,
    expectedCredentialId: credentialId,
    intentId: randomUUID(),
  };
  await client.credentialRotations.challenge(intent);
  assert.equal((await client.credentialRotations.create(proof)).token, null);
  assert.equal(
    (await client.credentialRotations.current(proof)).credentialId,
    credentialId,
  );
  assert.deepEqual(
    calls.map((value) => new URL(value.url).pathname),
    [
      "/prefix/v1/machine-enrollments/challenges",
      "/prefix/v1/machine-enrollments",
      "/prefix/v1/machine-credential-rotations/challenges",
      "/prefix/v1/machine-credential-rotations",
      "/prefix/v1/machine-credential-rotations/current",
    ],
  );
  for (const { init } of calls) {
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(init.headers, {
      "content-type": "application/json",
      accept: "application/json",
    });
  }
});

test("onboarding refuses secret-bearing options and malformed requests before dispatch", () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {
    calls++;
    throw new Error("unreachable");
  };
  for (const options of [
    { apiKey: token },
    { token: () => token },
    { headers: { cookie: "secret" } },
    { baseUrl: "https://user:secret@api.example.test" },
    { baseUrl: "https://api.example.test?" },
    { baseUrl: "https://api.example.test#" },
    { baseUrl: "http://remote.example.test" },
  ])
    assert.throws(
      () =>
        new DaykeeperOnboardingClient({
          baseUrl: "https://api.example.test",
          fetch,
          ...options,
        }),
      { code: "INVALID_CONFIGURATION" },
    );
  const client = new DaykeeperOnboardingClient({
    baseUrl: "https://api.example.test",
    fetch,
  });
  assert.throws(
    () =>
      client.enrollments.challenge({
        ...input,
        publicKey: { ...input.publicKey, d: "private" },
      } as MachineEnrollmentInput),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.throws(
    () => client.enrollments.create({ ...proof, challengeId: "../escape" }),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.equal(calls, 0);
});

test("onboarding rejects noncanonical coordinates before dispatch", () => {
  let calls = 0;
  const client = new DaykeeperOnboardingClient({
    baseUrl: "https://api.example.test",
    fetch: async () => {
      calls++;
      return Response.json(challenge, { status: 201 });
    },
  });
  assert.throws(
    () =>
      client.enrollments.challenge({
        ...input,
        publicKey: { ...input.publicKey, x: "x".repeat(43) },
      }),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.equal(calls, 0);
});

test("onboarding rejects noncanonical challenge audiences", async () => {
  for (const audience of [
    "http://api.example.test/",
    "https://api.example.test/?",
    "https://api.example.test/#",
    "https://user:secret@api.example.test/",
  ]) {
    await assert.rejects(
      new DaykeeperOnboardingClient({
        baseUrl: "https://api.example.test",
        fetch: async () =>
          Response.json({ ...challenge, audience }, { status: 201 }),
      }).enrollments.challenge(input),
      { code: "INVALID_RESPONSE", outcomeUnknown: true },
    );
  }
});

test("onboarding enforces endpoint status semantics", async () => {
  const cases = [
    [
      "challenge",
      () =>
        new DaykeeperOnboardingClient({
          baseUrl: "https://api.example.test",
          fetch: async () => Response.json(challenge, { status: 200 }),
        }).enrollments.challenge(input),
    ],
    [
      "metadata",
      () =>
        new DaykeeperOnboardingClient({
          baseUrl: "https://api.example.test",
          fetch: async () => Response.json(metadata, { status: 201 }),
        }).credentialRotations.current(proof),
    ],
    [
      "enrollment",
      () =>
        new DaykeeperOnboardingClient({
          baseUrl: "https://api.example.test",
          fetch: async () => Response.json(issued, { status: 200 }),
        }).enrollments.create(proof),
    ],
  ] as const;
  for (const [, request] of cases)
    await assert.rejects(request(), { code: "INVALID_RESPONSE" });
});

test("onboarding response loss is outcome-unknown and cannot leak transport or response secrets", async () => {
  let calls = 0;
  const client = new DaykeeperOnboardingClient({
    baseUrl: "https://api.example.test",
    fetch: async () => {
      calls++;
      throw new Error(`leaked ${token}`);
    },
  });
  await assert.rejects(client.enrollments.create(proof), (error) => {
    assert.equal((error as { outcomeUnknown: boolean }).outcomeUnknown, true);
    assert.equal((error as { retryable: boolean }).retryable, false);
    assert.ok(!JSON.stringify(error).includes(token));
    return true;
  });
  assert.equal(calls, 1);
  for (const response of [
    Response.json({ ...issued, credentialIssued: false }),
    Response.json({ ...issued, unexpected: token }),
    new Response("not JSON"),
    Response.json({ ...issued, token: "wrong-secret" }),
  ]) {
    await assert.rejects(
      new DaykeeperOnboardingClient({
        baseUrl: "https://api.example.test",
        fetch: async () => response,
      }).enrollments.create(proof),
      { code: "INVALID_RESPONSE", outcomeUnknown: true, retryable: false },
    );
  }
});

test("HTTP rejections project only safe codes and bounded retry hints", async () => {
  const client = new DaykeeperOnboardingClient({
    baseUrl: "https://api.example.test",
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: token,
            nextActions: [token],
            correlationId: token,
          },
        },
        { status: 429, headers: { "retry-after": "12" } },
      ),
  });
  await assert.rejects(client.enrollments.create(proof), (error) => {
    assert.ok(error instanceof DaykeeperOnboardingApiError);
    assert.equal(error.retryAfterSeconds, 12);
    assert.equal(error.outcomeUnknown, false);
    assert.ok(!JSON.stringify(error).includes(token));
    return true;
  });
  await assert.rejects(
    new DaykeeperOnboardingClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(token, { status: 503 }),
    }).enrollments.create(proof),
    { code: "HTTP_503", outcomeUnknown: true, retryable: false },
  );
});

test("abort and body deadlines bound the entire unauthenticated request", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const before = new DaykeeperOnboardingClient({
    baseUrl: "https://api.example.test",
    fetch: async () => {
      calls++;
      return Response.json(issued);
    },
  });
  await assert.rejects(
    before.enrollments.create(proof, { signal: controller.signal }),
    { code: "REQUEST_ABORTED", outcomeUnknown: false },
  );
  assert.equal(calls, 0);
  let canceled = false;
  const stalled = new DaykeeperOnboardingClient({
    baseUrl: "https://api.example.test",
    timeoutMs: 1000,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
          cancel() {
            canceled = true;
          },
        }),
      ),
  });
  await assert.rejects(stalled.enrollments.create(proof), {
    code: "REQUEST_TIMEOUT",
    outcomeUnknown: true,
    retryable: false,
  });
  assert.equal(canceled, true);
});

test("real redirects never forward signing proofs to a different destination", async (t) => {
  let destinationCalls = 0;
  const destination = createServer((_request, response) => {
    destinationCalls++;
    response.end("{}");
  });
  await new Promise<void>((resolve) =>
    destination.listen(0, "127.0.0.1", resolve),
  );
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        destination.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = destination.address();
  assert.ok(address && typeof address !== "string");
  const source = createServer((_request, response) => {
    response.writeHead(307, {
      location: `http://127.0.0.1:${address.port}/stolen`,
    });
    response.end();
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        source.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const sourceAddress = source.address();
  assert.ok(sourceAddress && typeof sourceAddress !== "string");
  const client = new DaykeeperOnboardingClient({
    baseUrl: `http://127.0.0.1:${sourceAddress.port}`,
  });
  await assert.rejects(client.enrollments.create(proof), {
    code: "NETWORK_ERROR",
    outcomeUnknown: true,
  });
  assert.equal(destinationCalls, 0);
});
