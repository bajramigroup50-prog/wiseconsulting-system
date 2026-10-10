CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text DEFAULT 'pct' NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"min_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_kind_chk" CHECK ("coupons"."kind" in ('pct','amt'))
);
--> statement-breakpoint
CREATE TABLE "customer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"partner_id" uuid,
	"delivery_date" date,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_orders_status_chk" CHECK ("customer_orders"."status" in ('open','cancel'))
);
--> statement-breakpoint
CREATE TABLE "loyalty_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"discount" numeric(6, 2) DEFAULT '0' NOT NULL,
	"points" numeric(18, 2) DEFAULT '0' NOT NULL,
	"spent" numeric(18, 2) DEFAULT '0' NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"last_visit" date,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"location_id" uuid,
	"date" date NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"pct" numeric(6, 2),
	"rounding" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'plan' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"levelling_start_id" uuid,
	"levelling_end_id" uuid,
	"started_on" date,
	"ended_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_status_chk" CHECK ("promotions"."status" in ('plan','active','done'))
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"line_no" integer DEFAULT 0 NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"lot" text,
	"expiry" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_source_chk" CHECK ("stock_lots"."source_type" in ('purchase','production'))
);
--> statement-breakpoint
CREATE TABLE "supplier_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"partner_id" uuid,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text,
	"received_at" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_orders_status_chk" CHECK ("supplier_orders"."status" in ('open','recv','cancel'))
);
--> statement-breakpoint
CREATE TABLE "writeoff_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"date" date NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"mode" text NOT NULL,
	"pct" numeric(6, 2),
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"location_id" uuid,
	"product_id" uuid,
	"product_qty" numeric(18, 4),
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writeoff_docs_mode_chk" CHECK ("writeoff_docs"."mode" in ('popis','pct'))
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_cards" ADD CONSTRAINT "loyalty_cards_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeoff_docs" ADD CONSTRAINT "writeoff_docs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeoff_docs" ADD CONSTRAINT "writeoff_docs_location_id_codes_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeoff_docs" ADD CONSTRAINT "writeoff_docs_product_id_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeoff_docs" ADD CONSTRAINT "writeoff_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_firm_code_uq" ON "coupons" USING btree ("firm_id","code");--> statement-breakpoint
CREATE INDEX "customer_orders_firm_date_idx" ON "customer_orders" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_orders_firm_number_uq" ON "customer_orders" USING btree ("firm_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_cards_firm_number_uq" ON "loyalty_cards" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "promotions_firm_from_idx" ON "promotions" USING btree ("firm_id","date_from");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_firm_number_uq" ON "promotions" USING btree ("firm_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_source_uq" ON "stock_lots" USING btree ("firm_id","source_type","source_id","line_no");--> statement-breakpoint
CREATE INDEX "stock_lots_item_idx" ON "stock_lots" USING btree ("firm_id","item_id");--> statement-breakpoint
CREATE INDEX "supplier_orders_firm_date_idx" ON "supplier_orders" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_orders_firm_number_uq" ON "supplier_orders" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "writeoff_docs_firm_date_idx" ON "writeoff_docs" USING btree ("firm_id","date");