CREATE TABLE "law_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"question" text NOT NULL,
	"answer" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "law_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"inst" text NOT NULL,
	"title" text NOT NULL,
	"what" text,
	"who" text,
	"impact" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"date" text,
	"from" text,
	"to" text,
	"urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prog" text,
	"verified" boolean DEFAULT true NOT NULL,
	"rule" jsonb,
	"source" text DEFAULT 'robot' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "law_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"sources" integer DEFAULT 0 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "law_seen" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "law_sources" (
	"url" text PRIMARY KEY NOT NULL,
	"inst" text NOT NULL,
	"name" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "law_asks" ADD CONSTRAINT "law_asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "law_changes" ADD CONSTRAINT "law_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "law_seen" ADD CONSTRAINT "law_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "law_asks_user_idx" ON "law_asks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "law_changes_key_uq" ON "law_changes" USING btree ("key");--> statement-breakpoint
CREATE INDEX "law_changes_date_idx" ON "law_changes" USING btree ("date");