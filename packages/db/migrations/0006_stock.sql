CREATE TABLE "boms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"labor" numeric(18, 2) DEFAULT '0' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "levelling_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"location_id" uuid,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"promo_to" date,
	"promo_back_of" text,
	"legacy_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"location_id" uuid,
	"mat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"lab" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4),
	"bom" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"legacy_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text DEFAULT 'fisk' NOT NULL,
	"date" date NOT NULL,
	"location_id" uuid,
	"number" text,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"card" numeric(18, 2) DEFAULT '0' NOT NULL,
	"card_account" text,
	"count" integer DEFAULT 0 NOT NULL,
	"mk" jsonb,
	"days" jsonb,
	"fisk" jsonb,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"pending" boolean DEFAULT false NOT NULL,
	"legacy_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_daily_kind_chk" CHECK ("sales_daily"."kind" in ('pos','fisk'))
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text DEFAULT 'count' NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"location_id" uuid,
	"shortage_account" text NOT NULL,
	"surplus_account" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"legacy_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_kind_chk" CHECK ("stock_counts"."kind" in ('count','writeoff'))
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid,
	"date" date NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"price" numeric(18, 4),
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_line" integer DEFAULT 0 NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"lot" text,
	"expiry" date,
	"label" text,
	"partner_id" uuid,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legacy_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_moves_direction_chk" CHECK (("stock_moves"."direction" = 'in' and "stock_moves"."qty" >= 0) or ("stock_moves"."direction" = 'out' and "stock_moves"."qty" <= 0)),
	CONSTRAINT "stock_moves_kind_chk" CHECK ("stock_moves"."kind" in ('in','sale','transfer','transfer-in','prod-out','prod-in','mat-out','return','writeoff','popis','popis-in','supret','dispatch','use','opening'))
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"legacy_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_distinct_chk" CHECK (coalesce("transfers"."from_location_id"::text, 'main') <> coalesce("transfers"."to_location_id"::text, 'main'))
);
--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levelling_docs" ADD CONSTRAINT "levelling_docs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levelling_docs" ADD CONSTRAINT "levelling_docs_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levelling_docs" ADD CONSTRAINT "levelling_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_daily" ADD CONSTRAINT "sales_daily_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_daily" ADD CONSTRAINT "sales_daily_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_daily" ADD CONSTRAINT "sales_daily_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_location_id_codes_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_location_id_codes_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boms_product_uq" ON "boms" USING btree ("firm_id","product_id");--> statement-breakpoint
CREATE INDEX "levelling_docs_firm_date_idx" ON "levelling_docs" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "levelling_docs_firm_number_uq" ON "levelling_docs" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "production_orders_firm_date_idx" ON "production_orders" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "production_orders_firm_number_uq" ON "production_orders" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "sales_daily_firm_date_idx" ON "sales_daily" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_daily_pos_day_uq" ON "sales_daily" USING btree ("firm_id",coalesce("location_id"::text, 'main'),"date") WHERE "sales_daily"."kind" = 'pos';--> statement-breakpoint
CREATE INDEX "stock_counts_firm_date_idx" ON "stock_counts" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_firm_number_uq" ON "stock_counts" USING btree ("firm_id","kind","number");--> statement-breakpoint
CREATE INDEX "stock_moves_firm_item_date_idx" ON "stock_moves" USING btree ("firm_id","item_id","date");--> statement-breakpoint
CREATE INDEX "stock_moves_firm_loc_item_idx" ON "stock_moves" USING btree ("firm_id","location_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_moves_firm_date_idx" ON "stock_moves" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "stock_moves_source_idx" ON "stock_moves" USING btree ("firm_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_moves_firm_legacy_uq" ON "stock_moves" USING btree ("firm_id","legacy_id") WHERE "stock_moves"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "transfers_firm_date_idx" ON "transfers" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_firm_number_uq" ON "transfers" USING btree ("firm_id","number");