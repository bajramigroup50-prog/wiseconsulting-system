CREATE TABLE "wa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"phone" text NOT NULL,
	"name" text,
	"dir" text NOT NULL,
	"wa_id" text,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text,
	"file_id" uuid,
	"file_name" text,
	"incoming_doc_id" uuid,
	"template" text,
	"purpose" text,
	"status" text NOT NULL,
	"error" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_wa_id_uq" ON "wa_messages" USING btree ("wa_id");--> statement-breakpoint
CREATE INDEX "wa_messages_firm_idx" ON "wa_messages" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_phone_idx" ON "wa_messages" USING btree ("phone","created_at");