import { type GenericId, v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { requireMember, requireRole } from "./lib/auth";

export const MAX_LABEL_LENGTH = 128;
export const MAX_PAYLOAD_LENGTH = 256;
export const MAX_PROBES_PER_ORGANIZATION = 100;
export const MAX_SCHEDULED_ECHOES_PER_ORGANIZATION = 100;
export const MAX_TERMINAL_SCHEDULED_ECHOES_PER_ORGANIZATION = 100;
export const TERMINAL_SCHEDULED_ECHO_CLEANUP_BATCH_SIZE = 25;
export const MAX_ORGANIZATIONS_PER_SCHEDULED_ECHO_SWEEP = 50;
const TERMINAL_SCHEDULED_ECHO_QUERY_SIZE =
  MAX_TERMINAL_SCHEDULED_ECHOES_PER_ORGANIZATION + TERMINAL_SCHEDULED_ECHO_CLEANUP_BATCH_SIZE + 1;
const SCHEDULED_ECHO_SWEEP_CURSOR_KEY = "toolchain-scheduled-echo-sweep";

function assertLength(value: string, field: string, max: number) {
  if (value.length > max) {
    throw new Error(`${field} exceeds ${max} characters`);
  }
}

async function countProbes(
  ctx: QueryCtx | MutationCtx,
  organizationId: GenericId<"organizations">,
) {
  return (
    await ctx.db
      .query("toolchainProbes")
      .withIndex("by_organization_created_at", (q) => q.eq("organizationId", organizationId))
      .order("desc")
      .take(MAX_PROBES_PER_ORGANIZATION)
  ).length;
}

async function countPendingEchoes(
  ctx: QueryCtx | MutationCtx,
  organizationId: GenericId<"organizations">,
) {
  return (
    await ctx.db
      .query("scheduledEchoes")
      .withIndex("by_organization_status", (q) =>
        q.eq("organizationId", organizationId).eq("status", "pending"),
      )
      .take(MAX_SCHEDULED_ECHOES_PER_ORGANIZATION)
  ).length;
}

export const probeCount = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMember(ctx);
    return countProbes(ctx, organizationId);
  },
});

export const recordProbe = mutation({
  args: { label: v.string() },
  handler: async (ctx, args) => {
    const { organizationId } = await requireRole(ctx, "operate");
    assertLength(args.label, "label", MAX_LABEL_LENGTH);
    if ((await countProbes(ctx, organizationId)) >= MAX_PROBES_PER_ORGANIZATION) {
      throw new Error(`Probe quota of ${MAX_PROBES_PER_ORGANIZATION} per organization exceeded`);
    }
    return ctx.db.insert("toolchainProbes", {
      organizationId,
      label: args.label,
      createdAt: Date.now(),
    });
  },
});

export const removeProbe = mutation({
  args: { probeId: v.id("toolchainProbes") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireRole(ctx, "operate");
    const probe = await ctx.db.get(args.probeId);
    if (!probe || probe.organizationId !== organizationId) {
      throw new Error("Forbidden: probe does not belong to this organization");
    }
    await ctx.db.delete(args.probeId);
  },
});

async function cleanupTerminalEchoes(ctx: MutationCtx, organizationId: GenericId<"organizations">) {
  // One tenant-first finishedAt index gives completed and failed rows one retention order.
  // The status filter keeps legacy rows (which may not have any future terminal marker) eligible
  // while ensuring pending rows can never enter the deletion set.
  const terminalRows = await ctx.db
    .query("scheduledEchoes")
    .withIndex("by_organization_finished_at", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .filter((q) => q.or(q.eq(q.field("status"), "completed"), q.eq(q.field("status"), "failed")))
    .take(TERMINAL_SCHEDULED_ECHO_QUERY_SIZE);

  for (const schedule of terminalRows.slice(
    MAX_TERMINAL_SCHEDULED_ECHOES_PER_ORGANIZATION,
    MAX_TERMINAL_SCHEDULED_ECHOES_PER_ORGANIZATION + TERMINAL_SCHEDULED_ECHO_CLEANUP_BATCH_SIZE,
  )) {
    await ctx.db.delete(schedule._id);
  }

  if (
    terminalRows.length >
    MAX_TERMINAL_SCHEDULED_ECHOES_PER_ORGANIZATION + TERMINAL_SCHEDULED_ECHO_CLEANUP_BATCH_SIZE
  ) {
    await ctx.scheduler.runAfter(0, internal.toolchain.continueCleanup, { organizationId });
  }
}

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db
      .query("maintenanceState")
      .withIndex("by_key", (q) => q.eq("key", SCHEDULED_ECHO_SWEEP_CURSOR_KEY))
      .unique();
    const page = await ctx.db
      .query("organizations")
      .withIndex("by_created_at")
      .order("asc")
      .paginate({
        numItems: MAX_ORGANIZATIONS_PER_SCHEDULED_ECHO_SWEEP,
        cursor: state?.cursor ?? null,
      });
    for (const organization of page.page) {
      await ctx.scheduler.runAfter(0, internal.toolchain.continueCleanup, {
        organizationId: organization._id,
      });
    }
    const nextCursor = page.isDone ? null : page.continueCursor;
    if (state) {
      await ctx.db.patch(state._id, { cursor: nextCursor });
    } else {
      await ctx.db.insert("maintenanceState", {
        key: SCHEDULED_ECHO_SWEEP_CURSOR_KEY,
        cursor: nextCursor,
      });
    }
    return { organizationsScanned: page.page.length };
  },
});

export const continueCleanup = internalMutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await cleanupTerminalEchoes(ctx, args.organizationId);
  },
});

export const recordEcho = internalMutation({
  args: { organizationId: v.id("organizations"), payload: v.string() },
  handler: async (ctx, args) => {
    assertLength(args.payload, "payload", MAX_PAYLOAD_LENGTH);
    assertLength(`echo:${args.payload}`, "label", MAX_LABEL_LENGTH);
    if ((await countProbes(ctx, args.organizationId)) >= MAX_PROBES_PER_ORGANIZATION) {
      throw new Error(`Probe quota of ${MAX_PROBES_PER_ORGANIZATION} per organization exceeded`);
    }
    return ctx.db.insert("toolchainProbes", {
      organizationId: args.organizationId,
      label: `echo:${args.payload}`,
      createdAt: Date.now(),
    });
  },
});

export const scheduleEcho = mutation({
  args: { payload: v.string() },
  handler: async (ctx, args) => {
    const { organizationId } = await requireRole(ctx, "operate");
    assertLength(args.payload, "payload", MAX_PAYLOAD_LENGTH);
    assertLength(`echo:${args.payload}`, "label", MAX_LABEL_LENGTH);
    if ((await countPendingEchoes(ctx, organizationId)) >= MAX_SCHEDULED_ECHOES_PER_ORGANIZATION) {
      throw new Error(
        `Scheduled echo quota of ${MAX_SCHEDULED_ECHOES_PER_ORGANIZATION} per organization exceeded`,
      );
    }
    const scheduleId = await ctx.db.insert("scheduledEchoes", {
      organizationId,
      payload: args.payload,
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.toolchain.echoAction, {
      organizationId,
      payload: args.payload,
      scheduleId,
    });
    return scheduleId;
  },
});

export const finalizeSchedule = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    scheduleId: v.id("scheduledEchoes"),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule || schedule.organizationId !== args.organizationId) {
      throw new Error("Scheduled echo reservation does not belong to this organization");
    }
    if (schedule.status === "pending") {
      await ctx.db.patch(args.scheduleId, { status: args.status, finishedAt: Date.now() });
    }
    await cleanupTerminalEchoes(ctx, args.organizationId);
  },
});

export const echoAction = internalAction({
  args: {
    organizationId: v.id("organizations"),
    payload: v.string(),
    scheduleId: v.id("scheduledEchoes"),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.toolchain.recordEcho, {
        organizationId: args.organizationId,
        payload: args.payload,
      });
    } catch (error) {
      await ctx.runMutation(internal.toolchain.finalizeSchedule, {
        organizationId: args.organizationId,
        scheduleId: args.scheduleId,
        status: "failed",
      });
      throw error;
    }
    await ctx.runMutation(internal.toolchain.finalizeSchedule, {
      organizationId: args.organizationId,
      scheduleId: args.scheduleId,
      status: "completed",
    });
  },
});
