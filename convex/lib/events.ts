import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function appendEvent(ctx: MutationCtx, args: {
  organizationId: GenericId<"organizations">;
  actor?: GenericId<"users">;
  type: string;
  targetType: string;
  targetId: string;
  correlationId?: string;
  payload?: string;
}) {
  await ctx.db.insert("operationEvents", {
    organizationId: args.organizationId,
    actor: args.actor,
    type: args.type,
    targetType: args.targetType,
    targetId: args.targetId,
    correlationId: args.correlationId,
    payload: args.payload,
    createdAt: Date.now(),
  });
}

export async function listEvents(
  ctx: QueryCtx,
  organizationId: GenericId<"organizations">,
  limit = 200,
) {
  return ctx.db
    .query("operationEvents")
    .withIndex("by_organization_time", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(limit); // ponytail: fixed page; paginate when the audit UI opens
}