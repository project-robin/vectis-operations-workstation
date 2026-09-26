import { Webhook } from "standardwebhooks";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { MAX_CLERK_WEBHOOK_BYTES } from "./http/clerkWebhook";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const secret = `whsec_${Buffer.from("task3-route-security-secret").toString("base64")}`;

function headers(body: string, id: string, timestamp = new Date()) {
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign(id, timestamp, body),
  };
}

async function withSecret<T>(callback: () => Promise<T>): Promise<T> {
  const previous = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = secret;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    else process.env.CLERK_WEBHOOK_SIGNING_SECRET = previous;
  }
}

test("Clerk HTTP ingress rejects a missing signature", async () => {
  await withSecret(async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ type: "user.created", data: { id: "missing-signature" } });
    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "svix-id": "missing-signature" },
      body,
    });
    expect(response.status).toBe(400);
  });
});

test("Clerk HTTP ingress rejects an invalid signature", async () => {
  await withSecret(async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ type: "user.created", data: { id: "invalid-signature" } });
    const requestHeaders = headers(body, "invalid-signature");
    requestHeaders["svix-signature"] = "v1.invalid";
    const response = await t.fetch("/clerk/webhook", { method: "POST", headers: requestHeaders, body });
    expect(response.status).toBe(400);
  });
});

test("Clerk HTTP ingress accepts a valid synthetic Standard Webhooks signature", async () => {
  await withSecret(async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ type: "user.created", data: { id: "valid-signature" } });
    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: headers(body, "valid-signature"),
      body,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: false });
  });
});

test("Clerk HTTP ingress rejects empty bodies and non-POST methods", async () => {
  await withSecret(async () => {
    const t = convexTest(schema, modules);
    const empty = await t.fetch("/clerk/webhook", { method: "POST" });
    expect(empty.status).toBe(400);
    const get = await t.fetch("/clerk/webhook", { method: "GET" });
    expect([404, 405]).toContain(get.status);
  });
});

test("Clerk HTTP ingress rejects a declared oversize before reading the body", async () => {
  await withSecret(async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: { "content-length": String(MAX_CLERK_WEBHOOK_BYTES + 1) },
      body: "{}",
    });
    expect(response.status).toBe(413);
  });
});

test("Clerk HTTP ingress rejects streamed/chunked oversize bodies", async () => {
  await withSecret(async () => {
    const t = convexTest(schema, modules);
    const encoder = new TextEncoder();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.close();
          return;
        }
        sent = true;
        controller.enqueue(encoder.encode("x".repeat(MAX_CLERK_WEBHOOK_BYTES + 1)));
      },
    });
    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(response.status).toBe(413);
  });
});

test("duplicate signed replay is acknowledged without a second lifecycle write", async () => {
  await withSecret(async () => {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ type: "user.created", data: { id: "duplicate-replay" } });
    const first = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: headers(body, "duplicate-replay"),
      body,
    });
    const second = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: headers(body, "duplicate-replay", new Date(Date.now() + 1000)),
      body,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ ok: true, duplicate: true });
    await expect(
      t.run(async (ctx) =>
        (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "duplicate-replay")).collect()).length,
      ),
    ).resolves.toBe(1);
  });
});
