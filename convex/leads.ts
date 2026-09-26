import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { requireMembership } from "./lib/auth";
import { twentyClient } from "./lib/integrations";
import { normalizePhone } from "./lib/phone";
import { leadSource, leadStatus } from "./schema";

const MAX_IMPORT_ROWS = 500;
// ponytail: counts scan the status index; move to a counter table past ~10k leads per workspace.
const COUNT_CAP = 10_000;

const leadInput = v.object({
  name: v.string(),
  phone: v.string(),
  email: v.optional(v.string()),
  notes: v.optional(v.string()),
  twentyPersonId: v.optional(v.string()),
});

function clean(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function validEmail(value: string | undefined): string | undefined {
  const email = clean(value, 254);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : undefined;
}

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMembership(ctx);
    const counts: Record<Doc<"leads">["status"], number> = { new: 0, queued: 0, called: 0, failed: 0 };
    for (const status of Object.keys(counts) as Doc<"leads">["status"][]) {
      const rows = await ctx.db
        .query("leads")
        .withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", status))
        .take(COUNT_CAP);
      counts[status] = rows.length;
    }
    const total = counts.new + counts.queued + counts.called + counts.failed;
    return { total, ...counts, remaining: counts.new + counts.failed };
  },
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator, status: v.optional(leadStatus) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx);
    const status = args.status;
    const base = status
      ? ctx.db.query("leads").withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", status))
      : ctx.db.query("leads").withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId));
    return base.order("desc").paginate(args.paginationOpts);
  },
});

export const importRows = mutation({
  args: { source: leadSource, rows: v.array(leadInput) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx, "operator");
    if (args.rows.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows per request`);
    const now = Date.now();
    const result = { created: 0, updated: 0, invalid: [] as { row: number; reason: string }[] };
    const seen = new Set<string>();
    for (const [index, row] of args.rows.entries()) {
      const phone = normalizePhone(row.phone);
      if (!phone) {
        result.invalid.push({ row: index + 1, reason: `Invalid phone "${row.phone.slice(0, 32)}"` });
        continue;
      }
      if (seen.has(phone)) {
        result.invalid.push({ row: index + 1, reason: `Duplicate phone ${phone} in this file` });
        continue;
      }
      seen.add(phone);
      const name = clean(row.name, 120) ?? "Unknown";
      const email = validEmail(row.email);
      const notes = clean(row.notes, 2000);
      const twentyPersonId = clean(row.twentyPersonId, 64);
      const existing = await ctx.db
        .query("leads")
        .withIndex("by_organization_phone", (q) => q.eq("organizationId", organizationId).eq("phone", phone))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          name: existing.name === "Unknown" ? name : existing.name,
          email: existing.email ?? email,
          notes: existing.notes ?? notes,
          twentyPersonId: existing.twentyPersonId ?? twentyPersonId,
          updatedAt: now,
        });
        result.updated += 1;
        continue;
      }
      await ctx.db.insert("leads", {
        organizationId,
        name,
        phone,
        email,
        notes,
        source: args.source,
        twentyPersonId,
        status: "new",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      result.created += 1;
    }
    return result;
  },
});

export const remove = mutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx, "operator");
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.organizationId !== organizationId) throw new Error("Lead not found");
    if (lead.status === "queued") throw new Error("This lead is being called right now; wait for the call to finish");
    await ctx.db.delete(args.leadId);
  },
});

/** Pull people with phone numbers from Twenty CRM into the lead list. */
export const importFromTwenty = action({
  args: {},
  handler: async (ctx): Promise<{ created: number; updated: number; skippedWithoutPhone: number; invalid: number }> => {
    const workspace = await ctx.runQuery(api.workspace.current, {});
    if (!workspace) throw new Error("Sign in first");
    const client = twentyClient();
    if (!client) throw new Error("Twenty CRM is not connected: set TWENTY_API_KEY in the Convex environment");
    const totals = { created: 0, updated: 0, skippedWithoutPhone: 0, invalid: 0 };
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const { people, nextCursor } = await client.listPeople(cursor, 60);
      const rows = people
        .filter((person) => {
          if (!person.phone) totals.skippedWithoutPhone += 1;
          return Boolean(person.phone);
        })
        .map((person) => ({ name: person.name, phone: person.phone as string, email: person.email, twentyPersonId: person.id }));
      if (rows.length > 0) {
        const result = await ctx.runMutation(api.leads.importRows, { source: "twenty", rows });
        totals.created += result.created;
        totals.updated += result.updated;
        totals.invalid += result.invalid.length;
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return totals;
  },
});
