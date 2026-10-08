CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"no" text,
	"name" text NOT NULL,
	"embg" text,
	"position" text,
	"oe" text,
	"city" text,
	"address" text,
	"email" text,
	"net_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"coef" numeric(8, 4) DEFAULT '1' NOT NULL,
	"start" date,
	"end" date,
	"staz_prev" numeric(6, 2),
	"staz_y" numeric(6, 2),
	"contract" text,
	"bank_acc" text,
	"bank" text,
	"mp_ops" text,
	"mp_zan" text,
	"mp_c26" text,
	"h_norm" numeric(10, 2),
	"leave_days" integer DEFAULT 20 NOT NULL,
	"m1_date" date,
	"lek_date" date,
	"bzr_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"end_reason" text,
	"end_doc_no" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"type" text NOT NULL,
	"no" text NOT NULL,
	"sign_date" date NOT NULL,
	"place" text,
	"start" date NOT NULL,
	"end" date,
	"first_start" date,
	"reason" text,
	"position" text,
	"duties" text,
	"work_place" text,
	"hours" numeric(5, 2) DEFAULT '40' NOT NULL,
	"probation" integer,
	"gross" numeric(18, 2),
	"net" numeric(18, 2),
	"leave" integer DEFAULT 20 NOT NULL,
	"notice" integer DEFAULT 1 NOT NULL,
	"rep" text,
	"rep_role" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"employee_id" uuid,
	"contract_id" uuid,
	"kind" text NOT NULL,
	"no" text NOT NULL,
	"date" date NOT NULL,
	"emp_name" text NOT NULL,
	"ctype" text,
	"start" date,
	"end" date,
	"days" numeric(6, 1),
	"position" text,
	"ref_no" text,
	"transform" boolean DEFAULT false NOT NULL,
	"code" text,
	"title" text,
	"snap" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_docs_no_chk" CHECK (length(trim("hr_docs"."no")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_emp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"employee_id" uuid,
	"pos" integer NOT NULL,
	"no" text,
	"name" text NOT NULL,
	"embg" text,
	"net_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gross_base" numeric(18, 2),
	"coef" numeric(8, 4) DEFAULT '1' NOT NULL,
	"staz_y" numeric(6, 2),
	"h_norm" numeric(10, 2),
	"short" boolean DEFAULT false NOT NULL,
	"union" boolean DEFAULT false NOT NULL,
	"no_tax" boolean DEFAULT false NOT NULL,
	"adv" boolean DEFAULT false NOT NULL,
	"inout" text DEFAULT 'full' NOT NULL,
	"io_date" date,
	"gross" numeric(18, 2) DEFAULT '0' NOT NULL,
	"contr" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea",
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_emp_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"pos" integer NOT NULL,
	"type" text NOT NULL,
	"code" text,
	"cat" text NOT NULL,
	"hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"pct" numeric(8, 2),
	"amt" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payer" text,
	"mpin" text,
	CONSTRAINT "payroll_lines_cat_chk" CHECK ("payroll_lines"."cat" in ('reg','dop','bol','odm','kor','sin'))
);
--> statement-breakpoint
CREATE TABLE "payroll_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"month" text NOT NULL,
	"type" text NOT NULL,
	"employee_id" uuid,
	"emp_name" text,
	"amount" numeric(18, 2),
	"text" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"done_month" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_params" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"from" text NOT NULL,
	"avg" numeric(18, 2),
	"min_base" numeric(18, 2),
	"max_base" numeric(18, 2),
	"exempt" numeric(18, 2),
	"min_gross" numeric(18, 2),
	"min_net" numeric(18, 2),
	"pio" numeric(8, 4),
	"zdr" numeric(8, 4),
	"dop" numeric(8, 4),
	"vrab" numeric(8, 4),
	"tax" numeric(8, 4),
	"src" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_params_from_chk" CHECK ("payroll_params"."from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"month" text NOT NULL,
	"date" date NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"journal_id" uuid,
	"source" text DEFAULT 'cal' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_month_chk" CHECK ("payroll_runs"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_runs_status_chk" CHECK ("payroll_runs"."status" in ('draft','posted'))
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"scheme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"orders" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mpin_template" jsonb,
	"hr_prefix" text,
	"group_mail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"recipients" jsonb NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "mail_log_status_chk" CHECK ("mail_log"."status" in ('queued','sent','failed'))
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_docs" ADD CONSTRAINT "hr_docs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_docs" ADD CONSTRAINT "hr_docs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_docs" ADD CONSTRAINT "hr_docs_contract_id_hr_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."hr_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_docs" ADD CONSTRAINT "hr_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_emp" ADD CONSTRAINT "payroll_emp_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_emp" ADD CONSTRAINT "payroll_emp_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_emp" ADD CONSTRAINT "payroll_emp_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_emp_id_payroll_emp_id_fk" FOREIGN KEY ("run_emp_id") REFERENCES "public"."payroll_emp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notes" ADD CONSTRAINT "payroll_notes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notes" ADD CONSTRAINT "payroll_notes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notes" ADD CONSTRAINT "payroll_notes_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notes" ADD CONSTRAINT "payroll_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_params" ADD CONSTRAINT "payroll_params_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_params" ADD CONSTRAINT "payroll_params_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_firm_name_idx" ON "employees" USING btree ("firm_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_firm_embg_uq" ON "employees" USING btree ("firm_id","embg") WHERE "employees"."embg" is not null and "employees"."embg" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "employees_firm_legacy_uq" ON "employees" USING btree ("firm_id","legacy_id") WHERE "employees"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_contracts_current_uq" ON "hr_contracts" USING btree ("employee_id") WHERE "hr_contracts"."current";--> statement-breakpoint
CREATE INDEX "hr_contracts_firm_idx" ON "hr_contracts" USING btree ("firm_id","sign_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_docs_firm_no_uq" ON "hr_docs" USING btree ("firm_id","no");--> statement-breakpoint
CREATE INDEX "hr_docs_firm_date_idx" ON "hr_docs" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "hr_docs_employee_idx" ON "hr_docs" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "hr_docs_code_idx" ON "hr_docs" USING btree ("code");--> statement-breakpoint
CREATE INDEX "payroll_emp_run_idx" ON "payroll_emp" USING btree ("run_id","pos");--> statement-breakpoint
CREATE INDEX "payroll_emp_employee_idx" ON "payroll_emp" USING btree ("firm_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_exports_run_idx" ON "payroll_exports" USING btree ("run_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "payroll_lines_emp_idx" ON "payroll_lines" USING btree ("run_emp_id","pos");--> statement-breakpoint
CREATE INDEX "payroll_notes_firm_idx" ON "payroll_notes" USING btree ("firm_id","done","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_params_global_uq" ON "payroll_params" USING btree ("from") WHERE "payroll_params"."firm_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_params_firm_uq" ON "payroll_params" USING btree ("firm_id","from") WHERE "payroll_params"."firm_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_firm_month_uq" ON "payroll_runs" USING btree ("firm_id","month");--> statement-breakpoint
CREATE INDEX "mail_log_firm_created_idx" ON "mail_log" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_log_entity_idx" ON "mail_log" USING btree ("entity_type","entity_id");