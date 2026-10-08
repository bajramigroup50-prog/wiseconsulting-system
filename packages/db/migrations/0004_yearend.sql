CREATE TABLE "annual_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"aop" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"zs_man" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"de_man" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"f35_raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"crm_import" jsonb,
	"crm_period" integer DEFAULT 1 NOT NULL,
	"db_adj" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vp_adj" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dld_adj" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ack" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depreciation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"journal_id" uuid,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"inv_no" text,
	"name" text NOT NULL,
	"konto" text NOT NULL,
	"rate" numeric(7, 3) DEFAULT '0' NOT NULL,
	"date" date NOT NULL,
	"cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vehicle_only" boolean DEFAULT false NOT NULL,
	"disposed" date,
	"serial" text,
	"barcode" text,
	"supplier" text,
	"inv_doc" text,
	"location" text,
	"note" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"entity" text,
	"close_journal_id" uuid,
	"open_journal_id" uuid,
	"profit" numeric(18, 2),
	"tax" numeric(18, 2),
	"net" numeric(18, 2),
	"imported" boolean DEFAULT false NOT NULL,
	"db" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"opened_at" timestamp with time zone,
	"opened_by" uuid,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annual_statements" ADD CONSTRAINT "annual_statements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_statements" ADD CONSTRAINT "annual_statements_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_statements" ADD CONSTRAINT "annual_statements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_closings" ADD CONSTRAINT "year_closings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_closings" ADD CONSTRAINT "year_closings_close_journal_id_journals_id_fk" FOREIGN KEY ("close_journal_id") REFERENCES "public"."journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_closings" ADD CONSTRAINT "year_closings_open_journal_id_journals_id_fk" FOREIGN KEY ("open_journal_id") REFERENCES "public"."journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_closings" ADD CONSTRAINT "year_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_closings" ADD CONSTRAINT "year_closings_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_closings" ADD CONSTRAINT "year_closings_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annual_statements_uq" ON "annual_statements" USING btree ("firm_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "depreciation_runs_uq" ON "depreciation_runs" USING btree ("firm_id","year");--> statement-breakpoint
CREATE INDEX "fixed_assets_firm_idx" ON "fixed_assets" USING btree ("firm_id","konto");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_inv_uq" ON "fixed_assets" USING btree ("firm_id","inv_no") WHERE "fixed_assets"."inv_no" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "year_closings_uq" ON "year_closings" USING btree ("firm_id","year");