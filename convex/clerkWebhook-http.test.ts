import { Webhook } from "standardwebhooks";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const secret = `whsec_${Buffer.from("task3-route-secret").toString("base64")}`;

function signedHeaders(body: string, timestamp = new Date()) {
  const id = "msg_task3_route";
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign(id, timestamp, body),
  };
}

test("Clerk HTTP ingress fails closed without a signing secret", async () => {
  const previous = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  try {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "user.created", data: { id: "secretless" } }),
    });
    expect(response.status).toBe(503);
  } finally {
    if (previous === undefined) delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    else process.env.CLERK_WEBHOOK_SIGNING_SECRET = previous;
  }
});

test("signed Clerk HTTP events are idempotent", async () => {
  const previous = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = secret;
  try {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ type: "user.created", data: { id: "user_http" } });
    const first = await t.fetch("/clerk/webhook", { method: "POST", headers: signedHeaders(body), body });
    const second = await t.fetch("/clerk/webhook", { method: "POST", headers: signedHeaders(body), body });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ ok: true, duplicate: false });
    await expect(second.json()).resolves.toEqual({ ok: true, duplicate: true });
    await expect(
      t.run(async (ctx) => (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "user_http")).collect()).length),
    ).resolves.toBe(1);
  } finally {
    if (previous === undefined) delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    else process.env.CLERK_WEBHOOK_SIGNING_SECRET = previous;
  }
});

test("signed Clerk HTTP events with an out-of-window Svix timestamp are rejected", async () => {
  const previous = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = secret;
  try {
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ type: "user.created", data: { id: "stale_http" } });
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: signedHeaders(body, stale),
      body,
    });
    expect(response.status).toBe(400);
    await expect(
      t.run(async (ctx) =>
        (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "stale_http")).collect()).length,
      ),
    ).resolves.toBe(0);
  } finally {
    if (previous === undefined) delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    else process.env.CLERK_WEBHOOK_SIGNING_SECRET = previous;
  }
});
