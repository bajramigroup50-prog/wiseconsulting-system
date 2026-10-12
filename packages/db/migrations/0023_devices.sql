CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"firm_id" uuid,
	"no" integer NOT NULL,
	"serial" text NOT NULL,
	"fingerprint" text NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"bundle" text,
	"downloads" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_seen_ip" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "devices_status_chk" CHECK ("devices"."status" in ('active','revoked'))
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_fingerprint_uq" ON "devices" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_serial_uq" ON "devices" USING btree ("serial");--> statement-breakpoint
CREATE INDEX "devices_firm_idx" ON "devices" USING btree ("firm_id");