import type { MutationCtx } from "../_generated/server";
import type { GenericId } from "convex/values";
import { ensureDefaultOrganizationSettings } from "../organizationSettings";
import {
  MAX_CLERK_EVENT_ID_LENGTH,
  MAX_CLERK_EVENT_TYPE_LENGTH,
  MAX_CLERK_WEBHOOK_PAYLOAD_LENGTH,
} from "./webhookLimits";

type ClerkEvent = { id: string; type: string; data: Record<string, unknown> };

type OrganizationData = { id: string; name?: string; slug?: string };
type UserData = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: Array<{ id?: string; email_address?: string }>;
};
type MembershipData = {
  id?: string;
  organization?: { id?: string };
  organization_id?: string;
  public_user_data?: { user_id?: string };
  user_id?: string;
  role?: string;
};
type LifecycleRecord = {
  lifecycleAt?: number;
  lifecycleVersion?: string;
  updatedAt?: number;
  createdAt?: number;
  deletedAt?: number;
};
type LifecycleOptions = {
  deleted: boolean;
  created: boolean;
  eventTimestamp: number;
  eventVersion: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Clerk event data");
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventFromPayload(eventId: string, eventType: string, payload: string): ClerkEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Invalid Clerk webhook JSON");
  }
  const value = record(parsed);
  const id = stringField(value.id);
  const type = stringField(value.type);
  if ((id && id !== eventId) || !type || type !== eventType) throw new Error("Clerk event envelope mismatch");
  return { id: eventId, type, data: record(value.data) };
}

async function oneUser(ctx: MutationCtx, clerkId: string) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate user ${clerkId}`);
  return rows[0] ?? null;
}

async function oneOrganization(ctx: MutationCtx, clerkOrgId: string) {
  const rows = await ctx.db
    .query("organizations")
    .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", clerkOrgId))
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate organization ${clerkOrgId}`);
  return rows[0] ?? null;
}

function profile(data: UserData) {
  const name = [data.first_name, data.last_name]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ");
  const email = data.email_addresses?.find((address) => address.id === data.primary_email_address_id)?.email_address;
  return { name: name || undefined, email, imageUrl: data.image_url ?? undefined };
}

function lifecycleAt(record: LifecycleRecord): number {
  return record.lifecycleAt ?? record.updatedAt ?? record.createdAt ?? 0;
}

function isNewer(record: LifecycleRecord, eventTimestamp: number, eventVersion: string): boolean {
  if (record.lifecycleVersion !== undefined) return eventVersion > record.lifecycleVersion;
  // Rows written before lifecycleVersion was introduced remain backfill-safe.
  return eventTimestamp >= lifecycleAt(record);
}

function lifecycleVersion(timestamp: number, eventId: string): string {
  return `${String(timestamp).padStart(16, "0")}:${eventId}`;
}

function trustedResourceTimestamp(data: Record<string, unknown>, fallback: number): number {
  for (const field of ["updated_at", "created_at"]) {
    const value = data[field];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  }
  return fallback;
}

function assertBoundedString(value: string, field: string, max: number) {
  if (value.length > max) throw new Error(`${field} exceeds ${max} characters`);
}

function active(record: { active?: boolean; deletedAt?: number }): boolean {
  return record.active !== false && record.deletedAt === undefined;
}

async function syncUser(
  ctx: MutationCtx,
  data: Record<string, unknown>,
  options: LifecycleOptions,
) {
  const userData = data as unknown as UserData;
  const clerkId = stringField(userData.id);
  if (!clerkId) throw new Error("Clerk user event has no user id");
  const existing = await oneUser(ctx, clerkId);
  const now = Date.now();
  if (!existing) {
    if (options.deleted || !options.created) return;
    const fields = profile(userData);
    await ctx.db.insert("users", {
      clerkId,
      ...fields,
      active: true,
      createdAt: now,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    return;
  }
  if (!isNewer(existing, options.eventTimestamp, options.eventVersion)) return;
  if (options.deleted) {
    if (!active(existing)) {
      await ctx.db.patch(existing._id, {
        active: false,
        updatedAt: now,
        lifecycleAt: options.eventTimestamp,
        lifecycleVersion: options.eventVersion,
      });
      return;
    }
    await ctx.db.patch(existing._id, {
      active: false,
      deletedAt: now,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    const memberships = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", existing._id)).collect();
    for (const membership of memberships) {
      if (isNewer(membership, options.eventTimestamp, options.eventVersion)) {
        await ctx.db.patch(membership._id, {
          active: false,
          deletedAt: now,
          updatedAt: now,
          lifecycleAt: options.eventTimestamp,
          lifecycleVersion: options.eventVersion,
        });
      }
    }
    return;
  }
  // A later user.updated event cannot resurrect a deleted Clerk user.
  if (!options.created && !active(existing)) {
    await ctx.db.patch(existing._id, {
      active: false,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    ...profile(userData),
    active: true,
    deletedAt: undefined,
    updatedAt: now,
    lifecycleAt: options.eventTimestamp,
    lifecycleVersion: options.eventVersion,
  });
}

async function syncOrganization(
  ctx: MutationCtx,
  data: Record<string, unknown>,
  options: LifecycleOptions,
) {
  const organizationData = data as unknown as OrganizationData;
  const clerkOrgId = stringField(organizationData.id);
  if (!clerkOrgId) throw new Error("Clerk organization event has no organization id");
  const existing = await oneOrganization(ctx, clerkOrgId);
  const now = Date.now();
  if (!existing) {
    if (options.deleted || !options.created) return;
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrgId,
      name: stringField(organizationData.name) ?? clerkOrgId,
      slug: stringField(organizationData.slug),
      active: true,
      createdAt: now,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    await ensureDefaultOrganizationSettings(ctx, organizationId);
    return;
  }
  if (!isNewer(existing, options.eventTimestamp, options.eventVersion)) return;
  if (options.deleted) {
    if (!active(existing)) {
      await ctx.db.patch(existing._id, {
        active: false,
        updatedAt: now,
        lifecycleAt: options.eventTimestamp,
        lifecycleVersion: options.eventVersion,
      });
      return;
    }
    await ctx.db.patch(existing._id, {
      active: false,
      deletedAt: now,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_organization_user", (q) => q.eq("organizationId", existing._id))
      .collect();
    for (const membership of memberships) {
      if (isNewer(membership, options.eventTimestamp, options.eventVersion)) {
        await ctx.db.patch(membership._id, {
          active: false,
          deletedAt: now,
          updatedAt: now,
          lifecycleAt: options.eventTimestamp,
          lifecycleVersion: options.eventVersion,
        });
      }
    }
    return;
  }
  if (!options.created && !active(existing)) {
    await ctx.db.patch(existing._id, {
      active: false,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    name: stringField(organizationData.name) ?? existing.name,
    slug: stringField(organizationData.slug),
    active: true,
    deletedAt: undefined,
    updatedAt: now,
    lifecycleAt: options.eventTimestamp,
    lifecycleVersion: options.eventVersion,
  });
}

export function applicationRole(role: string | undefined): "owner" | "operator" | "staff" {
  if (role === "org:admin") return "owner";
  if (role === "org:operator") return "operator";
  if (role === "org:staff" || role === "org:member") return "staff";
  throw new Error("Unsupported Clerk organization membership role");
}

async function membershipByClerkId(ctx: MutationCtx, clerkMembershipId: string) {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_clerk_membership_id", (q) => q.eq("clerkMembershipId", clerkMembershipId))
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate membership ${clerkMembershipId}`);
  return rows[0] ?? null;
}

async function membershipByPair(ctx: MutationCtx, organizationId: GenericId<"organizations">, userId: GenericId<"users">) {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_organization_user", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate membership ${organizationId}/${userId}`);
  return rows[0] ?? null;
}

async function syncMembership(
  ctx: MutationCtx,
  data: Record<string, unknown>,
  options: LifecycleOptions,
) {
  const membershipData = data as unknown as MembershipData;
  const clerkMembershipId = stringField(membershipData.id);
  const clerkOrgId = stringField(membershipData.organization?.id) ?? stringField(membershipData.organization_id);
  const clerkUserId = stringField(membershipData.public_user_data?.user_id) ?? stringField(membershipData.user_id);

  // Deletes resolve the durable membership identity first. Parent rows may already be gone.
  if (options.deleted) {
    const byClerkId = clerkMembershipId ? await membershipByClerkId(ctx, clerkMembershipId) : null;
    const user = clerkUserId ? await oneUser(ctx, clerkUserId) : null;
    if (clerkUserId && !user) throw new Error("Membership delete references unknown user");
    const organization = clerkOrgId ? await oneOrganization(ctx, clerkOrgId) : null;
    if (clerkOrgId && !organization) throw new Error("Membership delete references unknown organization");
    let existing = byClerkId;
    if (!existing && user && organization) {
      existing = await membershipByPair(ctx, organization._id, user._id);
    }
    if (!existing) return;
    if (clerkMembershipId && existing.clerkMembershipId && existing.clerkMembershipId !== clerkMembershipId) {
      throw new Error("Membership ID mismatch");
    }
    if (organization && organization._id !== existing.organizationId) throw new Error("Membership organization mismatch");
    if (user && user._id !== existing.userId) throw new Error("Membership user mismatch");
    if (!isNewer(existing, options.eventTimestamp, options.eventVersion)) return;
    const now = Date.now();
    if (!active(existing)) {
      await ctx.db.patch(existing._id, {
        active: false,
        updatedAt: now,
        lifecycleAt: options.eventTimestamp,
        lifecycleVersion: options.eventVersion,
      });
      return;
    }
    await ctx.db.patch(existing._id, {
      active: false,
      deletedAt: now,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    return;
  }

  if (!clerkMembershipId || !clerkOrgId || !clerkUserId) {
    throw new Error("Clerk membership event is missing membership, organization, or user id");
  }
  const user = await oneUser(ctx, clerkUserId);
  const organization = await oneOrganization(ctx, clerkOrgId);
  if (!user || !organization || !active(user) || !active(organization)) {
    throw new Error("Clerk membership references an unknown or inactive user or organization");
  }
  const byClerkId = await membershipByClerkId(ctx, clerkMembershipId);
  const byPair = await membershipByPair(ctx, organization._id, user._id);
  if (byClerkId && (byClerkId.userId !== user._id || byClerkId.organizationId !== organization._id)) {
    throw new Error("Membership ID does not match organization and user");
  }
  if (byPair && byPair.clerkMembershipId && byPair.clerkMembershipId !== clerkMembershipId) {
    throw new Error("Membership ID does not match organization and user");
  }
  const existing = byClerkId ?? byPair;
  const role = applicationRole(membershipData.role);
  if (!existing) {
    if (!options.created) throw new Error("Clerk membership update references an unknown membership");
    await ctx.db.insert("memberships", {
      userId: user._id,
      organizationId: organization._id,
      role,
      active: true,
      clerkMembershipId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    return;
  }
  if (!isNewer(existing, options.eventTimestamp, options.eventVersion)) return;
  const now = Date.now();
  if (!options.created && !active(existing)) {
    await ctx.db.patch(existing._id, {
      active: false,
      updatedAt: now,
      lifecycleAt: options.eventTimestamp,
      lifecycleVersion: options.eventVersion,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    userId: user._id,
    organizationId: organization._id,
    role,
    active: true,
    deletedAt: undefined,
    clerkMembershipId,
    updatedAt: now,
    lifecycleAt: options.eventTimestamp,
    lifecycleVersion: options.eventVersion,
  });
}

export async function applyClerkEvent(ctx: MutationCtx, event: ClerkEvent, eventTimestamp: number) {
  const resourceTimestamp = trustedResourceTimestamp(event.data, eventTimestamp);
  const options = {
    eventTimestamp: resourceTimestamp,
    eventVersion: lifecycleVersion(resourceTimestamp, event.id),
  };
  if (event.type === "user.created") return syncUser(ctx, event.data, { ...options, deleted: false, created: true });
  if (event.type === "user.updated") return syncUser(ctx, event.data, { ...options, deleted: false, created: false });
  if (event.type === "user.deleted") return syncUser(ctx, event.data, { ...options, deleted: true, created: false });
  if (event.type === "organization.created") return syncOrganization(ctx, event.data, { ...options, deleted: false, created: true });
  if (event.type === "organization.updated") return syncOrganization(ctx, event.data, { ...options, deleted: false, created: false });
  if (event.type === "organization.deleted") return syncOrganization(ctx, event.data, { ...options, deleted: true, created: false });
  if (event.type === "organizationMembership.created") return syncMembership(ctx, event.data, { ...options, deleted: false, created: true });
  if (event.type === "organizationMembership.updated") return syncMembership(ctx, event.data, { ...options, deleted: false, created: false });
  if (event.type === "organizationMembership.deleted") return syncMembership(ctx, event.data, { ...options, deleted: true, created: false });
  // Unknown future Clerk events are acknowledged but have no write side effect.
}

async function digestPayload(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function processClerkEvent(
  ctx: MutationCtx,
  args: { eventId: string; eventType: string; payload: string; eventTimestamp: number },
) {
  assertBoundedString(args.eventId, "eventId", MAX_CLERK_EVENT_ID_LENGTH);
  assertBoundedString(args.eventType, "eventType", MAX_CLERK_EVENT_TYPE_LENGTH);
  assertBoundedString(args.payload, "payload", MAX_CLERK_WEBHOOK_PAYLOAD_LENGTH);
  if (new TextEncoder().encode(args.payload).byteLength > MAX_CLERK_WEBHOOK_PAYLOAD_LENGTH) {
    throw new Error(`payload exceeds ${MAX_CLERK_WEBHOOK_PAYLOAD_LENGTH} bytes`);
  }
  const eventTimestamp = args.eventTimestamp;
  if (!Number.isSafeInteger(eventTimestamp) || eventTimestamp <= 0 || eventTimestamp > Date.now() + 5 * 60 * 1000) {
    throw new Error("Invalid Clerk webhook event timestamp");
  }
  const payloadHash = await digestPayload(args.payload);
  const existing = await ctx.db
    .query("webhookEvents")
    .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
    .take(2);
  if (existing.length > 1) throw new Error(`Integrity error: duplicate webhook event ${args.eventId}`);
  if (existing[0]) {
    if (existing[0].eventType !== args.eventType || (existing[0].payloadHash && existing[0].payloadHash !== payloadHash)) {
      throw new Error(`Integrity error: duplicate webhook event ${args.eventId} has a conflicting payload`);
    }
    return { duplicate: true, eventId: args.eventId };
  }
  const event = eventFromPayload(args.eventId, args.eventType, args.payload);
  await applyClerkEvent(ctx, event, eventTimestamp);
  const now = Date.now();
  await ctx.db.insert("webhookEvents", {
    eventId: event.id,
    eventType: event.type,
    payloadHash,
    receivedAt: now,
    processedAt: now,
    eventTimestamp,
  });
  return { duplicate: false, eventId: event.id };
}

export type LifecycleOrganizationId = GenericId<"organizations">;
