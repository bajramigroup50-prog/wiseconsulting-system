CREATE TABLE "store_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"location_id" uuid,
	"partner_id" uuid,
	"ref" text,
	"account" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"sales_day_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_outs_kind_chk" CHECK ("store_outs"."kind" in ('sale','ret'))
);
--> statement-breakpoint
ALTER TABLE "store_outs" ADD CONSTRAINT "store_outs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_outs" ADD CONSTRAINT "store_outs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_outs" ADD CONSTRAINT "store_outs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_outs_firm_date_idx" ON "store_outs" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "store_outs_firm_number_uq" ON "store_outs" USING btree ("firm_id","kind","number");