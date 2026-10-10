CREATE TABLE "mpin_acks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"month" text NOT NULL,
	"no" text,
	"date" text,
	"status" text,
	"gross" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"due" text,
	"folio" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_id" uuid,
	"dossier_id" uuid,
	"journal_id" uuid,
	"run_id" uuid,
	"corr" boolean DEFAULT false NOT NULL,
	"replaced" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpin_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"firm_id" uuid,
	"error" text,
	"res" text,
	"ack_id" uuid,
	"cleared" boolean DEFAULT false NOT NULL,
	"model" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mpin_acks" ADD CONSTRAINT "mpin_acks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_acks" ADD CONSTRAINT "mpin_acks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_acks" ADD CONSTRAINT "mpin_acks_dossier_id_dossier_docs_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossier_docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_acks" ADD CONSTRAINT "mpin_acks_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_acks" ADD CONSTRAINT "mpin_acks_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_acks" ADD CONSTRAINT "mpin_acks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_inbox" ADD CONSTRAINT "mpin_inbox_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_inbox" ADD CONSTRAINT "mpin_inbox_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpin_inbox" ADD CONSTRAINT "mpin_inbox_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mpin_acks_firm_month_uq" ON "mpin_acks" USING btree ("firm_id","month") WHERE not "mpin_acks"."replaced";--> statement-breakpoint
CREATE INDEX "mpin_acks_month_idx" ON "mpin_acks" USING btree ("month");--> statement-breakpoint
CREATE INDEX "mpin_inbox_user_idx" ON "mpin_inbox" USING btree ("created_by","cleared","created_at");