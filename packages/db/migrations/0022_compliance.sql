CREATE TABLE "kontrola_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kontrola_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"finding_id" uuid,
	"text" text NOT NULL,
	"owner_id" uuid,
	"owner_name" text,
	"due" date,
	"done_on" date,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kontrola_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kontrola_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"no" integer NOT NULL,
	"area" text DEFAULT 'other' NOT NULL,
	"text" text NOT NULL,
	"article" text,
	"claimed" numeric(18, 2) DEFAULT '0' NOT NULL,
	"interest" numeric(18, 2) DEFAULT '0' NOT NULL,
	"fine" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ours" numeric(18, 2),
	"ours_source" text,
	"account" text,
	"verdict" text,
	"office_ok" boolean,
	"system_error" boolean,
	"analysis" text,
	"recommendation" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontrola_findings_verdict_chk" CHECK ("kontrola_findings"."verdict" is null or "kontrola_findings"."verdict" in ('correct','partly','incorrect','unclear')),
	CONSTRAINT "kontrola_findings_rec_chk" CHECK ("kontrola_findings"."recommendation" is null or "kontrola_findings"."recommendation" in ('accept','object','partial','review'))
);
--> statement-breakpoint
CREATE TABLE "kontroli" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"auth" text NOT NULL,
	"doc" text NOT NULL,
	"doc_no" text,
	"doc_date" date,
	"delivered" date,
	"due_override" date,
	"period_from" date,
	"period_to" date,
	"subject" text,
	"status" text DEFAULT 'record' NOT NULL,
	"filed_on" date,
	"client_visible" boolean DEFAULT false NOT NULL,
	"ai_doc_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontroli_auth_chk" CHECK ("kontroli"."auth" in ('ujp','dpi','dit','ufr','carina','dzlp','other')),
	CONSTRAINT "kontroli_doc_chk" CHECK ("kontroli"."doc" in ('zapisnik','reshenie','vtor','platen','zakl')),
	CONSTRAINT "kontroli_status_chk" CHECK ("kontroli"."status" in ('open','record','decision','objected','appeal','closed'))
);
--> statement-breakpoint
ALTER TABLE "kontrola_actions" ADD CONSTRAINT "kontrola_actions_kontrola_id_kontroli_id_fk" FOREIGN KEY ("kontrola_id") REFERENCES "public"."kontroli"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontrola_actions" ADD CONSTRAINT "kontrola_actions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontrola_actions" ADD CONSTRAINT "kontrola_actions_finding_id_kontrola_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."kontrola_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontrola_actions" ADD CONSTRAINT "kontrola_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontrola_actions" ADD CONSTRAINT "kontrola_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontrola_findings" ADD CONSTRAINT "kontrola_findings_kontrola_id_kontroli_id_fk" FOREIGN KEY ("kontrola_id") REFERENCES "public"."kontroli"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontrola_findings" ADD CONSTRAINT "kontrola_findings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontroli" ADD CONSTRAINT "kontroli_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontroli" ADD CONSTRAINT "kontroli_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontroli" ADD CONSTRAINT "kontroli_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kontrola_actions_k_idx" ON "kontrola_actions" USING btree ("kontrola_id");--> statement-breakpoint
CREATE INDEX "kontrola_actions_due_idx" ON "kontrola_actions" USING btree ("firm_id","due");--> statement-breakpoint
CREATE INDEX "kontrola_findings_k_idx" ON "kontrola_findings" USING btree ("kontrola_id","no");--> statement-breakpoint
CREATE INDEX "kontroli_firm_idx" ON "kontroli" USING btree ("firm_id","doc_date");--> statement-breakpoint
-- custom SQL from src/schema/compliance.sql (audit_log append-only)
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id = OLD.id AND NEW.at = OLD.at AND NEW.action = OLD.action
       AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
       AND NEW.data IS NOT DISTINCT FROM OLD.data
       AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id OR NEW.user_id IS NULL)
       AND (NEW.firm_id IS NOT DISTINCT FROM OLD.firm_id OR NEW.firm_id IS NULL) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP
    USING ERRCODE = '42501', HINT = 'Дневникот на активности не смее да се менува ниту брише.';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
