CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"partner_id" uuid,
	"partner_name" text,
	"number" text,
	"date" date NOT NULL,
	"place" text,
	"amount" numeric(18, 2) NOT NULL,
	"in_kind" boolean DEFAULT false NOT NULL,
	"in_kind_desc" text,
	"purpose" text,
	"area" text,
	"counter" text,
	"term_date" date,
	"cash" boolean DEFAULT false NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"konto" text,
	"move_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conf_number" text,
	"conf_date" date,
	"conf_amount" numeric(18, 2),
	"conf_note" text,
	"journal_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "donations_firm_date_idx" ON "donations" USING btree ("firm_id","date");