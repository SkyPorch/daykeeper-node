import type {
  MachineChallenge,
  MachineEnrollmentInput,
  MachinePublicKey,
  MachineRotationInput,
} from "./types.js";

export interface MachineOwnerKeyPair {
  privateKey: JsonWebKey;
  publicKey: MachinePublicKey;
}

type AudienceOptions = { audience: string };
type ClockOptions = { now?: () => number };

const encoder = new TextEncoder();
const subtle = globalThis.crypto?.subtle;

/** Generate a caller-owned P-256 key pair. Nothing is persisted by this helper. */
export async function createMachineOwnerKey(): Promise<MachineOwnerKeyPair> {
  requireCrypto();
  const pair = (await subtle!.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateKey = await subtle!.exportKey("jwk", pair.privateKey);
  const publicKey = await subtle!.exportKey("jwk", pair.publicKey);
  return {
    privateKey: minimalPrivate(privateKey),
    publicKey: minimalPublic(publicKey),
  };
}

export class DaykeeperMachineSigner {
  readonly #privateKey: CryptoKey;
  readonly #publicKey: MachinePublicKey;
  readonly #now?: () => number;

  private constructor(
    privateKey: CryptoKey,
    publicKey: MachinePublicKey,
    options?: ClockOptions,
  ) {
    this.#privateKey = privateKey;
    this.#publicKey = Object.freeze({ ...publicKey });
    this.#now = options?.now;
  }

  static async fromPrivateKey(
    privateJwk: JsonWebKey,
    options?: ClockOptions,
  ): Promise<DaykeeperMachineSigner> {
    requireCrypto();
    const privateKey = validatePrivateJwk(privateJwk);
    let key: CryptoKey;
    try {
      key = await subtle!.importKey(
        "jwk",
        privateKey,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
      );
    } catch {
      throw new Error("Invalid machine owner key");
    }
    const publicKey: MachinePublicKey = {
      kty: "EC",
      crv: "P-256",
      x: privateKey.x,
      y: privateKey.y,
    };
    // Importing a JWK is not sufficient to prove d corresponds to x/y.
    try {
      const check = await subtle!.importKey(
        "jwk",
        publicKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      const probe = await subtle!.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        encoder.encode("daykeeper-key-consistency"),
      );
      if (
        !(await subtle!.verify(
          { name: "ECDSA", hash: "SHA-256" },
          check,
          probe,
          encoder.encode("daykeeper-key-consistency"),
        ))
      )
        throw new Error("Invalid machine owner key");
    } catch {
      throw new Error("Invalid machine owner key");
    }
    return new DaykeeperMachineSigner(key, publicKey, options);
  }

  static async generate(
    options?: ClockOptions,
  ): Promise<DaykeeperMachineSigner> {
    const pair = await createMachineOwnerKey();
    return DaykeeperMachineSigner.fromPrivateKey(pair.privateKey, options);
  }

  get publicKey(): MachinePublicKey {
    return { ...this.#publicKey };
  }

  async exportPrivateKey(): Promise<JsonWebKey> {
    requireCrypto();
    return minimalPrivate(await subtle!.exportKey("jwk", this.#privateKey));
  }

  async signEnrollment(
    challenge: MachineChallenge,
    input: MachineEnrollmentInput,
    options: AudienceOptions,
  ): Promise<string> {
    return this.#sign(challenge, input, options, "enrollment");
  }

  async signRotation(
    challenge: MachineChallenge,
    input: MachineRotationInput,
    options: AudienceOptions,
  ): Promise<string> {
    return this.#sign(challenge, input, options, "credential-rotation");
  }

  async #sign(
    challenge: MachineChallenge,
    input: MachineEnrollmentInput | MachineRotationInput,
    options: AudienceOptions,
    profile: "enrollment" | "credential-rotation",
  ): Promise<string> {
    requireCrypto();
    const audience = canonicalAudience(options.audience);
    const c = validateChallenge(challenge, audience);
    const requestBody = requestBodyFor(input, profile, this.#publicKey);
    const publicKey: MachinePublicKey = {
      kty: "EC",
      crv: "P-256",
      x: this.#publicKey.x!,
      y: this.#publicKey.y!,
    };
    if ((await jwkThumbprint(publicKey)) !== c.keyThumbprint)
      throw new Error("Challenge is not bound to this key");
    const requestHash = await requestHashFor(requestBody);
    if (requestHash !== c.requestHash)
      throw new Error("Challenge is not bound to this request");
    const now = this.#now?.();
    if (
      now !== undefined &&
      (!safeSecond(now) || c.createdAt > now || c.expiresAt <= now)
    )
      throw new Error("Challenge is outside its validity window");
    const iat = c.createdAt;
    const exp = Math.min(iat + 60, c.expiresAt);
    if (!safeSecond(iat) || !safeSecond(exp) || exp <= iat)
      throw new Error("Invalid challenge lifetime");
    if (now !== undefined && exp <= now)
      throw new Error("Challenge proof has expired");
    const type = `daykeeper-${profile}+jwt`;
    const header = { alg: "ES256", typ: type };
    const payload = {
      sub: c.keyThumbprint,
      aud: audience,
      jti: c.id,
      nonce: c.nonce,
      request_hash: c.requestHash,
      iat,
      exp,
    };
    const encoded = `${b64urlJson(header)}.${b64urlJson(payload)}`;
    const raw = new Uint8Array(
      await subtle!.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.#privateKey,
        encoder.encode(encoded),
      ),
    );
    const signature = raw;
    if (signature.length !== 64)
      throw new Error("Unexpected ES256 signature format");
    if (this.#now !== undefined) {
      const finishedAt = this.#now();
      if (!safeSecond(finishedAt) || finishedAt < iat || finishedAt >= exp)
        throw new Error("Challenge proof has expired");
    }
    return `${encoded}.${b64url(signature)}`;
  }
}

function requireCrypto(): void {
  if (!subtle) throw new Error("Web Crypto is required");
}

function validatePrivateJwk(
  value: JsonWebKey,
): JsonWebKey & { x: string; y: string; d: string } {
  if (
    !value ||
    Object.keys(value).sort().join(",") !== "crv,d,kty,x,y" ||
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    typeof value.x !== "string" ||
    typeof value.y !== "string" ||
    typeof value.d !== "string" ||
    !canonical32(value.x) ||
    !canonical32(value.y) ||
    !canonical32(value.d)
  )
    throw new Error("Invalid machine owner key");
  return { ...value } as JsonWebKey & { x: string; y: string; d: string };
}

function minimalPublic(value: JsonWebKey): MachinePublicKey {
  return { kty: "EC", crv: "P-256", x: value.x!, y: value.y! };
}

function minimalPrivate(value: JsonWebKey): JsonWebKey {
  return { ...minimalPublic(value), d: value.d };
}

function validateChallenge(value: MachineChallenge, audience: string) {
  const c = value as Record<string, unknown>;
  const id = c.challengeId;
  if (
    Object.keys(c).sort().join(",") !==
      "audience,challengeId,createdAt,expiresAt,keyThumbprint,nonce,requestHash" ||
    typeof id !== "string" ||
    !uuid(id) ||
    c.audience !== audience ||
    typeof c.nonce !== "string" ||
    !canonical32(c.nonce) ||
    typeof c.keyThumbprint !== "string" ||
    !canonical32(c.keyThumbprint) ||
    typeof c.requestHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(c.requestHash) ||
    !safeSecond(c.createdAt) ||
    !safeSecond(c.expiresAt) ||
    c.expiresAt <= c.createdAt ||
    c.expiresAt - c.createdAt > 300
  )
    throw new Error("Invalid machine challenge");
  return {
    id,
    nonce: c.nonce,
    keyThumbprint: c.keyThumbprint,
    requestHash: c.requestHash,
    createdAt: c.createdAt as number,
    expiresAt: c.expiresAt as number,
  };
}

function requestBodyFor(
  input: MachineEnrollmentInput | MachineRotationInput,
  profile: "enrollment" | "credential-rotation",
  publicKey: JsonWebKey,
): Record<string, string> {
  const v = input as Record<string, unknown>;
  let body: Record<string, string>;
  if (profile === "enrollment") {
    if (
      Object.keys(v).sort().join(",") !== "idempotencyKey,name,publicKey" ||
      typeof v.name !== "string" ||
      typeof v.idempotencyKey !== "string" ||
      !samePublicKey(v.publicKey, publicKey)
    )
      throw new Error("Invalid enrollment input");
    const name = v.name.trim();
    if (
      name.length < 2 ||
      name.length > 120 ||
      !/^[A-Za-z0-9._:-]{16,128}$/.test(v.idempotencyKey)
    )
      throw new Error("Invalid enrollment input");
    body = {
      purpose: "daykeeper-machine-enrollment-v1",
      name,
      idempotencyKey: v.idempotencyKey,
    };
  } else {
    if (
      Object.keys(v).sort().join(",") !==
        "expectedCredentialId,intentId,ownerId" ||
      typeof v.ownerId !== "string" ||
      typeof v.expectedCredentialId !== "string" ||
      typeof v.intentId !== "string" ||
      !uuid(v.ownerId) ||
      !uuid(v.expectedCredentialId) ||
      !uuid(v.intentId)
    )
      throw new Error("Invalid rotation input");
    body = {
      purpose: "daykeeper-machine-credential-rotation-v1",
      ownerId: v.ownerId.toLowerCase(),
      expectedCredentialId: v.expectedCredentialId.toLowerCase(),
      intentId: v.intentId.toLowerCase(),
    };
  }
  return body;
}

async function requestHashFor(body: Record<string, string>): Promise<string> {
  return hex(await digest(JSON.stringify(body)));
}

function samePublicKey(a: unknown, b: JsonWebKey): boolean {
  if (!a || typeof a !== "object") return false;
  const value = a as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(",") === "crv,kty,x,y" &&
    value.kty === "EC" &&
    value.crv === "P-256" &&
    value.x === b.x &&
    value.y === b.y
  );
}

async function jwkThumbprint(jwk: JsonWebKey): Promise<string> {
  return b64url(
    await digest(
      JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y }),
    ),
  );
}
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle!.digest("SHA-256", encoder.encode(value)));
}
function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(value: Uint8Array): string {
  let s = "";
  for (const b of value) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function b64urlJson(value: unknown): string {
  return b64url(encoder.encode(JSON.stringify(value)));
}
function canonical32(value: string): boolean {
  try {
    const bytes = Uint8Array.from(
      atob(
        value.replaceAll("-", "+").replaceAll("_", "/") +
          "=".repeat((4 - (value.length % 4)) % 4),
      ),
      (c) => c.charCodeAt(0),
    );
    return bytes.length === 32 && b64url(bytes) === value;
  } catch {
    return false;
  }
}
function safeSecond(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
function canonicalAudience(value: string): string {
  const url = new URL(value);
  if (
    /[?#]/.test(value) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== value
  )
    throw new Error("Audience must be a canonical HTTPS URL");
  return value;
}
