CREATE TABLE "donation_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"donation_id" uuid,
	"partner_id" uuid,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"location_id" uuid,
	"account" text,
	"note" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npo_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"embg" text,
	"address" text,
	"phone" text,
	"email" text,
	"joined" date,
	"left" date,
	"organ" text,
	"role" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_lots" DROP CONSTRAINT "stock_lots_source_chk";--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "fulfilled_date" date;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "ids_filed" date;--> statement-breakpoint
ALTER TABLE "meal_beneficiaries" ADD COLUMN "consent_date" date;--> statement-breakpoint
ALTER TABLE "donation_receipts" ADD CONSTRAINT "donation_receipts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_receipts" ADD CONSTRAINT "donation_receipts_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_receipts" ADD CONSTRAINT "donation_receipts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_receipts" ADD CONSTRAINT "donation_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npo_members" ADD CONSTRAINT "npo_members_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "don_receipts_firm_idx" ON "donation_receipts" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "don_receipts_don_idx" ON "donation_receipts" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "npo_members_firm_idx" ON "npo_members" USING btree ("firm_id","name");--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_source_chk" CHECK ("stock_lots"."source_type" in ('purchase','production','don_receipt'));