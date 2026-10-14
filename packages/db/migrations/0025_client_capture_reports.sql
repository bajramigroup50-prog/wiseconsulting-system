CREATE TABLE "client_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"period" text NOT NULL,
	"data" jsonb NOT NULL,
	"lang" text DEFAULT 'mk' NOT NULL,
	"summary" text,
	"ai_status" text DEFAULT 'none' NOT NULL,
	"ai_error" text,
	"ai_model" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_to" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "doc_kind" text;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_reports_firm_period_uq" ON "client_reports" USING btree ("firm_id","period");--> statement-breakpoint
CREATE INDEX "client_reports_status_idx" ON "client_reports" USING btree ("firm_id","status");