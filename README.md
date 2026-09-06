# `@skyporch/daykeeper`

The official, zero-runtime-dependency TypeScript and Node.js client for the
Daykeeper management API. It is designed for both human-built applications and
autonomous agents: every mutation has a typed input, provisioning uses
plan/apply, long-running work is represented by inspectable operations, and API
failures are structured.

See [`docs/quickstart.md`](docs/quickstart.md) for a minimal end-to-end example.

## Install

```sh
npm install @skyporch/daykeeper
```

The package provides ESM, CommonJS, and TypeScript declarations and requires
Node.js 20 or newer. It also works in trusted modern runtimes that provide the
standard Fetch API. Do not bundle it into a browser application: administrative
OAuth credentials belong on a server. Use `@skyporch/daykeeper-web` for
customer-facing browser experiences.

## Use

### Independent agent signup (unreleased)

The 0.2.0 candidate includes signed signup without a human login. These routes
must first be enabled by your Daykeeper operator; this is not yet a hosted
availability announcement. Signup creates a workspace and a scoped seven-day
credential, not a provisioned inbox or an active customer route.

Generate an owner key once with `createMachineOwnerKey()` and save its private
JWK in your secret store **before** requesting signup. Retain it independently
of the API credential: it is needed for credential rotation and recovery. Never
log or put the private key, proof, or returned token in source control.

```ts
import {
  DaykeeperClient,
  DaykeeperMachineSigner,
  DaykeeperOnboardingClient,
} from "@skyporch/daykeeper";

// Load the previously saved private JWK from your secret store.
const signer = await DaykeeperMachineSigner.fromPrivateKey(savedPrivateJwk);
const onboarding = new DaykeeperOnboardingClient({ baseUrl: daykeeperApiUrl });
// Pin the HTTPS audience from trusted operator configuration, not the response.
const audience = configuredEnrollmentAudience;
// Persist this exact intent before sending; reuse it for recovery.
const input = {
  name: "Acme Support",
  idempotencyKey: savedSignupIntentId,
  publicKey: signer.publicKey,
};
const challenge = await onboarding.enrollments.challenge(input);
const proof = await signer.signEnrollment(challenge, input, { audience });
const signup = await onboarding.enrollments.create({
  challengeId: challenge.challengeId,
  proof,
});
// Persist ownerId, organizationId, credential metadata, and the reveal-once
// token securely before proceeding. A replay has token: null.
if (signup.token === null) throw new Error("Recover the credential first");
const daykeeper = new DaykeeperClient({
  baseUrl: daykeeperApiUrl,
  apiKey: signup.token,
});
const entitlements = await daykeeper.entitlements.get();
if (!(await daykeeper.capabilities()).apiInboxes?.enabled) {
  throw new Error("This installation does not support API inbox preparation");
}
// No human administrator name or email is required for a machine-owned inbox.
const inboxPlan = await daykeeper.tenants.plan({
  name: "Acme Support",
  slug: "acme-support",
  locale: "en-US",
  inbox: { type: "api" },
});
// Save this intent ID and plan before applying. Replay with the same ID if lost.
const inbox = await daykeeper.tenants.apply(
  { planId: inboxPlan.id, planVersion: inboxPlan.version },
  { idempotencyKey: savedInboxIntentId },
);
const operation = await daykeeper.operations.get(inbox.operation.id);
// Inspect inboxes.get(inbox.tenant.id) after provisioning succeeds.
// A prepared inbox still does not mean customer traffic is enabled.
```

The onboarding client sends no cookies or management authorization, follows no
redirects, and never retries. Sign a freshly fetched challenge promptly: proofs
last at most 60 seconds from its creation. Check `outcomeUnknown` on errors;
an unreadable success or server failure can hide a committed mutation. Repeat
the original enrollment intent with a fresh challenge to recover its metadata,
not its secret. Never generate another owner key to retry a lost signup.

For rotation, persist `{ ownerId, expectedCredentialId, intentId }`, call
`credentialRotations.challenge`, sign with `signRotation` and the separately
configured rotation audience, then call `credentialRotations.create`. The old
credential is revoked atomically when the new one is issued. Replays return
metadata with `token: null`. After losing a rotation response, use a fresh
signed rotation proof with `credentialRotations.current` to discover the current
credential ID without changing it. Create a new explicit rotation intent using
that ID to obtain a replacement token. Do not automatically rotate on a timeout:
another process may already be using the successor.

Machine-owner domain verification is available through
`daykeeper.domainVerifications`. Call `create(tenantId, { origin }, { idempotencyKey })`
to receive the DNS TXT record, then use `get`, `verify`, or `revoke` with its
verification ID. This machine-owner-only receipt workflow does not activate
customer traffic. Check `capabilities().domainVerifications?.enabled` first.

Machine-owner API inbox activation is available through
`daykeeper.inboxActivations`. Call `create(tenantId, { idempotencyKey })`, then
use `get(tenantId, intent)` or `revoke(tenantId, intent)`. Activation does not
require DNS or a human verification step. An `active` receipt records the
activation intent, but is not a live-readiness guarantee; use
`daykeeper.inboxes.get(tenantId)` to inspect current inbox readiness.

Use the management API below to plan and provision an inbox after signup.
Preparation does not enable customer traffic; readiness and route activation
remain separate operator-controlled gates.

### Management API

```ts
import { DaykeeperClient } from "@skyporch/daykeeper";

const daykeeper = new DaykeeperClient({
  baseUrl: process.env.DAYKEEPER_API_URL!,
  token: () => process.env.DAYKEEPER_ACCESS_TOKEN!,
});

const plan = await daykeeper.tenants.plan({
  name: "Acme Support",
  slug: "acme-support",
  locale: "en-US",
  administrator: {
    name: "Support Lead",
    email: "support-lead@example.com",
  },
});

const result = await daykeeper.tenants.apply(
  { planId: plan.id, planVersion: plan.version },
  { idempotencyKey: crypto.randomUUID() },
);

console.log(result.operation.id);
```

`baseUrl` may be either a dedicated origin or an explicit reverse-proxy prefix
such as `https://support.daykeeper.example/daykeeper-api`. SDK paths remain
under that prefix.

Do not hard-code tokens. Pass a token provider when credentials can rotate. A
provider receives `{ forceRefresh: true }` once after a `401`, allowing OAuth
implementations to bypass their cache; the SDK never loops retries. The client
does not log requests, bodies, or credentials. Remote endpoints must use HTTPS;
HTTP is accepted only for loopback development.

Flow create/version/publish APIs are exposed, but the server currently reports
`flows.execution: "management_only"`. A published flow is therefore stored and
audited, not executed against conversations, until the execution safety gate is
delivered.

### Flow mutations are idempotent

`flows.create`, `flows.createVersion` and `flows.publishVersion` each require an
`idempotencyKey`. Generate one per logical change and keep it for as long as you
might repeat that change:

```ts
import { generateIdempotencyKey } from "@skyporch/daykeeper";

const idempotencyKey = generateIdempotencyKey();
const created = await daykeeper.flows.create(
  tenantId,
  { name: "Default handoff", slug: "default-handoff", definition },
  { idempotencyKey },
);

console.log(created.replayed); // false the first time, true on a replay
```

The key must be 16 to 128 characters from `A-Z a-z 0-9 . _ : -`; the SDK
rejects anything else before sending. Repeating the exact same request with the
same key returns the original flow with `replayed: true` instead of creating a
second one. Sending a different request with a key you already used is rejected
with the server's `IDEMPOTENCY_KEY_REUSED` code, so pick a new key for a new
change.

### Recovering from an uncertain outcome

If a mutation times out or its transport fails after the request left the SDK,
the thrown `DaykeeperTransportError` carries `outcomeUnknown: true` and
`retryable: false`. The server may or may not have applied the change, and the
SDK deliberately does not decide for you.

To recover, repeat the identical call with the **same** idempotency key. If the
first attempt landed, you get the stored result with `replayed: true`; if it did
not, the mutation is applied once. Never generate a fresh key to retry an
uncertain mutation, and never call `generateIdempotencyKey()` inside a retry
loop: that is how duplicates are created.

For the same reason, the one automatic authentication refresh after a `401`
applies to reads and to mutations that carry an idempotency key. A mutation
without a key is never sent twice by the SDK.

Trusted application servers can exchange their management credential for a
five-minute customer-gateway token without exposing management or
infrastructure-provider credentials to the app:

```ts
const session = await daykeeper.customerSessions.create(tenantId, {
  purpose: "customer",
  subject: customer.id,
  email: customer.email,
  name: customer.name,
  locale: customer.locale,
});
```

Use the separately scoped `lifecycle` and `erasure` purposes only from trusted
service jobs. The SDK returns the short-lived token but never receives the
control-plane signing key.

## First-inbox preparation (unreleased 0.2.0)

With a matching server, inspect `daykeeper.entitlements.get()` and
`daykeeper.capabilities()` before planning an inbox. The provisional
Free entitlement counts tenant admission only. Its legacy `metering` fields
do not inspect optional provider enforcement. It is not a shipped self-serve
free tier.

When `capabilities.apiInboxes?.enabled === true`, add `inbox: { type: "api" }`
to the tenant plan. This requires no customer website, DNS records or human
administrator metadata. Apply with an idempotency key, observe the operation,
then inspect `daykeeper.inboxes.get(tenantId)`. Do not include `website` and
`inbox` together. The hosted URL is installation configuration, not SDK input.

For a website inbox, when `capabilities.websiteInboxes?.enabled === true`, add
`website: { websiteUrl: "https://example.com/" }` to the existing tenant plan.
An absent capability means an older server does not support this option.
Apply with an idempotency key, then inspect the returned operation and
`daykeeper.websiteChannels.get(tenantId)`.

The metadata contains no provider secrets. `prepared` is not ready for traffic:
inspect `trafficEnabled` independently; this server version always returns
false. There is no SDK activation or credential-export method. These additions
require a future coordinated SDK/server release and are not in npm 0.1.0.

## Provisioning recovery (unreleased 0.2.0)

After a reload or lost apply response, list your tenants and recover an existing
tenant's creation operation without submitting another write:

```ts
const operation = await daykeeper.tenants.getProvisioningOperation(tenantId, {
  signal: AbortSignal.timeout(5_000),
});
console.log(operation.id, operation.state);
```

Requires both `daykeeper.accounts:read` and `daykeeper.provisioning:read` and
access to this tenant. This read never retries work or activates traffic.
An adopted tenant without a creation operation, or an older server, may return 404. Reconcile the original request; do not create another tenant as a fallback.
The method needs a coordinated SDK/server release and is not in npm 0.1.0.

## Usage inspection (unreleased 0.2.0)

```ts
const usage = await daykeeper.usage.get({ signal: AbortSignal.timeout(5_000) });
console.log(usage.resources.messageRecords, usage.period);
```

Requires organization-wide `daykeeper.billing:read`; tenant-bound credentials
are rejected even with that scope. There is no organization or period selector.
Counters are current-UTC-month resource records pooled within one cell, not
billable resolutions. Null limits mean unconfigured, never unlimited.
`writeAdmission: "not_evaluated"` means this read does not authorize traffic or
prove provider enforcement. There are no policy, reset, or activation methods.

An older server may omit `capabilities.usage` or return 404. Do not respond by
creating another tenant or retrying a mutation. This method needs a coordinated
server and SDK release; it is not present in npm 0.1.0.

## Agent credentials (unreleased 0.2.0)

Hosted OAuth is the preferred workload identity. When a headless environment
cannot complete OAuth, a current human organization owner can create a named,
expiring credential with only the scopes that workload needs:

```ts
const result = await daykeeper.agentCredentials.create(
  {
    name: "Production MCP",
    scopes: [
      "daykeeper.accounts:read",
      "daykeeper.flows:read",
      "daykeeper.provisioning:read",
    ],
    validityDays: 30,
  },
  { idempotencyKey: crypto.randomUUID() },
);

if (result.token) {
  // Show or transfer it once, then put it in a secret manager.
  // Do not log it, persist it in source, or pass it on a command line.
}
```

Use the saved credential only from a trusted server or workload:

```ts
const agent = new DaykeeperClient({
  baseUrl: process.env.DAYKEEPER_API_URL!,
  apiKey: process.env.DAYKEEPER_API_KEY!,
});
```

`apiKey` is the conventional static-credential path. Use `token` with a token
provider for hosted OAuth and rotation; configure exactly one of them.

`agentCredentials.list()` returns bounded metadata only. Revoke immediately with
`agentCredentials.revoke(id)`. A repeated exact create request returns the
original metadata with `token: null`; Daykeeper cannot recover the original
secret. After an uncertain response, inspect the list and repeat only the exact
approved request with the same idempotency key. Never create a different
credential as an automatic retry.

Agent credentials cannot delegate credential administration, member changes,
customer lifecycle, or erasure. This API requires a future coordinated
SDK/server release and a server with `capabilities.agentCredentials.enabled`;
it is not present in npm 0.1.0 and this source change does not enable it.

## API groups

- `capabilities()`
- `entitlements.get`
- `agentCredentials.list`, `agentCredentials.create`, `agentCredentials.revoke`
- `websiteChannels.get`
- `inboxes.get`
- `tenants.plan`, `tenants.apply`, `tenants.list`, `tenants.get`
- `tenants.getProvisioningOperation`
- `emailChannels.plan`, `emailChannels.apply`, `emailChannels.get`
- `customerSessions.create`
- `operations.get`, `operations.retry`
- `flows.create`, `flows.list`, `flows.get`, `flows.getVersion`
- `flows.createVersion`, `flows.publishVersion`
- `generateIdempotencyKey()`

There is no generic request escape hatch: the client calls only the fixed
contract paths above, resolved under the configured `baseUrl`. A base URL that
hides a second path level behind an encoded separator is rejected when the
client is constructed.

`DaykeeperApiError` preserves the server's error code, status, retryability,
`nextActions`, field names, and correlation ID, and nothing else from the
response body. `DaykeeperTransportError` separates timeouts, aborts, network
failures, invalid responses, and local configuration errors. Both carry
`outcomeUnknown`, which is true only when a mutation may already have been
applied.

## Deadlines and cancellation

`timeoutMs` defaults to 30 seconds (allowed range: 1–60 seconds). It is one
budget for token acquisition, the request, its single authentication refresh,
and response-body reads. Token providers receive an optional `signal` alongside
`forceRefresh`; pass it to your credential exchange to cancel that work too.

Pass a caller `signal` in the request options accepted by customer-session,
plan-apply, agent-credential, entitlement-read and website-read methods. Pre-aborted calls do not invoke the token provider or send a
request. Cancellation returns `REQUEST_ABORTED`; deadline expiry returns
`REQUEST_TIMEOUT`. A stalled provider or custom fetch cannot keep the SDK call
pending after that deadline, and a late token cannot start a new request.

Cancellation does not undo a request the server already accepted. A retryable
transport error is not proof that a mutation is safe to repeat. When a mutation
fails after dispatch the error reports `outcomeUnknown: true` and is never
marked retryable; inspect the operation or repeat the call with the original
idempotency key. The SDK does not automatically replay network failures or
timeouts.

Credential-provider failures use the non-retryable `TOKEN_PROVIDER_ERROR`
code, distinct from network failures. Raw provider errors are not exposed.
Handle sign-in recovery in the token provider or the application; deadline and
caller cancellation still use their dedicated error codes.

## Release status

Version `0.1.0` is the initial contract, and was published by hand with no
provenance attestation despite the `publishConfig.provenance` declaration; see
[`RELEASING.md`](RELEASING.md). `0.2.0` is unreleased and breaking. Types are
generated from the vendored Daykeeper OpenAPI commit recorded in
[`openapi/SOURCE.md`](openapi/SOURCE.md); the SDK-to-contract mapping is in
[`COMPATIBILITY.md`](COMPATIBILITY.md). Releases use the protected,
provenance-producing process in [`RELEASING.md`](RELEASING.md).
