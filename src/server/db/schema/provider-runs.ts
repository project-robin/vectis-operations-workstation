import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { importRows } from "./imports.js";
import { organizations } from "./organizations.js";

export const providerRuns = pgTable(
  "provider_runs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    importRowId: integer("import_row_id").references(() => importRows.id, {
      onDelete: "set null",
    }),
    providerCampaignId: integer("provider_campaign_id"),
    workflowId: integer("workflow_id").notNull(),
    providerWorkflowRunId: text("provider_workflow_run_id"),
    state: text("state").notNull(),
    gatheredContext: jsonb("gathered_context").$type<Record<string, unknown>>(),
    recordingUrl: text("recording_url"),
    transcriptUrl: text("transcript_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("provider_runs_org_created_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("provider_runs_workflow_run_idx").on(table.providerWorkflowRunId),
  ],
);
