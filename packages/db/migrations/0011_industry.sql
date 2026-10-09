CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time" text NOT NULL,
	"dur" integer DEFAULT 30 NOT NULL,
	"res" text NOT NULL,
	"partner_id" uuid,
	"client" text,
	"phone" text,
	"email" text,
	"svc" text,
	"item_id" uuid,
	"price" numeric(18, 2),
	"status" text DEFAULT 'booked' NOT NULL,
	"note" text,
	"remind_at" timestamp with time zone,
	"invoice_id" uuid,
	"sales_day_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_cost_links" (
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "construction_cost_links_source_type_source_id_pk" PRIMARY KEY("source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "construction_diary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"weather" text,
	"temp" text,
	"works" text,
	"mat" text,
	"issues" text,
	"nadzor" text,
	"workers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mach" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"site" text,
	"city" text,
	"investor_id" uuid NOT NULL,
	"cno" text,
	"cdate" date,
	"start" date,
	"end" date,
	"nadzor" text,
	"eng" text,
	"art32" boolean DEFAULT false NOT NULL,
	"boq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_situations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"no" text NOT NULL,
	"kind" text DEFAULT 'int' NOT NULL,
	"date" date NOT NULL,
	"from" date,
	"to" date,
	"cum" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"asset_id" uuid,
	"plate" text NOT NULL,
	"name" text,
	"trailer" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"rent" boolean DEFAULT false NOT NULL,
	"r_class" text,
	"r_day" numeric(18, 2),
	"r_week" numeric(18, 2),
	"r_dep" numeric(18, 2),
	"r_km" integer,
	"r_km_x" numeric(18, 2),
	"odo" integer,
	"fuel_norm" numeric(8, 2),
	"cap_kg" integer,
	"oil_every" integer,
	"oil_last_km" integer,
	"tyre_every" integer,
	"tyre_last_km" integer,
	"reg_exp" date,
	"ins_exp" date,
	"tech_exp" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'plan' NOT NULL,
	"partner_id" uuid,
	"order_no" text,
	"km" integer,
	"vehicle_id" uuid,
	"trailer" text,
	"driver_id" uuid,
	"driver2_id" uuid,
	"load_place" text,
	"load_c" text,
	"sender" text,
	"unload_date" date,
	"unload_place" text,
	"unload_c" text,
	"consignee" text,
	"ret_date" date,
	"goods" text,
	"packages" text,
	"kg" numeric(12, 2),
	"m3" numeric(12, 2),
	"adr" text,
	"docs_att" text,
	"price" numeric(18, 2),
	"cur" text DEFAULT 'EUR' NOT NULL,
	"fx" numeric(18, 6),
	"vat" text DEFAULT 'intl' NOT NULL,
	"red" integer DEFAULT 100 NOT NULL,
	"tolls" numeric(18, 2),
	"toll_cur" text,
	"other_cost" numeric(18, 2),
	"note" text,
	"segs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotel_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"room_id" uuid NOT NULL,
	"from" date NOT NULL,
	"to" date NOT NULL,
	"guest_name" text NOT NULL,
	"phone" text,
	"email" text,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"board" text DEFAULT 'BB' NOT NULL,
	"partner_id" uuid,
	"src" text,
	"advance" numeric(18, 2),
	"guests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"charges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'resv' NOT NULL,
	"note" text,
	"no_tax" boolean DEFAULT false NOT NULL,
	"in_at" timestamp with time zone,
	"out_at" timestamp with time zone,
	"folio_at" timestamp with time zone,
	"invoice_id" uuid,
	"advance_invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotel_res_dates_chk" CHECK ("hotel_reservations"."to" > "hotel_reservations"."from"),
	CONSTRAINT "hotel_res_status_chk" CHECK ("hotel_reservations"."status" in ('resv','in','out','noshow','cancel'))
);
--> statement-breakpoint
CREATE TABLE "hotel_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"no" text NOT NULL,
	"kind" text,
	"beds" integer DEFAULT 2 NOT NULL,
	"floor" text,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"hk" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_rentals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"driver" jsonb DEFAULT '{"name":""}'::jsonb NOT NULL,
	"driver2" text,
	"partner_id" uuid,
	"deposit" numeric(18, 2),
	"extras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'resv' NOT NULL,
	"note" text,
	"out" jsonb DEFAULT '{"fuel":8}'::jsonb NOT NULL,
	"ret" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"p_day" numeric(18, 2),
	"price_tot" numeric(18, 2),
	"countries" jsonb DEFAULT '["MK"]'::jsonb NOT NULL,
	"green" boolean DEFAULT false NOT NULL,
	"invoice_id" uuid,
	"deposit_voucher_id" uuid,
	"deposit_partner_id" uuid,
	"deposit_kept" numeric(18, 2),
	"deposit_return_voucher_id" uuid,
	"deposit_closed" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_rentals_status_chk" CHECK ("rent_rentals"."status" in ('resv','out','ret','cancel'))
);
--> statement-breakpoint
CREATE TABLE "travel_arrangements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"dest" text,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from" date,
	"to" date,
	"kind" text DEFAULT 'own' NOT NULL,
	"seats" integer,
	"price" numeric(18, 2),
	"price_ch" numeric(18, 2),
	"comm" numeric(6, 2),
	"prog" text,
	"incl" text,
	"excl" text,
	"costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_arr_kind_chk" CHECK ("travel_arrangements"."kind" in ('own','agent'))
);
--> statement-breakpoint
CREATE TABLE "travel_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"client" jsonb NOT NULL,
	"partner_id" uuid,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"extra" numeric(18, 2),
	"disc" numeric(18, 2),
	"price_tot" numeric(18, 2),
	"pax" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"room" text,
	"note" text,
	"status" text DEFAULT 'resv' NOT NULL,
	"pay_partner_id" uuid,
	"invoice_id" uuid,
	"advance_settled" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"vehicle_id" uuid,
	"plate" text,
	"vname" text,
	"driver_id" uuid,
	"driver" text,
	"codriver" text,
	"from" text,
	"purpose" text,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dep_km" integer,
	"ret_km" integer,
	"fuel_l" numeric(10, 2),
	"fuel_amt" numeric(18, 2),
	"assignee_id" uuid,
	"dnev" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_orders_status_chk" CHECK ("travel_orders"."status" in ('open','onroad','done'))
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_cost_links" ADD CONSTRAINT "construction_cost_links_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_cost_links" ADD CONSTRAINT "construction_cost_links_project_id_construction_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."construction_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_diary" ADD CONSTRAINT "construction_diary_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_diary" ADD CONSTRAINT "construction_diary_project_id_construction_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."construction_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_investor_id_partners_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_situations" ADD CONSTRAINT "construction_situations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_situations" ADD CONSTRAINT "construction_situations_project_id_construction_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."construction_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_situations" ADD CONSTRAINT "construction_situations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_tours" ADD CONSTRAINT "freight_tours_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_tours" ADD CONSTRAINT "freight_tours_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_tours" ADD CONSTRAINT "freight_tours_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_tours" ADD CONSTRAINT "freight_tours_driver_id_employees_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_tours" ADD CONSTRAINT "freight_tours_driver2_id_employees_id_fk" FOREIGN KEY ("driver2_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_tours" ADD CONSTRAINT "freight_tours_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_room_id_hotel_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."hotel_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_advance_invoice_id_invoices_id_fk" FOREIGN KEY ("advance_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_reservations" ADD CONSTRAINT "hotel_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_deposit_voucher_id_cash_vouchers_id_fk" FOREIGN KEY ("deposit_voucher_id") REFERENCES "public"."cash_vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_deposit_partner_id_partners_id_fk" FOREIGN KEY ("deposit_partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_deposit_return_voucher_id_cash_vouchers_id_fk" FOREIGN KEY ("deposit_return_voucher_id") REFERENCES "public"."cash_vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rentals" ADD CONSTRAINT "rent_rentals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_arrangements" ADD CONSTRAINT "travel_arrangements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_arrangement_id_travel_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."travel_arrangements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_pay_partner_id_partners_id_fk" FOREIGN KEY ("pay_partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_driver_id_employees_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_orders" ADD CONSTRAINT "travel_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_firm_date_idx" ON "appointments" USING btree ("firm_id","date","res");--> statement-breakpoint
CREATE INDEX "construction_cost_project_idx" ON "construction_cost_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "construction_diary_project_idx" ON "construction_diary" USING btree ("project_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "construction_projects_code_uq" ON "construction_projects" USING btree ("firm_id","code");--> statement-breakpoint
CREATE INDEX "construction_sit_project_idx" ON "construction_situations" USING btree ("project_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "construction_sit_no_uq" ON "construction_situations" USING btree ("project_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_vehicles_plate_uq" ON "fleet_vehicles" USING btree ("firm_id",upper("plate"));--> statement-breakpoint
CREATE INDEX "freight_tours_firm_date_idx" ON "freight_tours" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "freight_tours_number_uq" ON "freight_tours" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "hotel_res_firm_from_idx" ON "hotel_reservations" USING btree ("firm_id","from");--> statement-breakpoint
CREATE INDEX "hotel_res_room_idx" ON "hotel_reservations" USING btree ("room_id","from");--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_res_number_uq" ON "hotel_reservations" USING btree ("firm_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_rooms_no_uq" ON "hotel_rooms" USING btree ("firm_id","no");--> statement-breakpoint
CREATE INDEX "rent_rentals_vehicle_idx" ON "rent_rentals" USING btree ("vehicle_id","from");--> statement-breakpoint
CREATE UNIQUE INDEX "rent_rentals_number_uq" ON "rent_rentals" USING btree ("firm_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_arr_code_uq" ON "travel_arrangements" USING btree ("firm_id","code");--> statement-breakpoint
CREATE INDEX "travel_bookings_arr_idx" ON "travel_bookings" USING btree ("arrangement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_bookings_number_uq" ON "travel_bookings" USING btree ("firm_id","number");--> statement-breakpoint
CREATE INDEX "travel_orders_firm_date_idx" ON "travel_orders" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_orders_number_uq" ON "travel_orders" USING btree ("firm_id",extract(year from "date"),"number");