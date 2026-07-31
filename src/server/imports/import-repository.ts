import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { importBatches, importRows } from "../db/schema/imports.js";
import { operationEvents } from "../db/schema/operation-events.js";
import { parseLeadCsv } from "./parse-lead-csv.js";

export interface StageImportInput {
  organizationId: string;
  filename: string;
  defaultCallingCode: string;
  csv: string;
}

export async function stageImport(db: Database, input: StageImportInput) {
  const parsed = parseLeadCsv(input.csv, { defaultCallingCode: input.defaultCallingCode });
  const batchId = randomUUID();

  return db.transaction(async (transaction) => {
    const [batch] = await transaction
      .insert(importBatches)
      .values({
        id: batchId,
        organizationId: input.organizationId,
        filename: input.filename,
        defaultCallingCode: input.defaultCallingCode,
        status: "staged",
        summary: parsed.summary,
      })
      .returning();

    if (!batch) {
      throw new Error("Import batch insert returned no row");
    }

    if (parsed.rows.length > 0) {
      await transaction.insert(importRows).values(
        parsed.rows.map((row) => ({
          batchId,
          organizationId: input.organizationId,
          rowNumber: row.rowNumber,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          originalPhone: row.originalPhone,
          normalizedPhone: row.normalizedPhone,
          consentStatus: row.consentStatus,
          classification: row.classification,
          reason: row.reason,
        })),
      );
    }

    await transaction.insert(operationEvents).values({
      organizationId: input.organizationId,
      eventType: "import.staged",
      payload: { batchId, filename: input.filename, summary: parsed.summary },
    });

    return batch;
  });
}

export async function commitImport(db: Database, organizationId: string, batchId: string) {
  return db.transaction(async (transaction) => {
    const [batch] = await transaction
      .update(importBatches)
      .set({ status: "committed", committedAt: new Date() })
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.organizationId, organizationId),
          eq(importBatches.status, "staged"),
        ),
      )
      .returning();

    if (!batch) {
      throw new Error("Import batch is unavailable or not staged");
    }

    await transaction.insert(operationEvents).values({
      organizationId,
      eventType: "import.committed",
      payload: { batchId },
    });
    return batch;
  });
}

export async function approveImport(db: Database, organizationId: string, batchId: string) {
  return db.transaction(async (transaction) => {
    const [batch] = await transaction
      .update(importBatches)
      .set({ status: "approved", approvedAt: new Date() })
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.organizationId, organizationId),
          eq(importBatches.status, "committed"),
        ),
      )
      .returning();

    if (!batch) {
      throw new Error("Import batch is unavailable or not committed");
    }

    await transaction.insert(operationEvents).values({
      organizationId,
      eventType: "import.approved",
      payload: { batchId },
    });
    return batch;
  });
}

export function listEligibleImportRows(db: Database, organizationId: string, batchId: string) {
  return db
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      firstName: importRows.firstName,
      lastName: importRows.lastName,
      email: importRows.email,
      normalizedPhone: importRows.normalizedPhone,
      classification: importRows.classification,
    })
    .from(importRows)
    .innerJoin(importBatches, eq(importRows.batchId, importBatches.id))
    .where(
      and(
        eq(importRows.organizationId, organizationId),
        eq(importRows.batchId, batchId),
        eq(importRows.classification, "valid"),
        eq(importBatches.organizationId, organizationId),
        eq(importBatches.status, "approved"),
      ),
    );
}

export async function getImportPreview(db: Database, organizationId: string, batchId: string) {
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.organizationId, organizationId)));

  if (!batch) {
    return null;
  }

  const rows = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), eq(importRows.organizationId, organizationId)))
    .orderBy(asc(importRows.rowNumber));

  return { ...batch, rows };
}
