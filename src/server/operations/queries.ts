import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { importBatches, importRows } from "../db/schema/imports.js";
import { type OutboxStatus, outboxDeliveries } from "../db/schema/outbox-deliveries.js";
import { providerRuns } from "../db/schema/provider-runs.js";

function displayName(firstName: string | null, lastName: string | null, phone: string): string {
  return [firstName, lastName].filter(Boolean).join(" ") || phone;
}

export async function listLeads(db: Database, organizationId: string) {
  const rows = await db
    .selectDistinctOn([importRows.id], {
      id: importRows.id,
      firstName: importRows.firstName,
      lastName: importRows.lastName,
      phone: importRows.normalizedPhone,
      classification: importRows.classification,
      providerState: providerRuns.state,
    })
    .from(importRows)
    .leftJoin(
      providerRuns,
      and(
        eq(providerRuns.importRowId, importRows.id),
        eq(providerRuns.organizationId, importRows.organizationId),
      ),
    )
    .where(eq(importRows.organizationId, organizationId))
    .orderBy(importRows.id, desc(providerRuns.createdAt));

  return rows.map((row) => ({
    ...row,
    phone: row.phone ?? "Unavailable",
    displayName: displayName(row.firstName, row.lastName, row.phone ?? "Lead"),
  }));
}

export async function getLeadTrace(db: Database, organizationId: string, leadId: number) {
  const [lead] = await db
    .select({
      id: importRows.id,
      firstName: importRows.firstName,
      lastName: importRows.lastName,
      phone: importRows.normalizedPhone,
      email: importRows.email,
      classification: importRows.classification,
      consentStatus: importRows.consentStatus,
      batchId: importRows.batchId,
      importedAt: importBatches.createdAt,
    })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.batchId))
    .where(and(eq(importRows.id, leadId), eq(importRows.organizationId, organizationId)));
  if (!lead) {
    return null;
  }

  const runs = await db
    .select()
    .from(providerRuns)
    .where(
      and(eq(providerRuns.organizationId, organizationId), eq(providerRuns.importRowId, leadId)),
    )
    .orderBy(desc(providerRuns.createdAt));
  const runIds = runs.map((run) => run.id);
  const deliveries =
    runIds.length === 0
      ? []
      : await db
          .select({
            id: outboxDeliveries.id,
            type: outboxDeliveries.type,
            status: outboxDeliveries.status,
            attempts: outboxDeliveries.attempts,
            nextAttemptAt: outboxDeliveries.nextAttemptAt,
            lastError: outboxDeliveries.lastError,
            completedAt: outboxDeliveries.completedAt,
            createdAt: outboxDeliveries.createdAt,
          })
          .from(outboxDeliveries)
          .where(
            and(
              eq(outboxDeliveries.organizationId, organizationId),
              inArray(sql<string>`${outboxDeliveries.payload}->>'providerRunId'`, runIds),
            ),
          )
          .orderBy(desc(outboxDeliveries.createdAt));

  const timeline = [
    {
      id: `lead-${lead.id}`,
      component: "workstation",
      title: "Lead imported",
      status: lead.classification,
      occurredAt: lead.importedAt,
    },
    ...runs.flatMap((run) => [
      {
        id: `run-${run.id}-created`,
        component: "dograh",
        title: "Call queued",
        status: "pending",
        occurredAt: run.createdAt,
      },
      ...(run.completedAt
        ? [
            {
              id: `run-${run.id}-completed`,
              component: "dograh",
              title: run.state === "failed" ? "Call failed" : "Call completed",
              status: run.state,
              occurredAt: run.completedAt,
            },
          ]
        : []),
    ]),
    ...deliveries.map((delivery) => ({
      id: `delivery-${delivery.id}`,
      component: "twenty",
      title: "CRM outcome delivery",
      status: delivery.status,
      occurredAt: delivery.completedAt ?? delivery.createdAt,
    })),
  ].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());

  return {
    lead: {
      ...lead,
      phone: lead.phone ?? "Unavailable",
      displayName: displayName(lead.firstName, lead.lastName, lead.phone ?? "Lead"),
    },
    runs,
    deliveries,
    timeline,
  };
}

export function listDeliveries(db: Database, organizationId: string, status?: OutboxStatus) {
  return db
    .select({
      id: outboxDeliveries.id,
      type: outboxDeliveries.type,
      status: outboxDeliveries.status,
      attempts: outboxDeliveries.attempts,
      providerRunId: sql<string | null>`${outboxDeliveries.payload}->>'providerRunId'`,
      nextAttemptAt: outboxDeliveries.nextAttemptAt,
      lastError: outboxDeliveries.lastError,
      completedAt: outboxDeliveries.completedAt,
      createdAt: outboxDeliveries.createdAt,
    })
    .from(outboxDeliveries)
    .where(
      status
        ? and(
            eq(outboxDeliveries.organizationId, organizationId),
            eq(outboxDeliveries.status, status),
          )
        : eq(outboxDeliveries.organizationId, organizationId),
    )
    .orderBy(desc(outboxDeliveries.createdAt))
    .limit(100);
}

export async function listAttentionItems(db: Database, organizationId: string) {
  const deadDeliveries = await db
    .select({
      id: outboxDeliveries.id,
      leadId: providerRuns.importRowId,
      occurredAt: outboxDeliveries.createdAt,
    })
    .from(outboxDeliveries)
    .leftJoin(
      providerRuns,
      sql`${outboxDeliveries.payload}->>'providerRunId' = ${providerRuns.id}::text`,
    )
    .where(
      and(eq(outboxDeliveries.organizationId, organizationId), eq(outboxDeliveries.status, "dead")),
    );
  const failedRuns = await db
    .select({
      id: providerRuns.id,
      leadId: providerRuns.importRowId,
      occurredAt: providerRuns.completedAt,
    })
    .from(providerRuns)
    .where(and(eq(providerRuns.organizationId, organizationId), eq(providerRuns.state, "failed")));

  return [
    ...deadDeliveries.map((item) => ({
      id: `delivery-${item.id}`,
      kind: "delivery_dead" as const,
      title: "CRM update needs attention",
      summary: "The call outcome could not be saved after repeated attempts.",
      leadId: item.leadId,
      retryable: true,
      occurredAt: item.occurredAt,
    })),
    ...failedRuns.map((item) => ({
      id: `run-${item.id}`,
      kind: "call_failed" as const,
      title: "Call did not complete",
      summary: "Review the provider run before deciding whether to try this lead again.",
      leadId: item.leadId,
      retryable: false,
      occurredAt: item.occurredAt,
    })),
  ].sort((left, right) => (right.occurredAt?.getTime() ?? 0) - (left.occurredAt?.getTime() ?? 0));
}
