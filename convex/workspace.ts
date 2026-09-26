import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { personalWorkspaceKey, requireIdentity, requireMembership } from "./lib/auth";
import { ensureDefaultOrganizationSettings } from "./organizationSettings";

type Ctx = QueryCtx | MutationCtx;

export async function findWorkspaceConfig(ctx: Ctx, organizationId: GenericId<"organizations">) {
  return ctx.db
    .query("workspaceConfig")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .unique();
}

/**
 * Provision the signed-in user's personal workspace on first use. Idempotent:
 * repeated calls (every page load) only refresh the mirrored profile.
 */
export const ensureWorkspace = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    const profile = {
      name: identity.name ?? undefined,
      email: identity.email ?? undefined,
      imageUrl: identity.pictureUrl ?? undefined,
    };

    let user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) {
      const id = await ctx.db.insert("users", { clerkId: identity.subject, ...profile, active: true, createdAt: now, updatedAt: now });
      user = await ctx.db.get(id);
    } else if (user.active === false || user.deletedAt !== undefined) {
      throw new Error("This account has been deactivated");
    }
    if (!user) throw new Error("User provisioning failed");

    const key = personalWorkspaceKey(identity.subject);
    let organization = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", key))
      .unique();
    if (!organization) {
      const displayName = profile.name ? `${profile.name}'s business` : "My business";
      const id = await ctx.db.insert("organizations", { clerkOrgId: key, name: displayName, active: true, createdAt: now, updatedAt: now });
      organization = await ctx.db.get(id);
    }
    if (!organization) throw new Error("Workspace provisioning failed");
    const organizationId = organization._id;
    const userId = user._id;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_organization_user", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .unique();
    if (!membership) {
      await ctx.db.insert("memberships", { userId, organizationId, role: "owner", active: true, createdAt: now, updatedAt: now });
    }

    await ensureDefaultOrganizationSettings(ctx, organizationId, userId);
    if (!(await findWorkspaceConfig(ctx, organizationId))) {
      await ctx.db.insert("workspaceConfig", {
        organizationId,
        businessName: organization.name,
        crmSyncEnabled: true,
        onboardingStartedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { organizationId };
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    try {
      const { organization, role, user } = await requireMembership(ctx);
      const config = await findWorkspaceConfig(ctx, organization._id);
      return {
        organizationId: organization._id,
        role,
        userName: user.name ?? user.email ?? "You",
        businessName: config?.businessName ?? organization.name,
        onboardingBusinessNamed: Boolean(config?.onboardingBusinessNamedAt || (config && config.businessName !== organization.name)),
        onboardingStartedAt: config?.onboardingStartedAt ?? null,
        onboardingDismissedAt: config?.onboardingDismissedAt ?? null,
        leadAgentWorkflowId: config?.leadAgentWorkflowId ?? null,
        crmSyncEnabled: config?.crmSyncEnabled ?? true,
      };
    } catch {
      // Not provisioned yet: the client calls ensureWorkspace and this query re-runs.
      return null;
    }
  },
});

export const updateSettings = mutation({
  args: {
    businessName: v.optional(v.string()),
    leadAgentWorkflowId: v.optional(v.union(v.number(), v.null())),
    crmSyncEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx, "owner");
    const config = await findWorkspaceConfig(ctx, organizationId);
    if (!config) throw new Error("Workspace is not provisioned");
    const businessName = args.businessName?.trim();
    if (businessName !== undefined && (businessName.length < 1 || businessName.length > 120)) {
      throw new Error("Business name must be 1-120 characters");
    }
    if (args.leadAgentWorkflowId !== undefined && args.leadAgentWorkflowId !== null && (!Number.isSafeInteger(args.leadAgentWorkflowId) || args.leadAgentWorkflowId <= 0)) {
      throw new Error("Invalid agent");
    }
    await ctx.db.patch(config._id, {
      ...(businessName !== undefined ? { businessName, onboardingBusinessNamedAt: Date.now() } : {}),
      ...(args.leadAgentWorkflowId !== undefined ? { leadAgentWorkflowId: args.leadAgentWorkflowId ?? undefined } : {}),
      ...(args.crmSyncEnabled !== undefined ? { crmSyncEnabled: args.crmSyncEnabled } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Lets an owner leave first-run guidance without losing their workspace progress. */
export const dismissOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMembership(ctx, "owner");
    const config = await findWorkspaceConfig(ctx, organizationId);
    if (!config) throw new Error("Workspace is not provisioned");
    await ctx.db.patch(config._id, {
      onboardingDismissedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
