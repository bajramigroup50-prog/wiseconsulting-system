CREATE TABLE "fee_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_firm_id" uuid NOT NULL,
	"client_firm_id" uuid NOT NULL,
	"period" text NOT NULL,
	"invoice_id" uuid,
	"partner_id" uuid,
	"number" text,
	"date" date NOT NULL,
	"due" date NOT NULL,
	"net" numeric(18, 2) NOT NULL,
	"vat" numeric(18, 2) NOT NULL,
	"gross" numeric(18, 2) NOT NULL,
	"portal_item_id" uuid,
	"mailed_at" timestamp with time zone,
	"reminders" integer DEFAULT 0 NOT NULL,
	"last_reminder" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rokovi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"period" text NOT NULL,
	"due" date NOT NULL,
	"legal_due" date NOT NULL,
	"link" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"note" text,
	"done" boolean DEFAULT false NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"gone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fx_rates" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_office_firm_id_firms_id_fk" FOREIGN KEY ("office_firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_client_firm_id_firms_id_fk" FOREIGN KEY ("client_firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rokovi" ADD CONSTRAINT "rokovi_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rokovi" ADD CONSTRAINT "rokovi_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_client_period_uq" ON "fee_invoices" USING btree ("client_firm_id","period");--> statement-breakpoint
CREATE INDEX "fee_invoices_office_idx" ON "fee_invoices" USING btree ("office_firm_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "rokovi_firm_key_uq" ON "rokovi" USING btree ("firm_id","key");--> statement-breakpoint
CREATE INDEX "rokovi_due_idx" ON "rokovi" USING btree ("due","done");