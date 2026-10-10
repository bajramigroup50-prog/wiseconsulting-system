CREATE TABLE "customer_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"plate" text,
	"vin" text,
	"make" text,
	"model" text,
	"year" integer,
	"engine" text,
	"fuel" text,
	"partner_id" uuid,
	"km" integer,
	"note" text,
	"remind_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lon" numeric(9, 6) NOT NULL,
	"acc" integer,
	"spd" integer,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"plate" text,
	"partner_id" uuid NOT NULL,
	"km" integer,
	"complaint" text,
	"work" text,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labour" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"mechanic_id" uuid,
	"next_km" integer,
	"next_date" date,
	"next_note" text,
	"invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_status_chk" CHECK ("work_orders"."status" in ('open','work','done'))
);
--> statement-breakpoint
CREATE TABLE "app_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"user_id" uuid,
	"user_name" text,
	"role" text,
	"firm_ref" text,
	"firm_name" text,
	"view" text,
	"src" text NOT NULL,
	"msg" text NOT NULL,
	"stack" text,
	"digest" text,
	"ver" text,
	"ua" text,
	"fixed" boolean DEFAULT false NOT NULL,
	"fixed_at" timestamp with time zone,
	"fixed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"dir" text NOT NULL,
	"partner_id" uuid,
	"partner_name" text,
	"number" text,
	"date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"rate" numeric(9, 4) DEFAULT '0' NOT NULL,
	"term_date" date,
	"installments" integer DEFAULT 1 NOT NULL,
	"purpose" text,
	"cash" boolean DEFAULT false NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"konto" text,
	"move_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdd_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross" numeric(18, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_positions" ADD CONSTRAINT "travel_positions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_positions" ADD CONSTRAINT "travel_positions_order_id_travel_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."travel_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_id_customer_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."customer_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_mechanic_id_employees_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_errors" ADD CONSTRAINT "app_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_errors" ADD CONSTRAINT "app_errors_fixed_by_users_id_fk" FOREIGN KEY ("fixed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdd_payments" ADD CONSTRAINT "pdd_payments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdd_payments" ADD CONSTRAINT "pdd_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_vehicles_firm_idx" ON "customer_vehicles" USING btree ("firm_id","plate");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_vehicles_plate_uq" ON "customer_vehicles" USING btree ("firm_id",upper("plate")) WHERE "customer_vehicles"."plate" is not null and "customer_vehicles"."plate" <> '';--> statement-breakpoint
CREATE INDEX "travel_positions_order_at_idx" ON "travel_positions" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "travel_positions_firm_idx" ON "travel_positions" USING btree ("firm_id","at");--> statement-breakpoint
CREATE INDEX "work_orders_firm_date_idx" ON "work_orders" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "work_orders_vehicle_idx" ON "work_orders" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_number_uq" ON "work_orders" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "app_errors_at_idx" ON "app_errors" USING btree ("at");--> statement-breakpoint
CREATE INDEX "app_errors_fixed_idx" ON "app_errors" USING btree ("fixed","last_at");--> statement-breakpoint
CREATE INDEX "loans_firm_date_idx" ON "loans" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "pdd_payments_firm_date_idx" ON "pdd_payments" USING btree ("firm_id","date");