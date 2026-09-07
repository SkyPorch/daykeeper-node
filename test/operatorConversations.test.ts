import assert from "node:assert/strict";
import test from "node:test";
import { DaykeeperClient } from "../src/client.ts";

const list = {
  tenantId: "tenant-1",
  conversations: [{ id: 42, status: "open", preview: "Hello" }],
};
const messages = {
  tenantId: "tenant-1",
  conversationId: 42,
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
    requests.map((request) => [request.method, new URL(request.url).pathname]),
    [
      ["GET", "/v1/tenants/tenant-1/conversations"],
      ["GET", "/v1/tenants/tenant-1/conversations/42/messages"],
      ["POST", "/v1/tenants/tenant-1/conversations/42/messages"],
    ],
  );
  assert.deepEqual(await requests[2].clone().json(), { content: "Reply" });
  assert.equal(requests[2].headers.get("idempotency-key"), null);
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
  assert.equal(calls, 0);
});
