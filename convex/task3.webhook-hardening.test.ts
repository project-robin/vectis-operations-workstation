import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import {
  MAX_CLERK_EVENT_ID_LENGTH,
  MAX_CLERK_EVENT_TYPE_LENGTH,
  MAX_CLERK_WEBHOOK_BYTES,
} from "./http/clerkWebhook";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function payload(eventId: string, eventType: string, data: object = {}) {
  return JSON.stringify({ id: eventId, type: eventType, data });
}

test.each([
  ["event id", "eventId", "x".repeat(MAX_CLERK_EVENT_ID_LENGTH + 1)],
  ["event type", "eventType", "x".repeat(MAX_CLERK_EVENT_TYPE_LENGTH + 1)],
  ["payload", "payload", `{"type":"user.created","data":"${"x".repeat(MAX_CLERK_WEBHOOK_BYTES)}"}`],
] as const)("rejects oversized %s before ledger insertion or hashing", async (_label, field, value) => {
  const t = convexTest(schema, modules);
  const args = {
    eventId: "bounded-event",
    eventType: "user.created",
    payload: payload("bounded-event", "user.created", { id: "bounded-user" }),
    eventTimestamp: Date.now(),
  };
  args[field] = value;

  await expect(t.mutation(internal.http.clerkWebhook.processEvent, args)).rejects.toThrow(/exceeds|too large/i);
  await expect(t.run(async (ctx) => ctx.db.query("webhookEvents").collect())).resolves.toHaveLength(0);
});

test("webhook ledger cleanup keeps recent replays and removes expired metadata in bounded continuations", async () => {
  const t = convexTest(schema, modules);
  const now = 10 * 24 * 60 * 60 * 1000;
  const retention = 7 * 24 * 60 * 60 * 1000;
  const expiredCount = 102;

  await t.run(async (ctx) => {
    for (let index = 0; index < expiredCount; index += 1) {
      await ctx.db.insert("webhookEvents", {
        eventId: `expired-${index}`,
        eventType: "user.updated",
        receivedAt: now - retention - index - 1,
        eventTimestamp: now - retention - index - 1,
      });
    }
    await ctx.db.insert("webhookEvents", {
      eventId: "recent-replay",
      eventType: "user.updated",
      receivedAt: now - retention + 1,
      eventTimestamp: now - retention + 1,
    });
  });

  const first = await t.mutation(internal.http.clerkWebhook.cleanupRetention, { now });
  expect(first).toMatchObject({ deleted: 100, continued: true });
  await expect(t.run(async (ctx) => ctx.db.query("webhookEvents").collect())).resolves.toHaveLength(3);

  await t.mutation(internal.http.clerkWebhook.continueRetentionCleanup, {
    before: now - retention,
  });
  await expect(t.run(async (ctx) => ctx.db.query("webhookEvents").collect())).resolves.toEqual([
    expect.objectContaining({ eventId: "recent-replay" }),
  ]);
});