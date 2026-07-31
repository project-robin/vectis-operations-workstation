import { and, asc, eq, gt } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { operationEvents } from "../db/schema/operation-events.js";

export interface AppendEventInput {
  organizationId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface ReplayEventsInput {
  organizationId: string;
  afterId: number;
}

export async function appendEvent(db: Database, input: AppendEventInput) {
  const [event] = await db.insert(operationEvents).values(input).returning();

  if (!event) {
    throw new Error("Event insert returned no row");
  }

  return event;
}

export function listEventsAfter(db: Database, input: ReplayEventsInput) {
  return db
    .select()
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.organizationId, input.organizationId),
        gt(operationEvents.id, input.afterId),
      ),
    )
    .orderBy(asc(operationEvents.id));
}
