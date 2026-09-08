import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMachineOwnerKey,
  DaykeeperMachineSigner,
} from "../src/machineSigner.js";
import type {
  MachineChallenge,
  MachineEnrollmentInput,
  MachineRotationInput,
} from "../src/types.js";

const audience = "https://api.example.test/v1/machine-enrollments";
const id = "11111111-1111-4111-8111-111111111111";
const base = {
  challengeId: id,
  audience,
  nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  createdAt: 1_700_000_000,
  expiresAt: 1_700_000_120,
};
async function challenge(publicKey: JsonWebKey): Promise<MachineChallenge> {
  return {
    ...base,
    keyThumbprint: await thumbprint(publicKey),
    requestHash: await sha256(
      JSON.stringify({
        purpose: "daykeeper-machine-enrollment-v1",
        name: "Example",
        idempotencyKey: "signup-intent-0001",
      }),
    ),
  };
}
async function rotationChallenge(): Promise<MachineChallenge> {
  return {
    ...base,
    audience: "https://api.example.test/v1/machine-enrollments",
    keyThumbprint: "unused",
    requestHash: await sha256(
      JSON.stringify({
        purpose: "daykeeper-machine-credential-rotation-v1",
        ownerId: id,
        expectedCredentialId: id,
        intentId: "22222222-2222-4222-8222-222222222222",
      }),
    ),
  } as MachineChallenge;
}

test("generates a caller-owned key and signs an ES256 enrollment JWT", async () => {
  const pair = await createMachineOwnerKey();
  assert.equal(pair.privateKey.kty, "EC");
  const signer = await DaykeeperMachineSigner.fromPrivateKey(pair.privateKey);
  assert.deepEqual(signer.publicKey, pair.publicKey);
  const input: MachineEnrollmentInput = {
    name: "Example",
    idempotencyKey: "signup-intent-0001",
    publicKey: pair.publicKey,
  };
  const token = await signer.signEnrollment(
    await challenge(pair.publicKey),
    input,
    { audience },
  );
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "ES256",
    typ: "daykeeper-enrollment+jwt",
  });
  assert.equal(
    JSON.parse(Buffer.from(payload, "base64url").toString()).jti,
    id,
  );
  assert.equal(Buffer.from(signature, "base64url").length, 64);
  const verifyKey = await crypto.subtle.importKey(
    "jwk",
    pair.publicKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  assert.equal(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
    true,
  );
  const restored = await DaykeeperMachineSigner.fromPrivateKey(
    await signer.exportPrivateKey(),
  );
  assert.deepEqual(restored.publicKey, pair.publicKey);
});

test("rejects audience, key, and request bindings", async () => {
  const pair = await createMachineOwnerKey();
  const signer = await DaykeeperMachineSigner.fromPrivateKey(pair.privateKey);
  const c = await challenge(pair.publicKey);
  const input: MachineEnrollmentInput = {
    name: "Example",
    idempotencyKey: "signup-intent-0001",
    publicKey: pair.publicKey,
  };
  await assert.rejects(() =>
    signer.signEnrollment(c, input, {
      audience: "https://other.example.test",
    }),
  );
  await assert.rejects(() =>
    signer.signEnrollment(
      {
        ...c,
        keyThumbprint: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      },
      input,
      { audience },
    ),
  );
  await assert.rejects(() =>
    signer.signRotation(
      c,
      {
        ownerId: id,
        expectedCredentialId: id,
        intentId: "22222222-2222-4222-8222-222222222222",
      } satisfies MachineRotationInput,
      { audience },
    ),
  );
});

test("snapshots mutable inputs, rejects expired/strict challenges, and signs rotation", async () => {
  const pair = await createMachineOwnerKey();
  const signer = await DaykeeperMachineSigner.fromPrivateKey(pair.privateKey, {
    now: () => 1_700_000_030,
  });
  const c = await challenge(pair.publicKey);
  const input: MachineEnrollmentInput = {
    name: "Example",
    idempotencyKey: "signup-intent-0001",
    publicKey: pair.publicKey,
  };
  const pending = signer.signEnrollment(c, input, { audience });
  input.name = "Mutated";
  c.requestHash = "f".repeat(64);
  assert.equal((await pending).split(".").length, 3);

  const fresh = await challenge(pair.publicKey);
  const rotationInput = {
    ownerId: id,
    expectedCredentialId: id,
    intentId: "22222222-2222-4222-8222-222222222222",
  } satisfies MachineRotationInput;
  const rotation = await signer.signRotation(
    {
      ...(await rotationChallenge()),
      keyThumbprint: (await challenge(pair.publicKey)).keyThumbprint,
    },
    rotationInput,
    { audience },
  );
  assert.equal(rotation.split(".").length, 3);
  assert.equal(await verify(rotation, pair.publicKey), true);
  const rotationC = await rotationChallenge();
  await assert.rejects(() =>
    signer.signRotation(rotationC, rotationInput, {
      audience: `${audience}?`,
    }),
  );
  await assert.rejects(() =>
    signer.signRotation(rotationC, rotationInput, {
      audience: `${audience}#`,
    }),
  );
  await assert.rejects(() =>
    signer.signEnrollment({ ...fresh, extra: true } as never, input, {
      audience,
    }),
  );
  const expired = await challenge(pair.publicKey);
  expired.createdAt = 1_700_000_000;
  expired.expiresAt = 1_700_000_005;
  await assert.rejects(() =>
    signer.signEnrollment(expired, { ...input, name: "Example" }, { audience }),
  );
});

test("does not accept mismatched private coordinates", async () => {
  const first = await createMachineOwnerKey();
  const second = await createMachineOwnerKey();
  await assert.rejects(() =>
    DaykeeperMachineSigner.fromPrivateKey({
      ...first.privateKey,
      x: second.publicKey.x,
      y: second.publicKey.y,
    }),
  );
  await assert.rejects(() =>
    DaykeeperMachineSigner.fromPrivateKey({
      ...first.privateKey,
      x: `${first.privateKey.x}?`,
    }),
  );
});

test("rejects the shorter proof expiry before and after signing", async () => {
  const pair = await createMachineOwnerKey();
  const c = await challenge(pair.publicKey);
  const input = {
    name: "Example",
    idempotencyKey: "signup-intent-0001",
    publicKey: pair.publicKey,
  };
  const expired = await DaykeeperMachineSigner.fromPrivateKey(pair.privateKey, {
    now: () => c.createdAt + 60,
  });
  await assert.rejects(
    () => expired.signEnrollment(c, input, { audience }),
    /proof has expired/,
  );
  let calls = 0;
  const late = await DaykeeperMachineSigner.fromPrivateKey(pair.privateKey, {
    now: () => c.createdAt + (++calls === 1 ? 59 : 60),
  });
  await assert.rejects(
    () => late.signEnrollment(c, input, { audience }),
    /proof has expired/,
  );
});

test("generate and private-key snapshots survive caller mutation", async () => {
  const generated = await DaykeeperMachineSigner.generate();
  const exported = await generated.exportPrivateKey();
  const restored = await DaykeeperMachineSigner.fromPrivateKey(exported);
  assert.deepEqual(restored.publicKey, generated.publicKey);
  const originalX = exported.x;
  const pending = DaykeeperMachineSigner.fromPrivateKey(exported);
  exported.x = "bad";
  assert.equal((await pending).publicKey.x, originalX);
});

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function thumbprint(jwk: JsonWebKey): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y }),
      ),
    ),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
async function verify(token: string, jwk: JsonWebKey): Promise<boolean> {
  const [header, payload, signature] = token.split(".");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${payload}`),
  );
}
