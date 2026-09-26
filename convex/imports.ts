import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { conflictingCustomers, findIdentity, identityCandidates, normalizeEmail, normalizePhone } from "./lib/customerResolver";

export const MAX_ROWS = 500;
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
export const MAX_FILENAME_LENGTH = 255;
const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const consent = v.union(v.literal("consented"), v.literal("unconsented"), v.literal("unknown"));
const rowValidator = v.object({
  name: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  consent,
  consentSource: v.optional(v.string()),
  evidenceAt: v.optional(v.number()),
});
const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });

type StagedRow = {
  name?: string;
  phone?: string;
  email?: string;
  consent: "consented" | "unconsented" | "unknown";
  consentSource?: string;
  evidenceAt?: number;
};

function assertBoundedPagination(opts: { numItems: number }) {
  if (!Number.isSafeInteger(opts.numItems) || opts.numItems < 1 || opts.numItems > MAX_ROWS) {
    throw new Error(`Pagination must request between 1 and ${MAX_ROWS} items`);
  }
}

function sanitizeFilename(input: string): string {
  const leaf = input.replaceAll("\\", "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  const safe = leaf.replace(/[^A-Za-z0-9._ -]/g, "_");
  if (!safe || safe.length > MAX_FILENAME_LENGTH) throw new Error("Invalid artifact filename");
  return safe;
}

function assertArtifactFields(filename: string, mimeType: string, byteSize: number, sha256: string) {
  sanitizeFilename(filename);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("Unsupported artifact MIME type");
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_ARTIFACT_BYTES) throw new Error("Artifact size is outside bounds");
  if (!SHA256.test(sha256)) throw new Error("Checksum must be a lowercase SHA-256 hex digest");
}

function storageDigestAsHex(value: string): string {
  if (SHA256.test(value)) return value;
  try {
    return Array.from(atob(value), (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  } catch {
    return value;
  }
}

async function oneArtifact(ctx: QueryCtx | MutationCtx, artifactId: GenericId<"sourceArtifacts">) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact) throw new Error("Artifact not found");
  return artifact;
}

export const generateArtifactUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "operate");
    return ctx.storage.generateUploadUrl();
  },
});

export const finalizeArtifact = mutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded artifact not found");
    if (storageDigestAsHex(metadata.sha256) !== args.sha256) throw new Error("Checksum does not match storage metadata");
    const byteSize = metadata.size;
    const actualMimeType = metadata.contentType || args.mimeType;
    if (actualMimeType !== args.mimeType) throw new Error("Artifact MIME type does not match storage metadata");
    assertArtifactFields(args.filename, actualMimeType, byteSize, args.sha256);

    const owned = await ctx.db.query("sourceArtifacts").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).take(2);
    if (owned.length > 1) throw new Error("Integrity error: duplicate artifact storage reservation");
    if (owned[0] && owned[0].organizationId !== organizationId) throw new Error("Artifact belongs to another organization");
    const matches = await ctx.db.query("sourceArtifacts").withIndex("by_organization_sha256", (q) => q.eq("organizationId", organizationId).eq("sha256", args.sha256)).take(2);
    if (matches.length > 1) throw new Error("Integrity error: duplicate artifact checksum");
    if (matches[0]) return { artifactId: matches[0]._id, status: matches[0].status, byteSize: matches[0].byteSize, originalFilename: matches[0].originalFilename, deduplicated: true };

    const artifactId = await ctx.db.insert("sourceArtifacts", {
      organizationId, storageId: args.storageId, originalFilename: sanitizeFilename(args.filename), mimeType: actualMimeType,
      byteSize, sha256: args.sha256, uploadedBy: userId, createdAt: Date.now(), status: "ready",
    });
    await appendEvent(ctx, { organizationId, actor: userId, type: "sourceArtifact.finalized", targetType: "sourceArtifact", targetId: artifactId });
    return { artifactId, status: "ready" as const, byteSize, originalFilename: sanitizeFilename(args.filename), deduplicated: false };
  },
});

export const getArtifact = query({
  args: { artifactId: v.id("sourceArtifacts") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const artifact = await oneArtifact(ctx, args.artifactId);
    if (artifact.organizationId !== organizationId) throw new Error("Artifact not found");
    return artifact;
  },
});

export const getArtifactUrl = query({
  args: { artifactId: v.id("sourceArtifacts") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const artifact = await oneArtifact(ctx, args.artifactId);
    if (artifact.organizationId !== organizationId || artifact.status !== "ready") throw new Error("Artifact not found");
    return ctx.storage.getUrl(artifact.storageId);
  },
});

export const stageImport = mutation({
  args: { name: v.string(), rows: v.array(rowValidator), artifactId: v.optional(v.id("sourceArtifacts")), mappingVersion: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.rows.length > MAX_ROWS) throw new Error(`Import exceeds ${MAX_ROWS} rows`);
    const { userId, organizationId } = await requireRole(ctx, "operate");
    if (args.artifactId) {
      const artifact = await oneArtifact(ctx, args.artifactId);
      if (artifact.organizationId !== organizationId || artifact.status !== "ready") throw new Error("Artifact not found");
    }
    const now = Date.now();
    const mappingVersion = args.mappingVersion ?? "legacy-v1";
    if (!mappingVersion || mappingVersion.length > 100) throw new Error("Invalid mapping version");
    const batchId = await ctx.db.insert("importBatches", { organizationId, name: args.name, artifactId: args.artifactId, mappingVersion, status: "staged", createdBy: userId, createdAt: now });
    for (let i = 0; i < args.rows.length; i++) {
      const row = args.rows[i] as StagedRow;
      const normalizedPhone = normalizePhone(row.phone);
      const normalizedEmail = normalizeEmail(row.email);
      const invalidPhone = row.phone !== undefined && normalizedPhone === undefined;
      const invalidEmail = row.email !== undefined && normalizedEmail === undefined;
      const validationStatus = invalidPhone || invalidEmail ? "invalid" : "valid";
      const exclusionReason = invalidPhone ? "invalid_phone" : invalidEmail ? "invalid_email" : row.consent === "consented" ? undefined : "consent_not_granted";
      const importRowId = await ctx.db.insert("importRows", {
        organizationId, batchId, rowIndex: i, rawName: row.name, rawPhone: row.phone, rawEmail: row.email,
        normalizedPhone, normalizedEmail, mappingVersion, consent: row.consent, consentSource: row.consentSource,
        consentEvidenceAt: row.evidenceAt, validationStatus, exclusionReason, eligible: false, createdAt: now,
      });
      // Compatibility mirror for the pre-Task-5 campaign draft. It is never the source of truth.
      await ctx.db.insert("sourceRows", { organizationId, batchId, rowIndex: i, rawName: row.name, rawPhone: row.phone, rawEmail: row.email, phone: normalizedPhone, email: normalizedEmail, consent: row.consent, createdAt: now });
      void importRowId;
    }
    return batchId;
  },
});

async function ensureCustomer(ctx: MutationCtx, organizationId: GenericId<"organizations">, row: { rawName?: string; normalizedPhone?: string; normalizedEmail?: string; rowIndex: number }) {
  const customerId = await ctx.db.insert("customers", { organizationId, displayName: row.rawName ?? row.normalizedPhone ?? row.normalizedEmail ?? `row ${row.rowIndex}`, phone: row.normalizedPhone, email: row.normalizedEmail, createdAt: Date.now() });
  return customerId;
}

async function ensureIdentity(ctx: MutationCtx, organizationId: GenericId<"organizations">, kind: "phone" | "email", value: string, customerId: GenericId<"customers">, sourceRowId: GenericId<"importRows">) {
  const existing = await findIdentity(ctx, organizationId, kind, value);
  if (existing && existing.customerId !== customerId) throw new Error(`Identity conflict for ${kind}`);
  if (!existing) await ctx.db.insert("customerIdentities", { organizationId, kind, normalizedValue: value, customerId, sourceRowId, createdAt: Date.now() });
}

export const commitBatch = mutation({
  args: { batchId: v.id("importBatches") },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.organizationId !== organizationId) throw new Error("Import batch not found");
    if (batch.status !== "staged") throw new Error(`Batch is ${batch.status}; only staged batches can be committed`);
    const rows = await ctx.db.query("importRows").withIndex("by_organization_batch", (q) => q.eq("organizationId", organizationId).eq("batchId", args.batchId)).take(MAX_ROWS + 1);
    if (rows.length > MAX_ROWS) throw new Error("Import row bound exceeded");
    let created = 0;
    for (const row of rows) {
      const { phoneIdentity, emailIdentity } = await identityCandidates(ctx, organizationId, row.normalizedPhone, row.normalizedEmail);
      const phoneCustomerId = phoneIdentity?.customerId;
      const emailCustomerId = emailIdentity?.customerId;
      if (conflictingCustomers(phoneCustomerId, emailCustomerId)) {
        const reviews = await ctx.db.query("identityReviewItems").withIndex("by_organization_row", (q) => q.eq("organizationId", organizationId).eq("importRowId", row._id)).take(2);
        if (reviews.length > 1) throw new Error("Integrity error: duplicate identity review");
        if (!reviews[0]) await ctx.db.insert("identityReviewItems", { organizationId, importRowId: row._id, candidateCustomerIds: [phoneCustomerId!, emailCustomerId!], reason: "phone_and_email_resolve_to_different_customers", status: "open", createdBy: userId, createdAt: Date.now() });
        await ctx.db.patch(row._id, { resolutionExclusionReason: "identity_conflict", eligible: false, committedAt: Date.now() });
        continue;
      }
      let customerId = phoneCustomerId ?? emailCustomerId;
      if (!customerId) { customerId = await ensureCustomer(ctx, organizationId, row); created += 1; }
      const resolvedCustomerId = customerId;
      if (!resolvedCustomerId) throw new Error("Integrity error: customer resolution failed");
      if (row.normalizedPhone) await ensureIdentity(ctx, organizationId, "phone", row.normalizedPhone, resolvedCustomerId, row._id);
      if (row.normalizedEmail) await ensureIdentity(ctx, organizationId, "email", row.normalizedEmail, resolvedCustomerId, row._id);
      const eligible = row.validationStatus === "valid" && row.consent === "consented";
      await ctx.db.patch(row._id, { customerId: resolvedCustomerId, eligible, resolutionExclusionReason: eligible ? undefined : row.exclusionReason, committedAt: Date.now() });
      const mirrors = await ctx.db.query("sourceRows").withIndex("by_organization_batch", (q) => q.eq("organizationId", organizationId).eq("batchId", args.batchId)).filter((q) => q.eq(q.field("rowIndex"), row.rowIndex)).take(2);
      if (mirrors.length > 1) throw new Error("Integrity error: duplicate compatibility source rows");
      if (mirrors[0]) await ctx.db.patch(mirrors[0]._id, { customerId: resolvedCustomerId });
    }
    await ctx.db.patch(batch._id, { status: "committed" });
    return { batchId: batch._id, rows: rows.length, customersCreated: created };
  },
});

export const approveBatch = mutation({
  args: { batchId: v.id("importBatches") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx, "owner");
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.organizationId !== organizationId) throw new Error("Import batch not found");
    if (batch.status !== "committed") throw new Error(`Batch is ${batch.status}; only committed batches can be approved`);
    await ctx.db.patch(batch._id, { status: "approved" });
    return batch._id;
  },
});

export const listImportBatches = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMember(ctx);
    return ctx.db.query("importBatches").withIndex("by_organization_created_at", (q) => q.eq("organizationId", organizationId)).order("desc").take(50);
  },
});

export const listEligibleRows = query({
  args: { batchId: v.id("importBatches"), paginationOpts },
  handler: async (ctx, args) => {
    assertBoundedPagination(args.paginationOpts);
    const { organizationId } = await requireMember(ctx);
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.organizationId !== organizationId) throw new Error("Import batch not found");
    return ctx.db.query("importRows").withIndex("by_organization_batch", (q) => q.eq("organizationId", organizationId).eq("batchId", args.batchId)).filter((q) => q.eq(q.field("eligible"), true)).paginate(args.paginationOpts);
  },
});
