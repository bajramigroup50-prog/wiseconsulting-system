CREATE TABLE "doc_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"no" integer NOT NULL,
	"firm_id" uuid NOT NULL,
	"period" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brought_by" text,
	"received_by" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"keep_until" date,
	"return_due" date,
	"returned_at" timestamp with time zone,
	"returned_by" uuid,
	"returned_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_receipts" ADD CONSTRAINT "doc_receipts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_receipts" ADD CONSTRAINT "doc_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_receipts" ADD CONSTRAINT "doc_receipts_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_receipts_year_no_uq" ON "doc_receipts" USING btree ("year","no");--> statement-breakpoint
CREATE INDEX "doc_receipts_firm_idx" ON "doc_receipts" USING btree ("firm_id","received_at");