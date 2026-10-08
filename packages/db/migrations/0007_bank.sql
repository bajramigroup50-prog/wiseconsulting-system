CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"account" text,
	"iban" text,
	"cur" text DEFAULT 'MKD' NOT NULL,
	"konto" text NOT NULL,
	"nal" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_konto_digits" CHECK ("bank_accounts"."konto" ~ '^[0-9]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"date" date NOT NULL,
	"val_date" date,
	"amount" numeric(18, 2) NOT NULL,
	"amount_cur" numeric(18, 2),
	"cur" text,
	"mkd_from_bank" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"name" text,
	"purpose" text,
	"osnov" text,
	"bref" text,
	"counter_account" text,
	"konto" text,
	"partner_id" uuid,
	"ref_type" text,
	"ref_id" text,
	"ref_label" text,
	"refs" jsonb,
	"settle" numeric(18, 2),
	"split" jsonb,
	"pay_ref" text,
	"pos" boolean DEFAULT false NOT NULL,
	"own" boolean DEFAULT false NOT NULL,
	"conv" boolean DEFAULT false NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"auto" text,
	"new_partner" text,
	"dup_key" text NOT NULL,
	"import_batch" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_lines_konto_digits" CHECK ("bank_lines"."konto" is null or "bank_lines"."konto" ~ '^[0-9]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "bank_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text DEFAULT 'desc' NOT NULL,
	"match" text NOT NULL,
	"konto" text NOT NULL,
	"learned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_rules_konto_digits" CHECK ("bank_rules"."konto" ~ '^[0-9]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"number" text,
	"opening" numeric(18, 2),
	"closing" numeric(18, 2),
	"stated_debit" numeric(18, 2),
	"stated_credit" numeric(18, 2),
	"rate" numeric(18, 6),
	"format" text,
	"file_name" text,
	"file_id" uuid,
	"import_batch" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_registers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"konto" text NOT NULL,
	"cur" text DEFAULT 'MKD' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_registers_konto_digits" CHECK ("cash_registers"."konto" ~ '^[0-9]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "cash_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"legacy_id" text,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"number" text NOT NULL,
	"doc_no" text,
	"merchant" text,
	"vat_id" text,
	"country" text DEFAULT 'MK' NOT NULL,
	"cur" text DEFAULT 'MKD' NOT NULL,
	"amt" numeric(18, 2) NOT NULL,
	"fx" numeric(18, 6) DEFAULT '1' NOT NULL,
	"vat_rate" integer DEFAULT 0 NOT NULL,
	"vat" numeric(18, 2),
	"cat" text,
	"konto" text,
	"partner_id" uuid,
	"note" text,
	"pay_k" text,
	"liters" numeric(12, 3),
	"file_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_vouchers_kind_chk" CHECK ("cash_vouchers"."kind" in ('in','out'))
);
--> statement-breakpoint
CREATE TABLE "compensations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text DEFAULT 'bi' NOT NULL,
	"date" date NOT NULL,
	"number" text NOT NULL,
	"note" text,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"cur" text NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_rate_pos" CHECK ("fx_rates"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2),
	"recipient" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ref_id" text,
	"printed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_kind_chk" CHECK ("payment_orders"."kind" in ('pp30','pp50','pp10'))
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_register_id_cash_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."cash_registers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_firm_idx" ON "bank_accounts" USING btree ("firm_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_firm_legacy_uq" ON "bank_accounts" USING btree ("firm_id","legacy_id") WHERE "bank_accounts"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "bank_lines_statement_idx" ON "bank_lines" USING btree ("statement_id","line_no");--> statement-breakpoint
CREATE INDEX "bank_lines_firm_date_idx" ON "bank_lines" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "bank_lines_firm_ref_idx" ON "bank_lines" USING btree ("firm_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "bank_lines_firm_dup_idx" ON "bank_lines" USING btree ("firm_id","dup_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_rules_firm_match_uq" ON "bank_rules" USING btree ("firm_id","kind",lower("match"));--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statements_acct_date_uq" ON "bank_statements" USING btree ("bank_account_id","date");--> statement-breakpoint
CREATE INDEX "bank_statements_firm_date_idx" ON "bank_statements" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "cash_registers_firm_idx" ON "cash_registers" USING btree ("firm_id","sort");--> statement-breakpoint
CREATE INDEX "cash_vouchers_firm_date_idx" ON "cash_vouchers" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "cash_vouchers_register_idx" ON "cash_vouchers" USING btree ("register_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_vouchers_number_uq" ON "cash_vouchers" USING btree ("register_id","kind",extract(year from "date"),"number");--> statement-breakpoint
CREATE INDEX "compensations_firm_date_idx" ON "compensations" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "compensations_firm_number_uq" ON "compensations" USING btree ("firm_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_date_cur_uq" ON "fx_rates" USING btree ("date","cur");--> statement-breakpoint
CREATE INDEX "fx_rates_cur_date_idx" ON "fx_rates" USING btree ("cur","date");--> statement-breakpoint
CREATE INDEX "payment_orders_firm_date_idx" ON "payment_orders" USING btree ("firm_id","date");