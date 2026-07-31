CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"workflow_id" integer NOT NULL,
	"status" text NOT NULL,
	"provider_campaign_id" integer,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"started_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "provider_runs" ALTER COLUMN "provider_campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_org_created_idx" ON "campaigns" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_provider_id_idx" ON "campaigns" USING btree ("provider_campaign_id");