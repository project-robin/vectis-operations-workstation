import type { Database } from "../../server/db/client.js";
import { appendEvent } from "../../server/events/event-ledger.js";
import { recordHealthSnapshot } from "../../server/health/health-repository.js";
import { type HealthProbeOptions, probeHealth } from "./probe-health.js";

export async function runHealthCheck(
  db: Database,
  organizationId: string,
  options: HealthProbeOptions,
) {
  const result = await probeHealth(options);

  await recordHealthSnapshot(db, {
    organizationId,
    component: result.component,
    status: result.status,
    detail: result.detail,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
  });

  await appendEvent(db, {
    organizationId,
    eventType: "health.checked",
    payload: {
      component: result.component,
      status: result.status,
      latencyMs: result.latencyMs,
    },
  });

  return result;
}
