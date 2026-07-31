import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";

export type AuditStatus = "started" | "completed" | "failed";

export const auditRecords = pgTable(
  "audit_records",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").$type<AuditStatus>().notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_records_org_idempotency_idx").on(table.organizationId, table.idempotencyKey),
    index("audit_records_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);
