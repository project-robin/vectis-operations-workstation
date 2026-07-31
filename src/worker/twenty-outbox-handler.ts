import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { TwentyAdapter } from "../server/adapters/twenty/adapter.js";
import type { Database } from "../server/db/client.js";
import { importRows } from "../server/db/schema/imports.js";
import { providerRuns } from "../server/db/schema/provider-runs.js";

const deliverySchema = z.object({ providerRunId: z.uuid() });
const outcomeSchema = z.object({
  phone: z.string().min(1),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.email().nullable(),
  providerRunId: z.uuid(),
  state: z.enum(["completed", "failed"]),
  gatheredContext: z.record(z.string(), z.unknown()).nullable(),
  recordingUrl: z.url().nullable(),
  transcriptUrl: z.url().nullable(),
});

export async function deliverTwentyCallOutcome(
  db: Database,
  adapter: Pick<TwentyAdapter, "syncCallOutcome">,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const { providerRunId } = deliverySchema.parse(payload);
  const [row] = await db
    .select({
      phone: importRows.normalizedPhone,
      firstName: importRows.firstName,
      lastName: importRows.lastName,
      email: importRows.email,
      providerRunId: providerRuns.id,
      state: providerRuns.state,
      gatheredContext: providerRuns.gatheredContext,
      recordingUrl: providerRuns.recordingUrl,
      transcriptUrl: providerRuns.transcriptUrl,
    })
    .from(providerRuns)
    .innerJoin(
      importRows,
      and(
        eq(importRows.id, providerRuns.importRowId),
        eq(importRows.organizationId, providerRuns.organizationId),
      ),
    )
    .where(eq(providerRuns.id, providerRunId));
  if (!row) {
    throw new Error("Provider run has no correlated import row");
  }

  const outcome = outcomeSchema.parse(row);
  await adapter.syncCallOutcome(
    {
      ...outcome,
      firstName: outcome.firstName ?? "",
      lastName: outcome.lastName ?? "",
      gatheredContext: outcome.gatheredContext ?? {},
    },
    idempotencyKey,
  );
}
