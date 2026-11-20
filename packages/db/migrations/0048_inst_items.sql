CREATE TABLE "inst_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"inst" text NOT NULL,
	"inst_name" text,
	"type" text NOT NULL,
	"ref_no" text,
	"doc_date" date,
	"received" date,
	"due" date,
	"subject" text,
	"amount" numeric(18, 2),
	"pay_recip" text,
	"pay_account" text,
	"pay_upl_sm" text,
	"pay_prihod" text,
	"pay_ref" text,
	"pay_purpose" text,
	"status" text DEFAULT 'new' NOT NULL,
	"assignee_id" uuid,
	"note" text,
	"paid_on" date,
	"paid_note" text,
	"bank_line_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"incoming_id" uuid,
	"kontrola_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inst_items_status_chk" CHECK ("inst_items"."status" in ('new','work','answered','paid','closed'))
);
--> statement-breakpoint
ALTER TABLE "inst_items" ADD CONSTRAINT "inst_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inst_items" ADD CONSTRAINT "inst_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inst_items" ADD CONSTRAINT "inst_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inst_items" ADD CONSTRAINT "inst_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inst_items_firm_idx" ON "inst_items" USING btree ("firm_id","status","due");--> statement-breakpoint
CREATE INDEX "inst_items_due_idx" ON "inst_items" USING btree ("due");