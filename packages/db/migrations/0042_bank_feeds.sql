CREATE TABLE "bank_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bank" text DEFAULT '' NOT NULL,
	"method" text DEFAULT 'sftp' NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"port" integer,
	"username" text DEFAULT '' NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"pattern" text DEFAULT '' NOT NULL,
	"secret" text,
	"hold" boolean DEFAULT true NOT NULL,
	"at" text DEFAULT '20:00' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_ok" boolean,
	"last_result" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;