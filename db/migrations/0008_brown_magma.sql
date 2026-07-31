CREATE TABLE "audit_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_records_org_idempotency_idx" ON "audit_records" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "audit_records_org_created_idx" ON "audit_records" USING btree ("organization_id","created_at");