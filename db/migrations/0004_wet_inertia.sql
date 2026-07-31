CREATE TABLE "provider_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_campaign_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"provider_workflow_run_id" text,
	"state" text NOT NULL,
	"gathered_context" jsonb,
	"recording_url" text,
	"transcript_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_runs_org_created_idx" ON "provider_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_runs_workflow_run_idx" ON "provider_runs" USING btree ("provider_workflow_run_id");