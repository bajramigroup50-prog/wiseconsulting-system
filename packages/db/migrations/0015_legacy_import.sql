CREATE TABLE "legacy_id_map" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"firm_id" uuid,
	"kind" text NOT NULL,
	"legacy_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{"done":0,"total":0}'::jsonb NOT NULL,
	"report" jsonb,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "legacy_import_runs_status_chk" CHECK ("legacy_import_runs"."status" in ('queued','running','done','failed'))
);
--> statement-breakpoint
ALTER TABLE "legacy_id_map" ADD CONSTRAINT "legacy_id_map_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_id_map" ADD CONSTRAINT "legacy_id_map_run_id_legacy_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."legacy_import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_runs" ADD CONSTRAINT "legacy_import_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_id_map_uq" ON "legacy_id_map" USING btree (coalesce("firm_id", '00000000-0000-0000-0000-000000000000'::uuid),"kind","legacy_id");--> statement-breakpoint
CREATE INDEX "legacy_id_map_entity_idx" ON "legacy_id_map" USING btree ("kind","entity_id");--> statement-breakpoint
CREATE INDEX "legacy_import_runs_created_idx" ON "legacy_import_runs" USING btree ("created_at");