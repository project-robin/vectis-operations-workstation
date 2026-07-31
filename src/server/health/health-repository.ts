import { asc, desc, eq } from "drizzle-orm";
import type { HealthStatus } from "../../worker/health/probe-health.js";
import type { Database } from "../db/client.js";
import { healthSnapshots } from "../db/schema/health-snapshots.js";

export interface HealthSnapshotInput {
  organizationId: string;
  component: string;
  status: HealthStatus;
  detail: string;
  latencyMs: number;
  checkedAt: Date;
}

const healthFreshnessMs = 90_000;

export async function recordHealthSnapshot(db: Database, input: HealthSnapshotInput) {
  const [snapshot] = await db.insert(healthSnapshots).values(input).returning();

  if (!snapshot) {
    throw new Error("Health snapshot insert returned no row");
  }

  return snapshot;
}

export async function listLatestHealth(db: Database, organizationId: string) {
  const snapshots = await db
    .selectDistinctOn([healthSnapshots.organizationId, healthSnapshots.component])
    .from(healthSnapshots)
    .where(eq(healthSnapshots.organizationId, organizationId))
    .orderBy(
      asc(healthSnapshots.organizationId),
      asc(healthSnapshots.component),
      desc(healthSnapshots.checkedAt),
    );

  const staleBefore = Date.now() - healthFreshnessMs;
  return snapshots.map((snapshot) =>
    snapshot.checkedAt.getTime() < staleBefore
      ? {
          ...snapshot,
          status: "unknown" as const,
          detail: "Last verified check is stale",
        }
      : snapshot,
  );
}
