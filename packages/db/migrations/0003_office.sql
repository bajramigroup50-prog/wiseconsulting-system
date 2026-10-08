CREATE TABLE "aml_records" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"level" text DEFAULT 'high' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"last_review" date,
	"next_review" date,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_findings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"key" text NOT NULL,
	"lvl" text NOT NULL,
	"cat" text NOT NULL,
	"txt" text NOT NULL,
	"go" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"ack_by" uuid,
	"ack_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "autopilot_messages" (
	"key" text PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"channels" text,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_metrics" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk" integer DEFAULT 0 NOT NULL,
	"risk_why" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"firms" integer DEFAULT 0 NOT NULL,
	"findings" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "client_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"target_type" text,
	"target_id" text
);
--> statement-breakpoint
CREATE TABLE "doc_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"recipient" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cover_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossier_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text,
	"number" text,
	"date" date,
	"valid_to" date,
	"partner_name" text,
	"note" text,
	"from_inbox_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firm_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firm_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due" date NOT NULL,
	"remind_days" integer DEFAULT 7 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firm_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number" text,
	"date" date,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"form" text DEFAULT 'ДООЕЛ' NOT NULL,
	"status" text DEFAULT 'prep' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cap_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"founders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"managers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eur_rate" numeric(10, 4) DEFAULT '61.5' NOT NULL,
	"firm_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gdpr_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"firm_id" uuid,
	"user_id" uuid,
	"subject" text NOT NULL,
	"date" date,
	"valid_to" date,
	"due" date,
	"status" text DEFAULT 'open' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"from_office" boolean DEFAULT false NOT NULL,
	"subject" text,
	"note" text,
	"from_user_id" uuid,
	"from_name" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"route" text,
	"route_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_states" (
	"firm_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"done_date" date,
	"na" boolean DEFAULT false NOT NULL,
	"note" text,
	"by_name" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_states_firm_id_item_id_pk" PRIMARY KEY("firm_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "office_counters" (
	"key" text NOT NULL,
	"year" integer NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "office_counters_key_year_pk" PRIMARY KEY("key","year")
);
--> statement-breakpoint
CREATE TABLE "office_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"prio" text DEFAULT 'normal' NOT NULL,
	"firm_id" uuid,
	"formation_id" uuid,
	"due" date,
	"inst" text,
	"type" text,
	"assignee_id" uuid,
	"description" text,
	"docs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received" text,
	"source_key" text,
	"done_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"every" text DEFAULT 'month' NOT NULL,
	"day" text DEFAULT '1' NOT NULL,
	"next" date,
	"end" date,
	"due_days" integer DEFAULT 15 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"mail" boolean DEFAULT false NOT NULL,
	"last" date,
	"last_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"user_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"due_at" timestamp with time zone NOT NULL,
	"channel" text DEFAULT 'app' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"start" date,
	"end" date,
	"fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'free' NOT NULL,
	"file_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"vars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aml_records" ADD CONSTRAINT "aml_records_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_records" ADD CONSTRAINT "aml_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_findings" ADD CONSTRAINT "autopilot_findings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_findings" ADD CONSTRAINT "autopilot_findings_ack_by_users_id_fk" FOREIGN KEY ("ack_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_messages" ADD CONSTRAINT "autopilot_messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_metrics" ADD CONSTRAINT "autopilot_metrics_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_entries" ADD CONSTRAINT "client_entries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_entries" ADD CONSTRAINT "client_entries_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_entries" ADD CONSTRAINT "client_entries_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_packages" ADD CONSTRAINT "doc_packages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_packages" ADD CONSTRAINT "doc_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_docs" ADD CONSTRAINT "dossier_docs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_docs" ADD CONSTRAINT "dossier_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_contacts" ADD CONSTRAINT "firm_contacts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_deadlines" ADD CONSTRAINT "firm_deadlines_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_deadlines" ADD CONSTRAINT "firm_deadlines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_docs" ADD CONSTRAINT "firm_docs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_docs" ADD CONSTRAINT "firm_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formation_cases" ADD CONSTRAINT "formation_cases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formation_cases" ADD CONSTRAINT "formation_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gdpr_records" ADD CONSTRAINT "gdpr_records_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gdpr_records" ADD CONSTRAINT "gdpr_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gdpr_records" ADD CONSTRAINT "gdpr_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_states" ADD CONSTRAINT "inspection_states_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_states" ADD CONSTRAINT "inspection_states_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_templates" ADD CONSTRAINT "word_templates_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_templates" ADD CONSTRAINT "word_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autopilot_findings_key_uq" ON "autopilot_findings" USING btree ("firm_id","key");--> statement-breakpoint
CREATE INDEX "autopilot_findings_open_idx" ON "autopilot_findings" USING btree ("resolved_at","lvl");--> statement-breakpoint
CREATE INDEX "autopilot_messages_firm_idx" ON "autopilot_messages" USING btree ("firm_id","status");--> statement-breakpoint
CREATE INDEX "client_entries_firm_status_idx" ON "client_entries" USING btree ("firm_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "doc_packages_firm_idx" ON "doc_packages" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "dossier_docs_firm_cat_idx" ON "dossier_docs" USING btree ("firm_id","category");--> statement-breakpoint
CREATE INDEX "dossier_docs_valid_idx" ON "dossier_docs" USING btree ("valid_to");--> statement-breakpoint
CREATE INDEX "firm_contacts_firm_idx" ON "firm_contacts" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "firm_deadlines_due_idx" ON "firm_deadlines" USING btree ("done","due");--> statement-breakpoint
CREATE INDEX "firm_deadlines_firm_idx" ON "firm_deadlines" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "firm_docs_firm_type_idx" ON "firm_docs" USING btree ("firm_id","type","date");--> statement-breakpoint
CREATE INDEX "formation_cases_status_idx" ON "formation_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gdpr_records_kind_idx" ON "gdpr_records" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "inbox_items_firm_idx" ON "inbox_items" USING btree ("firm_id","done","created_at");--> statement-breakpoint
CREATE INDEX "office_tasks_status_idx" ON "office_tasks" USING btree ("status","due");--> statement-breakpoint
CREATE INDEX "office_tasks_assignee_idx" ON "office_tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_tasks_source_uq" ON "office_tasks" USING btree ("source_key") WHERE "office_tasks"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "recurring_invoices_due_idx" ON "recurring_invoices" USING btree ("active","next");--> statement-breakpoint
CREATE INDEX "recurring_invoices_firm_idx" ON "recurring_invoices" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_key_uq" ON "reminders" USING btree ("key") WHERE "reminders"."key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_contracts_number_uq" ON "service_contracts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "service_contracts_firm_idx" ON "service_contracts" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "word_templates_kind_idx" ON "word_templates" USING btree ("kind","active");