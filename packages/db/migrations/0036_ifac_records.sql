CREATE TABLE "ifac_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"subject" uuid NOT NULL,
	"firm_id" uuid,
	"user_id" uuid,
	"no" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ifac_records" ADD CONSTRAINT "ifac_records_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ifac_records" ADD CONSTRAINT "ifac_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ifac_records" ADD CONSTRAINT "ifac_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ifac_records_key_uq" ON "ifac_records" USING btree ("kind","year","subject");--> statement-breakpoint
CREATE INDEX "ifac_records_firm_idx" ON "ifac_records" USING btree ("firm_id");