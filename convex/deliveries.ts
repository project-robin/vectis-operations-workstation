import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { internal } from "./_generated/api";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";

const target = v.union(v.literal("twenty_person"), v.literal("twenty_note"), v.literal("twenty_task"), v.literal("twenty_appointment"));
const deliveryStatus = v.union(v.literal("pending"), v.literal("claimed"), v.literal("succeeded"), v.literal("failed"), v.literal("ambiguous"), v.literal("reconciliation_required"));
const MAX_BATCH = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 60_000;

type DeliveryTarget = "twenty_person" | "twenty_note" | "twenty_task" | "twenty_appointment";
type DeliveryStatus = "pending" | "claimed" | "succeeded" | "failed" | "ambiguous" | "reconciliation_required";

function assertBounded(value: string, name: string, max = 512) { if (!value || value.length > max) throw new Error(`${name} is invalid`); }
function payloadHash(payload: string) { let hash = 2166136261; for (let i = 0; i < payload.length; i += 1) { hash ^= payload.charCodeAt(i); hash = Math.imul(hash, 16777619); } return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`; }

async function assertCustomer(ctx: MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.organizationId !== organizationId || customer.mergedInto) throw new Error("Customer does not belong to organization");
}

async function findExisting(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, idempotencyKey: string) {
  const rows = await ctx.db.query("deliveries").withIndex("by_organization_idem", (q) => q.eq("organizationId", organizationId).eq("idempotencyKey", idempotencyKey)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate delivery idempotency key");
  return rows[0] ?? null;
}

export const getDelivery = query({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.organizationId !== organizationId) throw new Error("Delivery not found");
    return row;
  },
});

export const listDeliveries = query({
  args: { status: v.optional(deliveryStatus), paginationOpts: v.optional(v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) })) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const opts = args.paginationOpts ?? { numItems: 50, cursor: null };
    if (!Number.isSafeInteger(opts.numItems) || opts.numItems < 1 || opts.numItems > MAX_BATCH) throw new Error("Pagination is invalid");
    const offset = opts.cursor ? Number(opts.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid delivery cursor");
    const rows = args.status
      ? await ctx.db.query("deliveries").withIndex("by_organization_status_next", (q) => q.eq("organizationId", organizationId).eq("status", args.status!)).order("desc").take(MAX_BATCH * 5)
      : await ctx.db.query("deliveries").withIndex("by_organization_lease", (q) => q.eq("organizationId", organizationId)).order("desc").take(MAX_BATCH * 5);
    const page = rows.slice(offset, offset + opts.numItems);
    const next = offset + page.length;
    return { page, isDone: next >= rows.length, continueCursor: next >= rows.length ? null : String(next) };
  },
});

export async function reserveDelivery(ctx: MutationCtx, args: { organizationId: GenericId<"organizations">; idempotencyKey: string; target: DeliveryTarget; payload: string; customerId?: GenericId<"customers">; providerRunId?: string; bindingId?: GenericId<"integrationBindings">; bindingKey?: string; maxAttempts?: number; payloadVersion?: number; now?: number; actor?: GenericId<"users">; correlationId?: string }) {
  assertBounded(args.idempotencyKey, "idempotencyKey");
  assertBounded(args.payload, "payload", 64 * 1024);
  if (args.customerId) await assertCustomer(ctx, args.organizationId, args.customerId);
  const existing = await findExisting(ctx, args.organizationId, args.idempotencyKey);
  if (existing) return existing._id;
  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error("maxAttempts is invalid");
  const now = args.now ?? Date.now();
  const id = await ctx.db.insert("deliveries", { organizationId: args.organizationId, idempotencyKey: args.idempotencyKey, status: "pending", target: args.target, payload: args.payload, payloadHash: payloadHash(args.payload), payloadVersion: args.payloadVersion ?? 1, bindingId: args.bindingId, bindingKey: args.bindingKey ?? "twenty-primary", providerRunId: args.providerRunId, customerId: args.customerId, attempts: 0, maxAttempts, createdAt: now, updatedAt: now });
  await appendEvent(ctx, { organizationId: args.organizationId, actor: args.actor, type: "delivery.reserved", targetType: "deliveries", targetId: id, correlationId: args.correlationId, payload: JSON.stringify({ idempotencyKey: args.idempotencyKey, target: args.target }) });
  await ctx.scheduler.runAfter(0, internal.actions.twenty.deliver, { deliveryId: id });
  return id;
}

export const reserve = internalMutation({
  args: { organizationId: v.id("organizations"), idempotencyKey: v.string(), target, payload: v.string(), customerId: v.optional(v.id("customers")), providerRunId: v.optional(v.string()), bindingId: v.optional(v.id("integrationBindings")), bindingKey: v.optional(v.string()), maxAttempts: v.optional(v.number()), payloadVersion: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, args) => reserveDelivery(ctx, args),
});

export const reserveDeliveryIntent = mutation({
  args: { idempotencyKey: v.string(), target, payload: v.string(), customerId: v.optional(v.id("customers")), providerRunId: v.optional(v.string()), bindingId: v.optional(v.id("integrationBindings")), bindingKey: v.optional(v.string()), maxAttempts: v.optional(v.number()), payloadVersion: v.optional(v.number()), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => { const { organizationId, userId } = await requireRole(ctx, "operate"); return reserveDelivery(ctx, { ...args, organizationId, actor: userId }); },
});

export const claim = internalMutation({
  args: { deliveryId: v.id("deliveries"), now: v.optional(v.number()), leaseMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) return null;
    const now = args.now ?? Date.now();
    const leaseMs = args.leaseMs ?? DEFAULT_LEASE_MS;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 15 * 60_000) throw new Error("leaseMs is invalid");
    const recoverable = row.status === "claimed" && (row.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now;
    if (row.status !== "pending" && !recoverable) return null;
    if (row.attempts >= row.maxAttempts) { if (row.status !== "failed") await ctx.db.patch(row._id, { status: "failed", lastError: "maximum attempts reached", updatedAt: now }); return null; }
    const attempts = row.attempts + 1;
    const token = `${String(row._id)}:${now}:${attempts}`;
    await ctx.db.patch(row._id, { status: "claimed", attempts, leaseToken: token, leaseClaimedAt: now, leaseExpiresAt: now + leaseMs, lastError: undefined, nextAttemptAt: undefined, updatedAt: now });
    await appendEvent(ctx, { organizationId: row.organizationId, type: "delivery.claimed", targetType: "deliveries", targetId: row._id, correlationId: token });
    return { organizationId: row.organizationId, target: row.target, payload: row.payload, payloadVersion: row.payloadVersion ?? 1, bindingId: row.bindingId, bindingKey: row.bindingKey, customerId: row.customerId, leaseToken: token };
  },
});

function ambiguousError(error?: string) { return Boolean(error && /(timeout|timed out|aborted|5\d\d|readback|malformed|connection reset)/i.test(error)); }

export const finish = internalMutation({
  args: { deliveryId: v.id("deliveries"), leaseToken: v.string(), ok: v.boolean(), externalIds: v.optional(v.array(v.string())), readbackEvidence: v.optional(v.string()), error: v.optional(v.string()), ambiguous: v.optional(v.boolean()), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) throw new Error("Delivery row missing");
    if (row.status !== "claimed" || row.leaseToken !== args.leaseToken || (row.leaseExpiresAt !== undefined && row.leaseExpiresAt <= args.now)) throw new Error("Delivery lease token does not match or has expired");
    if (args.ok && (!args.externalIds || args.externalIds.length === 0 || !args.readbackEvidence)) throw new Error("Successful delivery requires external IDs and exact read-back evidence");
    if (args.ok) { await ctx.db.patch(row._id, { status: "succeeded", externalIds: args.externalIds, readbackEvidence: args.readbackEvidence, completedAt: args.now, leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: args.now }); await appendEvent(ctx, { organizationId: row.organizationId, type: "delivery.succeeded", targetType: "deliveries", targetId: row._id, correlationId: args.leaseToken, payload: args.readbackEvidence }); return { status: "succeeded" as const }; }
    const isAmbiguous = args.ambiguous || ambiguousError(args.error);
    const nextStatus: DeliveryStatus = isAmbiguous ? "reconciliation_required" : row.attempts >= row.maxAttempts ? "failed" : "failed";
    const nextAttemptAt = !isAmbiguous && row.attempts < row.maxAttempts ? args.now + Math.min(60_000 * 2 ** Math.max(0, row.attempts - 1), 30 * 60_000) : undefined;
    await ctx.db.patch(row._id, { status: nextStatus, lastError: args.error ?? "delivery failed", nextAttemptAt, leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: args.now });
    await appendEvent(ctx, { organizationId: row.organizationId, type: `delivery.${nextStatus}`, targetType: "deliveries", targetId: row._id, correlationId: args.leaseToken, payload: args.error });
    return { status: nextStatus };
  },
});

export async function reconcileDeliveryRecord(ctx: MutationCtx, args: { deliveryId: GenericId<"deliveries">; action: "retry" | "succeeded" | "failed"; externalIds?: string[]; readbackEvidence?: string; now: number; actor?: GenericId<"users">; correlationId?: string }) {
  const row = await ctx.db.get(args.deliveryId);
  if (!row || (row.status !== "ambiguous" && row.status !== "reconciliation_required")) throw new Error("Delivery is not awaiting reconciliation");
  if (args.action === "succeeded") {
    if (!args.externalIds?.length || !args.readbackEvidence) throw new Error("Reconciliation success requires read-back evidence");
    await ctx.db.patch(row._id, { status: "succeeded", externalIds: args.externalIds, readbackEvidence: args.readbackEvidence, completedAt: args.now, reconciliationAt: args.now, updatedAt: args.now });
  } else if (args.action === "retry") {
    if (row.attempts >= row.maxAttempts) throw new Error("Maximum attempts reached");
    await ctx.db.patch(row._id, { status: "pending", reconciliationAt: args.now, nextAttemptAt: args.now, updatedAt: args.now });
    await ctx.scheduler.runAfter(0, internal.actions.twenty.deliver, { deliveryId: row._id });
  } else {
    await ctx.db.patch(row._id, { status: "failed", reconciliationAt: args.now, updatedAt: args.now });
  }
  await appendEvent(ctx, { organizationId: row.organizationId, actor: args.actor, type: `delivery.reconciled.${args.action}`, targetType: "deliveries", targetId: row._id, correlationId: args.correlationId });
  return row._id;
}

export const reconcile = internalMutation({
  args: { deliveryId: v.id("deliveries"), action: v.union(v.literal("retry"), v.literal("succeeded"), v.literal("failed")), externalIds: v.optional(v.array(v.string())), readbackEvidence: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => reconcileDeliveryRecord(ctx, args),
});

export const reconcileDelivery = mutation({
  args: { deliveryId: v.id("deliveries"), action: v.union(v.literal("retry"), v.literal("succeeded"), v.literal("failed")), externalIds: v.optional(v.array(v.string())), readbackEvidence: v.optional(v.string()), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.organizationId !== organizationId) throw new Error("Delivery not found");
    return reconcileDeliveryRecord(ctx, { ...args, now: Date.now(), actor: userId });
  },
});

export const retryDue = internalMutation({
  args: { organizationId: v.id("organizations"), now: v.number(), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 25;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) throw new Error("batchSize is invalid");
    const rows = await ctx.db.query("deliveries").withIndex("by_organization_status_next", (q) => q.eq("organizationId", args.organizationId).eq("status", "failed")).order("asc").take(batchSize);
    const due = rows.filter((row) => row.attempts < row.maxAttempts && (row.nextAttemptAt ?? 0) <= args.now);
    for (const row of due) { await ctx.db.patch(row._id, { status: "pending", updatedAt: args.now }); await ctx.scheduler.runAfter(0, internal.actions.twenty.deliver, { deliveryId: row._id }); }
    return due.length;
  },
});

export const sweepDue = internalMutation({
  args: { now: v.optional(v.number()), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const batchSize = args.batchSize ?? 25;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) throw new Error("batchSize is invalid");
    const organizations = await ctx.db.query("organizations").withIndex("by_created_at").order("asc").take(batchSize);
    let scheduled = 0;
    for (const organization of organizations) {
      const rows = await ctx.db.query("deliveries").withIndex("by_organization_status_next", (q) => q.eq("organizationId", organization._id).eq("status", "failed")).order("asc").take(batchSize - scheduled);
      for (const row of rows) {
        if (scheduled >= batchSize) break;
        if (row.attempts < row.maxAttempts && (row.nextAttemptAt ?? 0) <= now) {
          await ctx.db.patch(row._id, { status: "pending", updatedAt: now });
          await ctx.scheduler.runAfter(0, internal.actions.twenty.deliver, { deliveryId: row._id });
          scheduled += 1;
        }
      }
      const staleClaims = await ctx.db.query("deliveries").withIndex("by_organization_status_next", (q) => q.eq("organizationId", organization._id).eq("status", "claimed")).order("asc").take(Math.max(1, batchSize - scheduled));
      for (const row of staleClaims) {
        if (scheduled >= batchSize) break;
        if ((row.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now) {
          if (row.attempts >= row.maxAttempts) await ctx.db.patch(row._id, { status: "failed", lastError: "maximum attempts reached", leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now });
          else { await ctx.db.patch(row._id, { status: "pending", leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: now }); await ctx.scheduler.runAfter(0, internal.actions.twenty.deliver, { deliveryId: row._id }); scheduled += 1; }
        }
      }
      if (scheduled >= batchSize) break;
    }
    return scheduled;
  },
});