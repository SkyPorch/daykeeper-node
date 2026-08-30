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

## API groups

- `capabilities()`
- `tenants.plan`, `tenants.apply`, `tenants.list`, `tenants.get`
- `emailChannels.plan`, `emailChannels.apply`, `emailChannels.get`
- `customerSessions.create`
- `operations.get`, `operations.retry`
- `flows.create`, `flows.list`, `flows.get`, `flows.getVersion`
- `flows.createVersion`, `flows.publishVersion`

`DaykeeperApiError` preserves the server's error code, retryability,
`nextActions`, field names, and correlation ID. `DaykeeperTransportError`
separates timeouts, aborts, network failures, invalid responses, and local
configuration errors.

## Release status

Version `0.1.0` is the initial contract. Its types are generated from the
vendored Daykeeper OpenAPI commit recorded in
[`openapi/SOURCE.md`](openapi/SOURCE.md). Releases use the protected,
provenance-producing process in [`RELEASING.md`](RELEASING.md).
