import type { Database } from "../server/db/client.js";
import {
  claimDeliveries,
  completeDelivery,
  failDelivery,
} from "../server/outbox/outbox-repository.js";

export async function runOutboxBatch(
  db: Database,
  handlers: Record<
    string,
    (payload: Record<string, unknown>, idempotencyKey: string) => Promise<void>
  >,
  now = new Date(),
  limit = 25,
  maxAttempts = 5,
) {
  const deliveries = await claimDeliveries(db, now, limit);
  let succeeded = 0;

  for (const delivery of deliveries) {
    try {
      const handler = handlers[delivery.type];
      if (!handler) {
        throw new Error(`No outbox handler for ${delivery.type}`);
      }
      await handler(delivery.payload, delivery.idempotencyKey);
      await completeDelivery(db, delivery.id, now);
      succeeded += 1;
    } catch (error) {
      await failDelivery(db, {
        deliveryId: delivery.id,
        attempts: delivery.attempts,
        error: error instanceof Error ? error.message : "Unknown delivery error",
        now,
        maxAttempts,
      });
    }
  }

  return { processed: deliveries.length, succeeded, failed: deliveries.length - succeeded };
}
