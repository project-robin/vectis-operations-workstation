import { index, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { HealthStatus } from "../../../worker/health/probe-health.js";
import { organizations } from "./organizations.js";

export const healthSnapshots = pgTable(
  "health_snapshots",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    component: text("component").notNull(),
    status: text("status").$type<HealthStatus>().notNull(),
    detail: text("detail").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("health_snapshots_org_component_checked_idx").on(
      table.organizationId,
      table.component,
      table.checkedAt,
    ),
  ],
);
