CREATE TABLE "health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"component" text NOT NULL,
	"status" text NOT NULL,
	"detail" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_snapshots" ADD CONSTRAINT "health_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_snapshots_org_component_checked_idx" ON "health_snapshots" USING btree ("organization_id","component","checked_at");