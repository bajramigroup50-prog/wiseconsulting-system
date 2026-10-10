CREATE TABLE "aml_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_firm_id" uuid,
	"firm_name" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'нова' NOT NULL,
	"note" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aml_reports" ADD CONSTRAINT "aml_reports_client_firm_id_firms_id_fk" FOREIGN KEY ("client_firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_reports" ADD CONSTRAINT "aml_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aml_reports_created_idx" ON "aml_reports" USING btree ("created_at");