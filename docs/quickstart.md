# Quickstart

Install the SDK and set two environment variables:

```sh
npm install @skyporch/daykeeper
export DAYKEEPER_API_URL="https://api.daykeeper.example"
export DAYKEEPER_API_KEY="…"   # a reveal-once agent credential
```

`DAYKEEPER_API_URL` must be an absolute HTTPS URL (plain HTTP is accepted only
for loopback development). The client takes exactly one credential: `apiKey` for
a static server-side key, or `token` for an OAuth access token or a rotating
token provider. Passing both is a configuration error.

```ts
import { DaykeeperClient, generateIdempotencyKey } from "@skyporch/daykeeper";

const client = new DaykeeperClient({
  baseUrl: process.env.DAYKEEPER_API_URL!,
  apiKey: process.env.DAYKEEPER_API_KEY!,
});
```

## Read

```ts
const tenants = await client.tenants.list();
console.log(tenants.map((tenant) => tenant.id));
```

## Write, idempotently

Flow mutations require an idempotency key. Mint one key per logical mutation and
reuse that same key if you have to repeat the call — the server then returns the
stored result instead of applying the change twice.

```ts
const idempotencyKey = generateIdempotencyKey();

const result = await client.flows.create(
  tenants[0].id,
  {
    name: "Inbound triage",
    slug: "inbound-triage",
    definition: {
      schemaVersion: "2026-08-01",
      trigger: { event: "conversation.created", channel: "email" },
      conditions: [],
      actions: [
        { id: "reply-1", type: "reply", text: "Thanks — we're on it." },
      ],
    },
  },
  { idempotencyKey },
);

// True when an earlier identical call under this key was replayed
// and no new write was applied.
console.log(result.replayed, result.flow.id, result.version.version);
```

If a mutation fails before any response arrives the error reports
`outcomeUnknown: true`: repeat the same call with the same `idempotencyKey`
rather than retrying blindly.
