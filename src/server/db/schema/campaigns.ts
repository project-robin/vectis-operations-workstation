import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { importBatches } from "./imports.js";
import { organizations } from "./organizations.js";

export type CampaignStatus =
  | "draft"
  | "approved"
  | "starting"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "completed"
  | "failed";

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    importBatchId: uuid("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    workflowId: integer("workflow_id").notNull(),
    status: text("status").$type<CampaignStatus>().notNull(),
    providerCampaignId: integer("provider_campaign_id"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
  },
  (table) => [
    index("campaigns_org_created_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("campaigns_provider_id_idx").on(table.providerCampaignId),
  ],
);
