import { verifyWebhook } from "@clerk/backend/webhooks";
import { v } from "convex/values";
import { httpAction, internalMutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { processClerkEvent } from "../lib/lifecycle";
import {
  MAX_CLERK_EVENT_ID_LENGTH,
  MAX_CLERK_EVENT_TYPE_LENGTH,
  MAX_CLERK_WEBHOOK_BYTES,
  MAX_CLERK_WEBHOOK_PAYLOAD_LENGTH,
} from "../lib/webhookLimits";

export {
  MAX_CLERK_EVENT_ID_LENGTH,
  MAX_CLERK_EVENT_TYPE_LENGTH,
  MAX_CLERK_WEBHOOK_BYTES,
  MAX_CLERK_WEBHOOK_PAYLOAD_LENGTH,
};
export const MAX_CLERK_EVENT_AGE_MS = 5 * 60 * 1000;
export const MAX_CLERK_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const CLERK_WEBHOOK_LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CLERK_WEBHOOK_LEDGER_CLEANUP_BATCH_SIZE = 100;

export const processEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    payload: v.string(),
    eventTimestamp: v.number(),
  },
  handler: async (ctx, args) => processClerkEvent(ctx, args),
});

async function deleteExpiredLedgerBatch(ctx: MutationCtx, before: number) {
  const rows = await ctx.db
    .query("webhookEvents")
    .withIndex("by_received_at", (q) => q.lt("receivedAt", before))
    .order("asc")
    .take(CLERK_WEBHOOK_LEDGER_CLEANUP_BATCH_SIZE + 1);
  for (const row of rows.slice(0, CLERK_WEBHOOK_LEDGER_CLEANUP_BATCH_SIZE)) {
    await ctx.db.delete(row._id);
  }
  const continued = rows.length > CLERK_WEBHOOK_LEDGER_CLEANUP_BATCH_SIZE;
  if (continued) {
    await ctx.scheduler.runAfter(0, internal.http.clerkWebhook.continueRetentionCleanup, { before });
  }
  return { deleted: Math.min(rows.length, CLERK_WEBHOOK_LEDGER_CLEANUP_BATCH_SIZE), continued };
}

export const cleanupRetention = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now <= 0) throw new Error("Invalid webhook retention clock");
    return deleteExpiredLedgerBatch(ctx, now - CLERK_WEBHOOK_LEDGER_RETENTION_MS);
  },
});

export const continueRetentionCleanup = internalMutation({
  args: { before: v.number() },
  handler: async (ctx, args) => deleteExpiredLedgerBatch(ctx, args.before),
});

async function boundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isFinite(length) || length < 0 || length > MAX_CLERK_WEBHOOK_BYTES) {
      throw new Error("Webhook request too large");
    }
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_CLERK_WEBHOOK_BYTES) throw new Error("Webhook request too large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function verifiedEventTimestamp(request: Request): number {
  const value = request.headers.get("svix-timestamp");
  const seconds = value === null ? Number.NaN : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("Invalid webhook timestamp");
  const timestamp = seconds * 1000;
  const now = Date.now();
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < now - MAX_CLERK_EVENT_AGE_MS ||
    timestamp > now + MAX_CLERK_EVENT_FUTURE_SKEW_MS
  ) {
    throw new Error("Webhook timestamp outside accepted window");
  }
  return timestamp;
}

/** Official Clerk SDK verification seam; callers must supply a non-empty secret. */
export async function verifyClerkRequest(request: Request, signingSecret: string) {
  if (!signingSecret) throw new Error("Clerk webhook signing secret is not configured");
  return verifyWebhook(request, { signingSecret });
}

export const handle = httpAction(async (ctx, request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) return new Response("Webhook unavailable", { status: 503 });
  let payload: string;
  try {
    payload = await boundedBody(request);
  } catch {
    return new Response("Webhook request too large", { status: 413 });
  }
  if (!payload) return new Response("Invalid webhook", { status: 400 });
  try {
    // Rebuild from the exact bytes consumed above; signature verification is over the raw body.
    const signedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: payload,
    });
    const eventId = request.headers.get("svix-id");
    if (!eventId) throw new Error("Missing webhook event id");
    if (eventId.length > MAX_CLERK_EVENT_ID_LENGTH) throw new Error("Webhook event id too long");
    const event = await verifyClerkRequest(signedRequest, signingSecret);
    const eventTimestamp = verifiedEventTimestamp(request);
    const result = await ctx.runMutation(internal.http.clerkWebhook.processEvent, {
      eventId,
      eventType: event.type,
      payload,
      eventTimestamp,
    });
    return Response.json({ ok: true, duplicate: result.duplicate });
  } catch {
    // Do not expose verifier errors, payloads, identifiers, or configuration values.
    return new Response("Invalid webhook signature", { status: 400 });
  }
});
