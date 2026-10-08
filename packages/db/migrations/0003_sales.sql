CREATE TABLE "invoice_advances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"advance_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"unit" text,
	"qty" numeric(18, 4) NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"disc" numeric(8, 4) DEFAULT '0' NOT NULL,
	"rate" integer NOT NULL,
	"account" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"pdate" date,
	"due" date,
	"partner_id" uuid,
	"warehouse_id" uuid,
	"art32" boolean DEFAULT false NOT NULL,
	"advance" boolean DEFAULT false NOT NULL,
	"export" boolean DEFAULT false NOT NULL,
	"svc" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'MKD' NOT NULL,
	"fx" numeric(18, 6) DEFAULT '1' NOT NULL,
	"ref_invoice_id" uuid,
	"credit_kind" text,
	"credit_gross" numeric(18, 2),
	"from_doc_id" uuid,
	"invoiced_id" uuid,
	"note" text,
	"base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"scanned" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_kind_chk" CHECK ("invoices"."kind" in ('invoice','credit','proforma','dispatch')),
	CONSTRAINT "invoices_status_chk" CHECK ("invoices"."status" in ('draft','posted','pending'))
);
--> statement-breakpoint
CREATE TABLE "purchase_costs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"fx" numeric(18, 6),
	"doc" text,
	"date" date,
	"due" date,
	"partner_id" uuid,
	"by_qty" boolean DEFAULT false NOT NULL,
	"foreign" boolean DEFAULT false NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_stock_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text,
	"code" text,
	"barcode" text,
	"qty" numeric(18, 4) NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"rab" numeric(8, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2),
	"cn" integer,
	"dep" numeric(18, 2),
	"cvat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sp" numeric(18, 4),
	"value" numeric(18, 2) NOT NULL,
	"type" text
);
--> statement-breakpoint
CREATE TABLE "purchase_vat_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account" text NOT NULL,
	"rate" integer NOT NULL,
	"base" numeric(18, 2) NOT NULL,
	"vat" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"doc_date" date,
	"due" date,
	"partner_id" uuid,
	"supplier_name" text,
	"supplier_edb" text,
	"ptype" text DEFAULT 'cost' NOT NULL,
	"art32" boolean DEFAULT false NOT NULL,
	"imp" boolean DEFAULT false NOT NULL,
	"cash" boolean DEFAULT false NOT NULL,
	"no_ded" boolean DEFAULT false NOT NULL,
	"warehouse_id" uuid,
	"supplier_account" text,
	"currency" text DEFAULT 'MKD' NOT NULL,
	"fx" numeric(18, 6) DEFAULT '1' NOT NULL,
	"calc_no" text,
	"dist_mode" text DEFAULT 'val' NOT NULL,
	"cnames" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"scanned" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_status_chk" CHECK ("purchases"."status" in ('draft','posted','pending'))
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"date" date NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"direction" text NOT NULL,
	"move_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"line_no" integer DEFAULT 0 NOT NULL,
	"label" text,
	"pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_moves_direction_chk" CHECK ("stock_moves"."direction" in ('in','out'))
);
--> statement-breakpoint
CREATE TABLE "supplier_credit_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"credit_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"rate" integer NOT NULL,
	"account" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"legacy_id" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"sup_no" text,
	"partner_id" uuid NOT NULL,
	"ref_purchase_id" uuid,
	"warehouse_id" uuid,
	"note" text,
	"base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"scanned" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"batch_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"drafts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"model" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"firm_id" uuid,
	"user_id" uuid,
	"purpose" text NOT NULL,
	"tier" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"ref_id" text
);
--> statement-breakpoint
ALTER TABLE "invoice_advances" ADD CONSTRAINT "invoice_advances_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_advances" ADD CONSTRAINT "invoice_advances_advance_id_invoices_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_warehouse_id_codes_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_ref_invoice_id_invoices_id_fk" FOREIGN KEY ("ref_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_doc_id_invoices_id_fk" FOREIGN KEY ("from_doc_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_invoiced_id_invoices_id_fk" FOREIGN KEY ("invoiced_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_costs" ADD CONSTRAINT "purchase_costs_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_costs" ADD CONSTRAINT "purchase_costs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_stock_lines" ADD CONSTRAINT "purchase_stock_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_stock_lines" ADD CONSTRAINT "purchase_stock_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_vat_groups" ADD CONSTRAINT "purchase_vat_groups_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouse_id_codes_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_warehouse_id_codes_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_lines" ADD CONSTRAINT "supplier_credit_lines_credit_id_supplier_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."supplier_credits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_lines" ADD CONSTRAINT "supplier_credit_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_ref_purchase_id_purchases_id_fk" FOREIGN KEY ("ref_purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_warehouse_id_codes_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_documents" ADD CONSTRAINT "ai_documents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_documents" ADD CONSTRAINT "ai_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_documents" ADD CONSTRAINT "ai_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_advances_uq" ON "invoice_advances" USING btree ("invoice_id","advance_id");--> statement-breakpoint
CREATE INDEX "invoice_advances_adv_idx" ON "invoice_advances" USING btree ("advance_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_item_idx" ON "invoice_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "invoices_firm_date_idx" ON "invoices" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "invoices_firm_kind_idx" ON "invoices" USING btree ("firm_id","kind");--> statement-breakpoint
CREATE INDEX "invoices_ref_idx" ON "invoices" USING btree ("ref_invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_partner_idx" ON "invoices" USING btree ("firm_id","partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("firm_id","kind",(extract(year from "date")),"number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_costs_slot_uq" ON "purchase_costs" USING btree ("purchase_id","slot");--> statement-breakpoint
CREATE INDEX "purchase_stock_lines_pur_idx" ON "purchase_stock_lines" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_stock_lines_item_idx" ON "purchase_stock_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "purchase_vat_groups_pur_idx" ON "purchase_vat_groups" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchases_firm_date_idx" ON "purchases" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "purchases_partner_idx" ON "purchases" USING btree ("firm_id","partner_id");--> statement-breakpoint
CREATE INDEX "stock_moves_firm_item_date_idx" ON "stock_moves" USING btree ("firm_id","item_id","date");--> statement-breakpoint
CREATE INDEX "stock_moves_source_idx" ON "stock_moves" USING btree ("firm_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "supplier_credit_lines_credit_idx" ON "supplier_credit_lines" USING btree ("credit_id");--> statement-breakpoint
CREATE INDEX "supplier_credits_firm_date_idx" ON "supplier_credits" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_credits_number_uq" ON "supplier_credits" USING btree ("firm_id",(extract(year from "date")),"number");--> statement-breakpoint
CREATE INDEX "ai_documents_firm_created_idx" ON "ai_documents" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_documents_batch_idx" ON "ai_documents" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ai_usage_firm_at_idx" ON "ai_usage" USING btree ("firm_id","at");