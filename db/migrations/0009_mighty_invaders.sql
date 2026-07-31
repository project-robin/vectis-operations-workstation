DROP INDEX "outbox_idempotency_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_org_idempotency_key_idx" ON "outbox_deliveries" USING btree ("organization_id","idempotency_key");