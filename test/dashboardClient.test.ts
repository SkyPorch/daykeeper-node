import assert from "node:assert/strict";
import test from "node:test";
import { DaykeeperClient } from "../src/client.ts";

test("profile and workspaces use the connected access token without a selector", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    token: "workspace-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const data = request.url.endsWith("/profile")
        ? {
            userId: "10000000-0000-4000-8000-000000000001",
            name: "Alex",
            email: "alex@example.com",
            organizationId: "20000000-0000-4000-8000-000000000001",
            workspace: {
              organizationId: "20000000-0000-4000-8000-000000000001",
              organizationSlug: "acme",
              name: "Acme",
            },
          }
        : {
            items: [
              {
                organizationId: "20000000-0000-4000-8000-000000000001",
                organizationSlug: "acme",
                name: "Acme",
                role: "owner",
              },
            ],
          };
      return Response.json({ data });
    },
  });

  assert.equal((await client.profile.get()).workspace.name, "Acme");
  assert.equal((await client.workspaces.list()).items[0]?.role, "owner");
  assert.deepEqual(
    requests.map((request) => [request.method, new URL(request.url).pathname]),
    [
      ["GET", "/v1/profile"],
      ["GET", "/v1/workspaces"],
    ],
  );
  assert.ok(
    requests.every(
      (request) =>
        request.headers.get("authorization") === "Bearer workspace-token",
    ),
  );
});

test("customer email settings read and write the enabled field", async () => {
  const requests: Request[] = [];
  const settings = {
    tenantId: "20000000-0000-4000-8000-000000000001",
    enabled: true,
    customSender: false,
    senderName: "Acme",
    sendingDomain: "mail.example.com",
    deliveryEnabled: true,
  };
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    token: "workspace-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({ data: settings });
    },
  });

  assert.deepEqual(await client.customerEmail.get(settings.tenantId), settings);
  assert.deepEqual(
    await client.customerEmail.set(settings.tenantId, { enabled: true }),
    settings,
  );
  assert.deepEqual(
    requests.map((request) => [request.method, new URL(request.url).pathname]),
    [
      ["GET", `/v1/tenants/${settings.tenantId}/customer-email`],
      ["POST", `/v1/tenants/${settings.tenantId}/customer-email`],
    ],
  );
  assert.deepEqual(await requests[1]?.clone().json(), { enabled: true });
});

test("customer email input must be exactly { enabled: boolean }", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    token: "workspace-token",
    fetch: async () => {
      calls += 1;
      return Response.json({ data: {} });
    },
  });
  for (const input of [
    {},
    { enabled: "yes" },
    { enabled: true, senderName: "x" },
  ])
    await assert.rejects(
      () =>
        client.customerEmail.set(
          "20000000-0000-4000-8000-000000000001",
          input as { enabled: boolean },
        ),
      { code: "INVALID_CONFIGURATION" },
    );
  assert.equal(calls, 0);
});

test("a workspace without a role is accepted, as the deployed server sends it", async () => {
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    token: "workspace-token",
    fetch: async () =>
      Response.json({
        data: {
          items: [
            {
              organizationId: "20000000-0000-4000-8000-000000000001",
              organizationSlug: "acme",
              name: "Acme",
            },
          ],
        },
      }),
  });
  const { items } = await client.workspaces.list();
  assert.equal(items[0]?.role, undefined);
});
