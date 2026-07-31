import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { campaigns } from "../db/schema/campaigns.js";
import { importBatches, importRows } from "../db/schema/imports.js";
import { type OutboxStatus, outboxDeliveries } from "../db/schema/outbox-deliveries.js";
import { providerRuns } from "../db/schema/provider-runs.js";

function displayName(firstName: string | null, lastName: string | null, phone: string): string {
  return [firstName, lastName].filter(Boolean).join(" ") || phone;
}

function contextString(context: Record<string, unknown> | null, key: string): string | null {
  const value = context?.[key];
  return typeof value === "string" && value ? value : null;
}

function contextBoolean(context: Record<string, unknown> | null, key: string): boolean {
  const value = context?.[key];
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function maskedPhone(phone: string): string {
  return phone.length > 8 ? `${phone.slice(0, 4)}****${phone.slice(-4)}` : phone;
}

export async function getOwnerOverview(db: Database, organizationId: string) {
  const [[leadMetrics], [runMetrics], [deliveryMetrics], recentRuns] = await Promise.all([
    db
      .select({ totalLeads: sql<number>`count(*)::int` })
      .from(importRows)
      .where(eq(importRows.organizationId, organizationId)),
    db
      .select({
        callsCompleted: sql<number>`count(*) filter (where ${providerRuns.state} = 'completed')::int`,
        qualifiedLeads: sql<number>`count(*) filter (where ${providerRuns.state} = 'completed' and (${providerRuns.gatheredContext}->>'lead_status' = 'qualified' or ${providerRuns.gatheredContext}->>'call_disposition' = 'user_qualified'))::int`,
        followUpsRequired: sql<number>`count(*) filter (where ${providerRuns.state} = 'completed' and lower(coalesce(${providerRuns.gatheredContext}->>'follow_up_required', 'false')) = 'true')::int`,
      })
      .from(providerRuns)
      .where(eq(providerRuns.organizationId, organizationId)),
    db
      .select({
        crmSynced: sql<number>`count(*) filter (where ${outboxDeliveries.status} = 'succeeded')::int`,
      })
      .from(outboxDeliveries)
      .where(eq(outboxDeliveries.organizationId, organizationId)),
    db
      .select({
        leadId: importRows.id,
        firstName: importRows.firstName,
        lastName: importRows.lastName,
        phone: importRows.normalizedPhone,
        state: providerRuns.state,
        gatheredContext: providerRuns.gatheredContext,
        completedAt: providerRuns.completedAt,
      })
      .from(providerRuns)
      .innerJoin(
        importRows,
        and(
          eq(providerRuns.importRowId, importRows.id),
          eq(providerRuns.organizationId, importRows.organizationId),
        ),
      )
      .where(eq(providerRuns.organizationId, organizationId))
      .orderBy(desc(providerRuns.createdAt))
      .limit(10),
  ]);

  return {
    metrics: {
      totalLeads: leadMetrics?.totalLeads ?? 0,
      callsCompleted: runMetrics?.callsCompleted ?? 0,
      qualifiedLeads: runMetrics?.qualifiedLeads ?? 0,
      followUpsRequired: runMetrics?.followUpsRequired ?? 0,
      crmSynced: deliveryMetrics?.crmSynced ?? 0,
    },
    recentOutcomes: recentRuns.map((run) => ({
      leadId: run.leadId,
      displayName: displayName(run.firstName, run.lastName, run.phone ?? "Lead"),
      phone: run.phone ? maskedPhone(run.phone) : "Unavailable",
      state: run.state,
      leadStatus: contextString(run.gatheredContext, "lead_status"),
      disposition: contextString(run.gatheredContext, "call_disposition"),
      summary: contextString(run.gatheredContext, "call_summary"),
      followUpRequired: contextBoolean(run.gatheredContext, "follow_up_required"),
      quoteRequested: contextBoolean(run.gatheredContext, "quote_requested"),
      completedAt: run.completedAt,
    })),
  };
}

export async function listCampaigns(db: Database, organizationId: string) {
  const campaignRows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      workflowId: campaigns.workflowId,
      providerCampaignId: campaigns.providerCampaignId,
      totalLeads: sql<number>`(${importBatches.summary}->>'valid')::int`,
      createdAt: campaigns.createdAt,
      approvedAt: campaigns.approvedAt,
      startedAt: campaigns.startedAt,
    })
    .from(campaigns)
    .innerJoin(
      importBatches,
      and(
        eq(campaigns.importBatchId, importBatches.id),
        eq(importBatches.organizationId, organizationId),
      ),
    )
    .where(eq(campaigns.organizationId, organizationId))
    .orderBy(desc(campaigns.createdAt));
  const providerIds = campaignRows
    .map((campaign) => campaign.providerCampaignId)
    .filter((id): id is number => id !== null);
  const runs = providerIds.length
    ? await db
        .select({ providerCampaignId: providerRuns.providerCampaignId, state: providerRuns.state })
        .from(providerRuns)
        .where(
          and(
            eq(providerRuns.organizationId, organizationId),
            inArray(providerRuns.providerCampaignId, providerIds),
          ),
        )
    : [];

  return campaignRows.map((campaign) => {
    const campaignRuns = runs.filter(
      (run) => run.providerCampaignId === campaign.providerCampaignId,
    );
    return {
      ...campaign,
      processedCalls: campaignRuns.filter((run) => ["completed", "failed"].includes(run.state))
        .length,
      completedCalls: campaignRuns.filter((run) => run.state === "completed").length,
      failedCalls: campaignRuns.filter((run) => run.state === "failed").length,
    };
  });
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
      gatheredContext: providerRuns.gatheredContext,
      completedAt: providerRuns.completedAt,
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
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    classification: row.classification,
    providerState: row.providerState,
    phone: row.phone ? maskedPhone(row.phone) : "Unavailable",
    displayName: displayName(row.firstName, row.lastName, row.phone ?? "Lead"),
    callSummary: contextString(row.gatheredContext, "call_summary"),
    leadStatus: contextString(row.gatheredContext, "lead_status"),
    disposition: contextString(row.gatheredContext, "call_disposition"),
    followUpRequired: contextBoolean(row.gatheredContext, "follow_up_required"),
    quoteRequested: contextBoolean(row.gatheredContext, "quote_requested"),
    completedAt: row.completedAt,
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

export async function listDeliveries(db: Database, organizationId: string, status?: OutboxStatus) {
  const rows = await db
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
      firstName: importRows.firstName,
      lastName: importRows.lastName,
      phone: importRows.normalizedPhone,
      gatheredContext: providerRuns.gatheredContext,
    })
    .from(outboxDeliveries)
    .leftJoin(
      providerRuns,
      and(
        eq(providerRuns.organizationId, outboxDeliveries.organizationId),
        sql`${outboxDeliveries.payload}->>'providerRunId' = ${providerRuns.id}::text`,
      ),
    )
    .leftJoin(
      importRows,
      and(
        eq(providerRuns.importRowId, importRows.id),
        eq(providerRuns.organizationId, importRows.organizationId),
      ),
    )
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

  return rows.map(({ firstName, lastName, phone, gatheredContext, ...delivery }) => ({
    ...delivery,
    displayName:
      firstName || lastName || phone ? displayName(firstName, lastName, phone ?? "Lead") : null,
    callSummary: contextString(gatheredContext, "call_summary"),
    destination: delivery.type.startsWith("twenty.") ? "Twenty CRM" : delivery.type,
  }));
}

export async function listAttentionItems(db: Database, organizationId: string) {
  const followUpRuns = await db
    .select({
      id: providerRuns.id,
      leadId: providerRuns.importRowId,
      firstName: importRows.firstName,
      lastName: importRows.lastName,
      phone: importRows.normalizedPhone,
      gatheredContext: providerRuns.gatheredContext,
      occurredAt: providerRuns.completedAt,
    })
    .from(providerRuns)
    .innerJoin(
      importRows,
      and(
        eq(providerRuns.importRowId, importRows.id),
        eq(providerRuns.organizationId, importRows.organizationId),
      ),
    )
    .where(
      and(
        eq(providerRuns.organizationId, organizationId),
        eq(providerRuns.state, "completed"),
        sql`lower(coalesce(${providerRuns.gatheredContext}->>'follow_up_required', 'false')) = 'true'`,
      ),
    );
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
    ...followUpRuns.map((item) => ({
      id: `follow-up-${item.id}`,
      kind: "follow_up_required" as const,
      title: `${displayName(item.firstName, item.lastName, item.phone ?? "Lead")} needs follow-up`,
      summary:
        contextString(item.gatheredContext, "call_summary") ??
        "The customer asked for a follow-up after the call.",
      leadId: item.leadId,
      retryable: false,
      occurredAt: item.occurredAt,
    })),
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
