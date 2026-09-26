import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail, normalizePhone } from "./identity";

export { normalizeEmail, normalizePhone };

export type IdentityKind = "phone" | "email" | "external";

export function normalizedIdentity(kind: IdentityKind, raw?: string): string | undefined {
  if (kind === "phone") return normalizePhone(raw);
  if (kind === "email") return normalizeEmail(raw);
  return raw?.trim() || undefined;
}

export async function findIdentity(
  ctx: QueryCtx | MutationCtx,
  organizationId: GenericId<"organizations">,
  kind: IdentityKind,
  normalizedValue: string,
) {
  const rows = await ctx.db
    .query("customerIdentities")
    .withIndex("by_organization_identity", (q) =>
      q.eq("organizationId", organizationId).eq("kind", kind).eq("normalizedValue", normalizedValue),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error(`Integrity error: duplicate ${kind} identity ${normalizedValue}`);
  }
  return rows[0] ?? null;
}

export async function identityCandidates(
  ctx: QueryCtx | MutationCtx,
  organizationId: GenericId<"organizations">,
  phone?: string,
  email?: string,
) {
  const phoneIdentity = phone ? await findIdentity(ctx, organizationId, "phone", phone) : null;
  const emailIdentity = email ? await findIdentity(ctx, organizationId, "email", email) : null;
  return { phoneIdentity, emailIdentity };
}

export function conflictingCustomers(
  phoneCustomerId: GenericId<"customers"> | undefined,
  emailCustomerId: GenericId<"customers"> | undefined,
): boolean {
  return phoneCustomerId !== undefined && emailCustomerId !== undefined && phoneCustomerId !== emailCustomerId;
}
