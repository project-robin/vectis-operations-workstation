import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Bounded terminal scheduled-echo retention runs independently of pending work.
crons.interval("toolchain-heartbeat", { minutes: 30 }, internal.toolchain.sweep, {});
crons.interval("delivery-retry-sweep", { minutes: 5 }, internal.deliveries.sweepDue, {});
crons.interval(
  "clerk-webhook-ledger-retention",
  { hours: 1 },
  internal.http.clerkWebhook.cleanupRetention,
  {},
);
crons.interval(
  "campaign-reconciliation-sweep",
  { minutes: 5 },
  internal.campaigns.sweepReconciliation,
  { batchSize: 25 },
);

// Calling console: reconcile in-flight calls with Dograh (webhook is the fast path).
crons.interval("call-result-poll", { minutes: 1 }, internal.calls.pollActiveCalls, {});

export default crons;
