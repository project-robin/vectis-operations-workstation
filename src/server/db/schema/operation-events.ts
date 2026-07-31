import { index, jsonb, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";

export const operationEvents = pgTable(
  "operation_events",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("operation_events_organization_id_id_idx").on(table.organizationId, table.id)],
);
