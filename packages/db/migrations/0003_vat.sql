CREATE TABLE "vat_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_kind" text NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closing_journal_id" uuid,
	"ddv04" jsonb,
	"corrections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopened_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_periods_status_chk" CHECK ("vat_periods"."status" in ('open','closed')),
	CONSTRAINT "vat_periods_kind_chk" CHECK ("vat_periods"."period_kind" in ('month','quarter')),
	CONSTRAINT "vat_periods_range_chk" CHECK ("vat_periods"."date_from" <= "vat_periods"."date_to")
);
--> statement-breakpoint
ALTER TABLE "vat_periods" ADD CONSTRAINT "vat_periods_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_periods" ADD CONSTRAINT "vat_periods_closing_journal_id_journals_id_fk" FOREIGN KEY ("closing_journal_id") REFERENCES "public"."journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_periods" ADD CONSTRAINT "vat_periods_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_periods" ADD CONSTRAINT "vat_periods_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vat_periods_firm_period_uq" ON "vat_periods" USING btree ("firm_id","period");--> statement-breakpoint
CREATE INDEX "vat_periods_firm_range_idx" ON "vat_periods" USING btree ("firm_id","date_from","date_to");