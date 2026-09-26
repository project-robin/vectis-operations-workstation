import { internal } from "./_generated/api";
import { internalQuery, mutation, query } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { assertMetadataSafe, assertSecretReferences } from "./lib/policy";

const provider = v.union(v.literal("dograh"), v.literal("twenty"), v.literal("hermes"));
const status = v.union(v.literal("active"), v.literal("inactive"));
const health = v.object({
  status: v.union(v.literal("healthy"), v.literal("degraded"), v.literal("unhealthy"), v.literal("unknown")),
  lastCheckedAt: v.optional(v.number()),
  nextCheckAt: v.optional(v.number()),
  detail: v.optional(v.string()),
});
const metadata = v.optional(v.array(v.object({ key: v.string(), value: v.string() })));
const twentyObjectMappings = v.optional(v.array(v.object({ workstationType: v.string(), twentyObject: v.string() })));

export const bindingArgs = {
  bindingId: v.optional(v.id("integrationBindings")),
  bindingKey: v.optional(v.string()),
  provider: v.optional(provider),
  status: v.optional(status),
  dograhOrganizationId: v.optional(v.string()),
  dograhWorkflowId: v.optional(v.string()),
  twentyWorkspaceId: v.optional(v.string()),
  twentyObjectMappings,
  metadata,
  health: v.optional(health),
  secretReferenceNames: v.optional(v.array(v.string())),
  correlationId: v.optional(v.string()),
};

type BindingArgs = {
  bindingId?: GenericId<"integrationBindings">;
  bindingKey?: string;
  provider?: "dograh" | "twenty" | "hermes";
  status?: "active" | "inactive";
  dograhOrganizationId?: string;
  dograhWorkflowId?: string;
  twentyWorkspaceId?: string;
  twentyObjectMappings?: Array<{ workstationType: string; twentyObject: string }>;
  metadata?: Array<{ key: string; value: string }>;
  health?: {
    status: "healthy" | "degraded" | "unhealthy" | "unknown";
    lastCheckedAt?: number;
    nextCheckAt?: number;
    detail?: string;
  };
  secretReferenceNames?: string[];
  correlationId?: string;
};

async function findByKey(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, bindingKey: string) {
  const rows = await ctx.db
    .query("integrationBindings")
    .withIndex("by_organization_binding_key", (q) =>
      q.eq("organizationId", organizationId).eq("bindingKey", bindingKey),
    )
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate integration binding ${organizationId}/${bindingKey}`);
  return rows[0] ?? null;
}

async function assertBindingRecord(ctx: QueryCtx | MutationCtx, bindingId: GenericId<"integrationBindings">, organizationId: GenericId<"organizations">) {
  const binding = await ctx.db.get(bindingId);
  if (!binding || binding.organizationId !== organizationId) {
    throw new Error("Forbidden: integration binding does not belong to this organization");
  }
  return binding;
}

function assertProviderShape(args: {
  provider: "dograh" | "twenty" | "hermes";
  dograhOrganizationId?: string;
  dograhWorkflowId?: string;
  twentyWorkspaceId?: string;
  twentyObjectMappings?: Array<{ workstationType: string; twentyObject: string }>;
}) {
  if (args.provider === "dograh" && (!args.dograhOrganizationId || !args.dograhWorkflowId)) {
    throw new Error("Dograh binding requires organization and workflow IDs");
  }
  if (args.provider === "twenty" && !args.twentyWorkspaceId) {
    throw new Error("Twenty binding requires workspace ID");
  }
  for (const value of [args.dograhOrganizationId, args.dograhWorkflowId, args.twentyWorkspaceId]) {
    if (value !== undefined && (value.length === 0 || value.length > 256)) throw new Error("Provider identifier is invalid");
  }
  if (args.twentyObjectMappings) {
    const keys = new Set<string>();
    for (const mapping of args.twentyObjectMappings) {
      if (mapping.workstationType.length === 0 || mapping.twentyObject.length === 0 || keys.has(mapping.workstationType)) {
        throw new Error("Twenty object mappings must be unique and non-empty");
      }
      keys.add(mapping.workstationType);
    }
  }
}

function assertBindingInput(args: {
  bindingKey: string;
  provider: "dograh" | "twenty" | "hermes";
  status: "active" | "inactive";
  dograhOrganizationId?: string;
  dograhWorkflowId?: string;
  twentyWorkspaceId?: string;
  twentyObjectMappings?: Array<{ workstationType: string; twentyObject: string }>;
  metadata?: Array<{ key: string; value: string }>;
  secretReferenceNames?: string[];
}) {
  if (args.bindingKey.length === 0 || args.bindingKey.length > 128) throw new Error("Binding key is invalid");
  assertProviderShape(args);
  assertMetadataSafe(args.metadata);
  assertSecretReferences(args.secretReferenceNames);
}

function assertHealthMetadata(healthValue: BindingArgs["health"]): void {
  if (!healthValue) return;
  for (const timestamp of [healthValue.lastCheckedAt, healthValue.nextCheckAt]) {
    if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp < 0)) {
      throw new Error("Integration health timestamps are invalid");
    }
  }
  if (healthValue.detail !== undefined && healthValue.detail.length > 1000) {
    throw new Error("Integration health detail exceeds 1000 characters");
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMember(ctx);
    return ctx.db
      .query("integrationBindings")
      .withIndex("by_organization_updated_at", (q) => q.eq("organizationId", organizationId))
      .order("desc")
      .take(100);
  },
});

export const get = query({
  args: { bindingId: v.id("integrationBindings") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    return assertBindingRecord(ctx, args.bindingId, organizationId);
  },
});

async function saveBinding(ctx: MutationCtx, args: BindingArgs) {
  const { organizationId, userId } = await requireRole(ctx, "manage_members");
  if (args.bindingId) {
    const existing = await assertBindingRecord(ctx, args.bindingId, organizationId);
    const next = {
      bindingKey: args.bindingKey ?? existing.bindingKey,
      provider: args.provider ?? existing.provider,
      status: args.status ?? existing.status,
      dograhOrganizationId: args.dograhOrganizationId ?? existing.dograhOrganizationId,
      dograhWorkflowId: args.dograhWorkflowId ?? existing.dograhWorkflowId,
      twentyWorkspaceId: args.twentyWorkspaceId ?? existing.twentyWorkspaceId,
      twentyObjectMappings: args.twentyObjectMappings ?? existing.twentyObjectMappings,
      metadata: args.metadata ?? existing.metadata,
      secretReferenceNames: args.secretReferenceNames ?? existing.secretReferenceNames,
    };
    const sameKey = await findByKey(ctx, organizationId, next.bindingKey);
    if (sameKey && sameKey._id !== existing._id) throw new Error(`Integrity error: duplicate integration binding ${next.bindingKey}`);
    assertBindingInput(next);
    assertHealthMetadata(args.health);
    const now = Date.now();
    const nextHealth = args.health ?? existing.health;
    await ctx.db.patch(existing._id, { ...next, health: nextHealth, updatedAt: now, updatedBy: userId });
    await appendEvent(ctx, {
      organizationId,
      actor: userId,
      type: "integrationBinding.updated",
      targetType: "integrationBinding",
      targetId: existing._id,
      correlationId: args.correlationId,
    });
    return { ...(await ctx.db.get(existing._id))!, ...next, health: nextHealth, updatedAt: now, updatedBy: userId };
  }
  if (!args.bindingKey || !args.provider || !args.status) {
    throw new Error("Creating an integration binding requires bindingKey, provider, and status");
  }
  const duplicate = await findByKey(ctx, organizationId, args.bindingKey);
  if (duplicate) throw new Error(`Integrity error: duplicate integration binding ${args.bindingKey}`);
  assertBindingInput({ ...args, bindingKey: args.bindingKey, provider: args.provider, status: args.status });
  assertHealthMetadata(args.health);
  const now = Date.now();
  const id = await ctx.db.insert("integrationBindings", {
    organizationId,
    bindingKey: args.bindingKey,
    provider: args.provider,
    status: args.status,
    dograhOrganizationId: args.dograhOrganizationId,
    dograhWorkflowId: args.dograhWorkflowId,
    twentyWorkspaceId: args.twentyWorkspaceId,
    twentyObjectMappings: args.twentyObjectMappings,
    metadata: args.metadata,
    health: args.health,
    secretReferenceNames: args.secretReferenceNames,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  });
  await appendEvent(ctx, {
    organizationId,
    actor: userId,
    type: "integrationBinding.created",
    targetType: "integrationBinding",
    targetId: id,
    correlationId: args.correlationId,
  });
  return ctx.db.get(id);
}

export const upsert = mutation({ args: bindingArgs, handler: saveBinding });

export const update = mutation({
  args: bindingArgs,
  handler: async (ctx, args) => {
    if (!args.bindingId) throw new Error("Updating an integration binding requires bindingId");
    return saveBinding(ctx, args);
  },
});

export const remove = mutation({
  args: { bindingId: v.id("integrationBindings"), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "manage_members");
    const binding = await assertBindingRecord(ctx, args.bindingId, organizationId);
    await ctx.db.delete(binding._id);
    await appendEvent(ctx, {
      organizationId,
      actor: userId,
      type: "integrationBinding.deleted",
      targetType: "integrationBinding",
      targetId: binding._id,
      correlationId: args.correlationId,
    });
  },
});

/** Internal action seam: explicit tenant is required because scheduled callers have no Clerk identity. */
export const resolve = internalQuery({
  args: { organizationId: v.id("organizations"), bindingKey: v.string() },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.active === false || organization.deletedAt !== undefined) return null;
    const binding = await findByKey(ctx, args.organizationId, args.bindingKey);
    if (!binding || binding.status !== "active") return null;
    return binding;
  },
});

export const resolveByKey = internalQuery({
  args: { organizationId: v.id("organizations"), bindingKey: v.string() },
  handler: async (ctx, args) => ctx.runQuery(internal.integrationBindings.resolve, args),
});
