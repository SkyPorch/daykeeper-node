import assert from "node:assert/strict";
import test from "node:test";
import { DaykeeperClient } from "../src/client.ts";

const list = {
  tenantId: "tenant-1",
  conversations: [{ id: 42, status: "open", preview: "Hello" }],
  page: { limit: 50, nextCursor: null, hasMore: false },
};
const messages = {
  tenantId: "tenant-1",
  conversationId: 42,
  page: { limit: 50, nextCursor: null, hasMore: false },
  messages: [
    {
      id: 7,
      conversationId: 42,
      senderType: "Contact",
      messageType: 0,
      content: "Hello",
      createdAt: "2026-09-07T00:00:00Z",
    },
  ],
};
const conversation = {
  tenantId: "tenant-1",
  conversationId: 42,
  conversation: { id: 42, status: "open", preview: "Hello" },
};

test("operator conversation methods use tenant-qualified paths and envelopes", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "operator-key",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const body =
        request.method === "POST"
          ? {
              tenantId: "tenant-1",
              conversationId: 42,
              message: {
                ...messages.messages[0],
                id: 8,
                senderType: "User",
                content: "Reply",
              },
            }
          : request.method === "PATCH"
            ? {
                tenantId: "tenant-1",
                conversationId: 42,
                conversation: { id: 42, status: "resolved", preview: "Hello" },
              }
            : request.method === "GET" &&
                request.url.endsWith("/conversations/42")
              ? conversation
              : request.url.endsWith("/messages")
                ? messages
                : list;
      return Response.json(
        { data: body },
        { status: request.method === "POST" ? 201 : 200 },
      );
    },
  });

  assert.deepEqual(await client.operatorConversations.list("tenant-1"), list);
  assert.deepEqual(
    await client.operatorConversations.get("tenant-1", 42),
    conversation,
  );
  assert.deepEqual(
    await client.operatorConversations.messages("tenant-1", 42),
    messages,
  );
  assert.deepEqual(
    await client.operatorConversations.reply("tenant-1", 42, "  Reply  "),
    {
      tenantId: "tenant-1",
      conversationId: 42,
      message: {
        ...messages.messages[0],
        id: 8,
        senderType: "User",
        content: "Reply",
      },
    },
  );
  assert.deepEqual(
    await client.operatorConversations.setStatus("tenant-1", 42, {
      status: "resolved",
    }),
    {
      tenantId: "tenant-1",
      conversationId: 42,
      conversation: { id: 42, status: "resolved", preview: "Hello" },
    },
  );
  assert.deepEqual(
    requests.map((request) => [request.method, new URL(request.url).pathname]),
    [
      ["GET", "/v1/tenants/tenant-1/conversations"],
      ["GET", "/v1/tenants/tenant-1/conversations/42"],
      ["GET", "/v1/tenants/tenant-1/conversations/42/messages"],
      ["POST", "/v1/tenants/tenant-1/conversations/42/messages"],
      ["PATCH", "/v1/tenants/tenant-1/conversations/42"],
    ],
  );
  assert.deepEqual(await requests[3].clone().json(), { content: "Reply" });
  assert.equal(requests[3].headers.get("idempotency-key"), null);
  assert.deepEqual(await requests[4].clone().json(), { status: "resolved" });
});

test("operator conversation paging and reply request ids map to query and header", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    token: "workspace-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const body =
        request.method === "POST"
          ? {
              tenantId: "tenant-1",
              conversationId: 42,
              message: messages.messages[0],
            }
          : request.url.endsWith("/messages")
            ? messages
            : list;
      return Response.json({ data: body }, { status: 200 });
    },
  });

  await client.operatorConversations.list("tenant-1", {
    cursor: "list-cursor",
    limit: 25,
  });
  await client.operatorConversations.messages("tenant-1", 42, {
    cursor: "older-cursor",
    limit: 40,
  });
  await client.operatorConversations.reply("tenant-1", 42, "Reply", {
    requestId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(
    new URL(requests[0].url).searchParams.get("cursor"),
    "list-cursor",
  );
  assert.equal(new URL(requests[0].url).searchParams.get("limit"), "25");
  assert.equal(
    new URL(requests[1].url).searchParams.get("cursor"),
    "older-cursor",
  );
  assert.equal(new URL(requests[1].url).searchParams.get("limit"), "40");
  assert.equal(
    requests[2].headers.get("idempotency-key"),
    "00000000-0000-4000-8000-000000000001",
  );
});

test("operator replies never retry an uncertain POST", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "operator-key",
    fetch: async () => {
      calls += 1;
      throw new Error("connection lost");
    },
  });
  await assert.rejects(
    () => client.operatorConversations.reply("tenant-1", 42, "Reply"),
    { code: "NETWORK_ERROR", outcomeUnknown: true, retryable: false },
  );
  assert.equal(calls, 1);
});

test("operator reply preserves a server-marked unknown outcome", async () => {
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "operator-key",
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "OPERATOR_UNAVAILABLE",
            message: "The reply outcome is unknown",
            retryable: true,
            outcomeUnknown: true,
            nextActions: ["inspect_messages"],
            correlationId: "reply-123",
          },
        },
        { status: 500 },
      ),
  });
  await assert.rejects(
    () => client.operatorConversations.reply("tenant-1", 42, "Reply"),
    (error: unknown) => {
      assert.equal((error as { outcomeUnknown: boolean }).outcomeUnknown, true);
      assert.equal((error as { retryable: boolean }).retryable, false);
      return true;
    },
  );
});

test("operator conversation inputs fail before transport", async () => {
  let calls = 0;
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "operator-key",
    fetch: async () => {
      calls += 1;
      return Response.json({ data: list });
    },
  });
  await assert.rejects(
    () => client.operatorConversations.messages("tenant", 0),
    { code: "INVALID_CONFIGURATION" },
  );
  await assert.rejects(
    () =>
      client.operatorConversations.reply(
        "tenant",
        Number.MAX_SAFE_INTEGER + 1,
        "Reply",
      ),
    { code: "INVALID_CONFIGURATION" },
  );
  await assert.rejects(
    () => client.operatorConversations.reply("tenant", 1, "   "),
    { code: "INVALID_CONFIGURATION" },
  );
  // Paging bounds match the server (contract 1.9.0): limit 1-100 on both
  // lists, cursor at most 256 characters.
  for (const options of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { cursor: "" },
    { cursor: "c".repeat(257) },
    { cursor: "line\nbreak" },
  ]) {
    await assert.rejects(
      () => client.operatorConversations.list("tenant", options),
      { code: "INVALID_CONFIGURATION" },
      JSON.stringify(options),
    );
    await assert.rejects(
      () => client.operatorConversations.messages("tenant", 1, options),
      { code: "INVALID_CONFIGURATION" },
      JSON.stringify(options),
    );
  }
  await assert.rejects(() => client.operatorConversations.get("tenant", 0), {
    code: "INVALID_CONFIGURATION",
  });
  await assert.rejects(
    () =>
      client.operatorConversations.setStatus("tenant", 1, {
        status: "pending" as "open",
      }),
    { code: "INVALID_CONFIGURATION" },
  );
  await assert.rejects(
    () =>
      client.operatorConversations.reply("tenant", 1, "Reply", {
        requestId: "not-a-uuid",
      }),
    { code: "INVALID_CONFIGURATION" },
  );
  assert.equal(calls, 0);
});

test("operator lists accept the server bounds and older servers without page", async () => {
  const requests: Request[] = [];
  const client = new DaykeeperClient({
    baseUrl: "https://api.example.com",
    apiKey: "operator-key",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      // A server before contract 1.9.0 ignores paging and omits `page`.
      return Response.json({
        data: request.url.includes("/messages")
          ? {
              tenantId: "tenant-1",
              conversationId: 42,
              messages: messages.messages,
            }
          : { tenantId: "tenant-1", conversations: list.conversations },
      });
    },
  });
  const cursor = "c".repeat(256);
  const page = await client.operatorConversations.list("tenant-1", {
    limit: 100,
    cursor,
  });
  assert.equal(page.page, undefined);
  const history = await client.operatorConversations.messages("tenant-1", 42, {
    limit: 100,
  });
  assert.equal(history.page, undefined);
  assert.equal(new URL(requests[0].url).searchParams.get("limit"), "100");
  assert.equal(new URL(requests[0].url).searchParams.get("cursor"), cursor);
  assert.equal(new URL(requests[1].url).searchParams.get("limit"), "100");
  // No paging options sends no query at all, exactly as before 0.6.0.
  await client.operatorConversations.list("tenant-1");
  assert.equal(new URL(requests[2].url).search, "");
});
