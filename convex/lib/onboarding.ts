import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireMember, requireRole, type Role } from "./auth";

export async function addOrganizationMember(ctx: MutationCtx, args: { clerkId: string; role: Role }) {
  const { organizationId } = await requireRole(ctx, "manage_members");
  const users = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
    .take(2);
  if (users.length > 1) throw new Error(`Integrity error: duplicate user ${args.clerkId}`);
  const target = users[0];
  if (!target) throw new Error("Unknown Clerk user: wait for the Clerk user lifecycle webhook");
  if (target.active === false || target.deletedAt !== undefined) throw new Error("Target Clerk user is inactive");
  const userId = target._id;
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_organization_user", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .take(2);
  if (memberships.length > 1) throw new Error(`Integrity error: duplicate membership ${organizationId}/${userId}`);
  const existing = memberships[0];
  if (existing) {
    await ctx.db.patch(existing._id, {
      role: args.role,
      active: true,
      deletedAt: undefined,
      updatedAt: Date.now(),
    });
    return existing._id;
  }
  return ctx.db.insert("memberships", {
    userId,
    organizationId,
    role: args.role,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function getCurrentOrganization(ctx: MutationCtx | QueryCtx) {
  const { organizationId, role, organization } = await requireMember(ctx);
  return { organizationId, name: organization.name, role };
}

export const memberArgs = {
  clerkId: v.string(),
  role: v.union(v.literal("owner"), v.literal("operator"), v.literal("staff")),
};
