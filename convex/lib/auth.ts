import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Role = "owner" | "operator" | "staff";
export type Permission = "read" | "operate" | "manage_members" | "approve";

const ROLE_RANK: Record<Role, number> = { staff: 1, operator: 2, owner: 3 };
const PERMISSION_MIN_ROLE: Record<Permission, Role> = {
  read: "staff",
  operate: "operator",
  manage_members: "owner",
  approve: "owner",
};

type AuthCtx = QueryCtx | MutationCtx;
type Identity = NonNullable<Awaited<ReturnType<AuthCtx["auth"]["getUserIdentity"]>>>;

type UserRecord = {
  _id: GenericId<"users">;
  clerkId: string;
  name?: string;
  email?: string;
  imageUrl?: string;
  active?: boolean;
  deletedAt?: number;
};

type OrganizationRecord = {
  _id: GenericId<"organizations">;
  clerkOrgId: string;
  name: string;
  active?: boolean;
  deletedAt?: number;
};

type MembershipRecord = {
  _id: GenericId<"memberships">;
  userId: GenericId<"users">;
  organizationId: GenericId<"organizations">;
  role: Role;
  active?: boolean;
  deletedAt?: number;
};

function duplicateError(kind: string, value: string): Error {
  return new Error(`Integrity error: more than one ${kind} exists for ${value}`);
}

async function oneByClerkId(ctx: AuthCtx, clerkId: string): Promise<UserRecord | null> {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .take(2);
  if (rows.length > 1) throw duplicateError("user", clerkId);
  return rows[0] ?? null;
}

async function oneByClerkOrgId(ctx: AuthCtx, clerkOrgId: string): Promise<OrganizationRecord | null> {
  const rows = await ctx.db
    .query("organizations")
    .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", clerkOrgId))
    .take(2);
  if (rows.length > 1) throw duplicateError("organization", clerkOrgId);
  return rows[0] ?? null;
}

function isActive(record: { active?: boolean; deletedAt?: number }): boolean {
  return record.active !== false && record.deletedAt === undefined;
}

export async function requireIdentity(ctx: AuthCtx): Promise<Identity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated: sign in with Clerk");
  return identity;
}

export async function requireUser(ctx: AuthCtx): Promise<{
  userId: GenericId<"users">;
  clerkId: string;
  user: UserRecord;
  identity: Identity;
}> {
  const identity = await requireIdentity(ctx);
  const user = await oneByClerkId(ctx, identity.subject);
  if (!user) throw new Error("Unknown user: wait for the Clerk user lifecycle webhook");
  if (!isActive(user)) throw new Error("Inactive or deleted user");
  return { userId: user._id, clerkId: identity.subject, user, identity };
}

async function oneMembership(
  ctx: AuthCtx,
  organizationId: GenericId<"organizations">,
  userId: GenericId<"users">,
): Promise<MembershipRecord | null> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_organization_user", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .take(2);
  if (rows.length > 1) throw duplicateError("membership", `${organizationId}/${userId}`);
  return rows[0] ?? null;
}

/** Workspace key for a signed-in user without an active Clerk organization. */
export function personalWorkspaceKey(clerkUserId: string): string {
  return `personal:${clerkUserId}`;
}

/**
 * Resolve the active Clerk org claim (or the caller's personal workspace when no
 * Clerk organization is active) against the authoritative Convex org and membership.
 */
export async function requireMembership(ctx: AuthCtx, minRole: Role = "staff") {
  const { userId, identity } = await requireUser(ctx);
  const clerkOrgId =
    typeof identity.org_id === "string" && identity.org_id.length > 0
      ? identity.org_id
      : personalWorkspaceKey(identity.subject);
  const organization = await oneByClerkOrgId(ctx, clerkOrgId);
  if (!organization || !isActive(organization)) throw new Error("Unknown or inactive organization");
  const membership = await oneMembership(ctx, organization._id, userId);
  if (!membership || !isActive(membership)) throw new Error("Not a member of this organization: membership inactive");
  if (!(membership.role in ROLE_RANK) || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new Error(`Forbidden: requires ${minRole}`);
  }
  return {
    userId,
    organizationId: organization._id,
    role: membership.role,
    user: (await ctx.db.get(userId)) as UserRecord,
    organization,
    membership,
    identity,
  };
}

export async function requireRole(ctx: AuthCtx, permission: Permission) {
  const minimumRole = PERMISSION_MIN_ROLE[permission];
  if (typeof minimumRole !== "string") throw new Error(`Unknown permission: ${String(permission)}`);
  return requireMembership(ctx, minimumRole);
}

/** Compatibility name used by existing Task 2/3 domain modules. */
export async function requireMember(ctx: AuthCtx, minRole: Role = "staff") {
  return requireMembership(ctx, minRole);
}

export const roleHierarchy = Object.freeze({ ...ROLE_RANK });
export const permissionMatrix = Object.freeze({ ...PERMISSION_MIN_ROLE });
