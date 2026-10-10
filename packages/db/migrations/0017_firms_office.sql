CREATE TABLE "dunning_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"partner_id" uuid,
	"partner_name" text,
	"invoice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"level" integer NOT NULL,
	"channel" text NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"date" date NOT NULL,
	"mail_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dunning_level_chk" CHECK ("dunning_letters"."level" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "firm_resh_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_ids" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"model" text,
	"firm_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" text,
	"inst" text NOT NULL,
	"name" text NOT NULL,
	"recipient" text,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dunning_letters" ADD CONSTRAINT "dunning_letters_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_letters" ADD CONSTRAINT "dunning_letters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_resh_reads" ADD CONSTRAINT "firm_resh_reads_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_resh_reads" ADD CONSTRAINT "firm_resh_reads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_templates" ADD CONSTRAINT "request_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dunning_firm_partner_idx" ON "dunning_letters" USING btree ("firm_id","partner_id");--> statement-breakpoint
CREATE INDEX "firm_resh_reads_created_idx" ON "firm_resh_reads" USING btree ("created_by","created_at");