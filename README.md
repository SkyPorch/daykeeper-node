# `@skyporch/daykeeper`

The official, zero-runtime-dependency TypeScript and Node.js client for the
Daykeeper management API. It is designed for both human-built applications and
autonomous agents: every mutation has a typed input, provisioning uses
plan/apply, long-running work is represented by inspectable operations, and API
failures are structured.

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
`daykeeper.capabilities()` before planning a website inbox. The provisional
Free entitlement counts tenant admission only. Its legacy `metering` fields
do not inspect optional provider enforcement. It is not a shipped self-serve
free tier.

When `capabilities.websiteInboxes?.enabled === true`, add
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
- `tenants.plan`, `tenants.apply`, `tenants.list`, `tenants.get`
- `tenants.getProvisioningOperation`
- `emailChannels.plan`, `emailChannels.apply`, `emailChannels.get`
- `customerSessions.create`
- `operations.get`, `operations.retry`
- `flows.create`, `flows.list`, `flows.get`, `flows.getVersion`
- `flows.createVersion`, `flows.publishVersion`

`DaykeeperApiError` preserves the server's error code, retryability,
`nextActions`, field names, and correlation ID. `DaykeeperTransportError`
separates timeouts, aborts, network failures, invalid responses, and local
configuration errors.

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
transport error is not proof that a mutation is safe to repeat. Inspect the
operation or reuse the original idempotency key where supported; the SDK does
not automatically replay network failures or timeouts.

Credential-provider failures use the non-retryable `TOKEN_PROVIDER_ERROR`
code, distinct from network failures. Raw provider errors are not exposed.
Handle sign-in recovery in the token provider or the application; deadline and
caller cancellation still use their dedicated error codes.

## Release status

Version `0.1.0` is the initial contract. Its types are generated from the
vendored Daykeeper OpenAPI commit recorded in
[`openapi/SOURCE.md`](openapi/SOURCE.md). Releases use the protected,
provenance-producing process in [`RELEASING.md`](RELEASING.md).
