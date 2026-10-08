CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_sq" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_code_digits" CHECK ("accounts"."code" ~ '^[0-9]{2,10}$')
);
--> statement-breakpoint
CREATE TABLE "codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"legacy_id" text,
	"cb" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_supplier_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"partner_id" uuid,
	"code" text NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"code" text,
	"name" text NOT NULL,
	"type" text DEFAULT 'goods' NOT NULL,
	"unit" text,
	"price" numeric(18, 4),
	"vat_rate" integer DEFAULT 18 NOT NULL,
	"revenue_account" text,
	"min_stock" numeric(18, 3),
	"weight" numeric(18, 3),
	"made_in_mk" boolean DEFAULT false NOT NULL,
	"raw_account" text,
	"cost_price" numeric(18, 4),
	"cost_pct" numeric(8, 2),
	"oe" text,
	"cross_refs" text,
	"fits" text,
	"active" boolean DEFAULT true NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_type_chk" CHECK ("items"."type" in ('service','goods','material','product'))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"journal_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account" text NOT NULL,
	"partner_id" uuid,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text,
	"amount_cur" numeric(18, 2),
	"doc" text,
	"note" text,
	"location_id" uuid,
	CONSTRAINT "journal_lines_nonzero" CHECK ("journal_lines"."debit" <> 0 or "journal_lines"."credit" <> 0)
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"description" text,
	"source_type" text,
	"source_id" text,
	"period_from" date,
	"period_to" date,
	"locked" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"code" text,
	"name" text NOT NULL,
	"edb" text,
	"embs" text,
	"address" text,
	"city" text,
	"country" text,
	"email" text,
	"phone" text,
	"contact" text,
	"bank_account" text,
	"bank_name" text,
	"vat_registered" boolean DEFAULT true NOT NULL,
	"foreign" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codes" ADD CONSTRAINT "codes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_supplier_codes" ADD CONSTRAINT "item_supplier_codes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_supplier_codes" ADD CONSTRAINT "item_supplier_codes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_supplier_codes" ADD CONSTRAINT "item_supplier_codes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_global_code_uq" ON "accounts" USING btree ("code") WHERE "accounts"."firm_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_firm_code_uq" ON "accounts" USING btree ("firm_id","code") WHERE "accounts"."firm_id" is not null;--> statement-breakpoint
CREATE INDEX "codes_firm_cb_idx" ON "codes" USING btree ("firm_id","cb");--> statement-breakpoint
CREATE UNIQUE INDEX "codes_global_uq" ON "codes" USING btree ("cb","code") WHERE "codes"."firm_id" is null and "codes"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "item_barcodes_firm_code_uq" ON "item_barcodes" USING btree ("firm_id","barcode");--> statement-breakpoint
CREATE INDEX "item_barcodes_item_idx" ON "item_barcodes" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_supplier_codes_uq" ON "item_supplier_codes" USING btree ("firm_id",coalesce("partner_id", '00000000-0000-0000-0000-000000000000'::uuid),"code");--> statement-breakpoint
CREATE INDEX "item_supplier_codes_item_idx" ON "item_supplier_codes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_firm_name_idx" ON "items" USING btree ("firm_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "items_firm_code_uq" ON "items" USING btree ("firm_id","code") WHERE "items"."code" is not null and "items"."code" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "items_firm_legacy_uq" ON "items" USING btree ("firm_id","legacy_id") WHERE "items"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_lines_journal_idx" ON "journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "journal_lines_firm_account_idx" ON "journal_lines" USING btree ("firm_id","account");--> statement-breakpoint
CREATE INDEX "journal_lines_firm_partner_idx" ON "journal_lines" USING btree ("firm_id","partner_id");--> statement-breakpoint
CREATE INDEX "journals_firm_date_idx" ON "journals" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "journals_firm_number_idx" ON "journals" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "journals_firm_kind_idx" ON "journals" USING btree ("firm_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_source_uq" ON "journals" USING btree ("firm_id","source_type","source_id") WHERE "journals"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "partners_firm_name_idx" ON "partners" USING btree ("firm_id","name");--> statement-breakpoint
CREATE INDEX "partners_firm_edb_idx" ON "partners" USING btree ("firm_id","edb");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_firm_code_uq" ON "partners" USING btree ("firm_id","code") WHERE "partners"."code" is not null and "partners"."code" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "partners_firm_legacy_uq" ON "partners" USING btree ("firm_id","legacy_id") WHERE "partners"."legacy_id" is not null;