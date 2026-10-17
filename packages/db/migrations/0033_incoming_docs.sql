CREATE TABLE "incoming_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"file_id" uuid NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"how" text,
	"what" text,
	"status" text DEFAULT 'unread' NOT NULL,
	"route" text,
	"route_ref" text,
	"result" text,
	"detect" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_doc_id" uuid,
	"created_by" uuid,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incoming_docs" ADD CONSTRAINT "incoming_docs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_docs" ADD CONSTRAINT "incoming_docs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_docs" ADD CONSTRAINT "incoming_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_docs" ADD CONSTRAINT "incoming_docs_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incoming_docs_firm_idx" ON "incoming_docs" USING btree ("firm_id","status","created_at");--> statement-breakpoint
CREATE INDEX "incoming_docs_file_idx" ON "incoming_docs" USING btree ("file_id");