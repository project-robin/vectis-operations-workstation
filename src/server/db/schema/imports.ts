import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ImportRowClassification } from "../../imports/parse-lead-csv.js";
import { organizations } from "./organizations.js";

export type ImportBatchStatus = "staged" | "committed" | "approved" | "rejected";

export interface ImportSummary {
  total: number;
  valid: number;
  blockedConsent: number;
  invalid: number;
  duplicate: number;
}

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    defaultCallingCode: text("default_calling_code").notNull(),
    status: text("status").$type<ImportBatchStatus>().notNull(),
    summary: jsonb("summary").$type<ImportSummary>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [index("import_batches_org_created_idx").on(table.organizationId, table.createdAt)],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: serial("id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    originalPhone: text("original_phone").notNull(),
    normalizedPhone: text("normalized_phone"),
    consentStatus: text("consent_status"),
    classification: text("classification").$type<ImportRowClassification>().notNull(),
    reason: text("reason"),
  },
  (table) => [
    uniqueIndex("import_rows_batch_row_idx").on(table.batchId, table.rowNumber),
    index("import_rows_org_batch_class_idx").on(
      table.organizationId,
      table.batchId,
      table.classification,
    ),
  ],
);
