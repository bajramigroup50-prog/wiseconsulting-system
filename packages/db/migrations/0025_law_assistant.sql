CREATE TABLE "law_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text_id" uuid NOT NULL,
	"law" text NOT NULL,
	"no" text NOT NULL,
	"num" integer DEFAULT 0 NOT NULL,
	"ord" integer NOT NULL,
	"heading" text,
	"body" text NOT NULL,
	"norm" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "law_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"user_id" uuid,
	"by_name" text,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"period_from" text,
	"period_to" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"error" text,
	"kontrola_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "law_text_sync" (
	"law" text PRIMARY KEY NOT NULL,
	"url" text,
	"checked_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "law_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"law" text NOT NULL,
	"title" text NOT NULL,
	"as_of" text,
	"effective_from" text,
	"gazette" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hash" text NOT NULL,
	"articles" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'robot' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "law_articles" ADD CONSTRAINT "law_articles_text_id_law_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."law_texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "law_cases" ADD CONSTRAINT "law_cases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "law_cases" ADD CONSTRAINT "law_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "law_texts" ADD CONSTRAINT "law_texts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "law_articles_text_no_uq" ON "law_articles" USING btree ("text_id","no");--> statement-breakpoint
CREATE INDEX "law_articles_law_no_idx" ON "law_articles" USING btree ("law","no");--> statement-breakpoint
CREATE INDEX "law_articles_fts_idx" ON "law_articles" USING gin (to_tsvector('simple', "norm"));--> statement-breakpoint
CREATE INDEX "law_cases_firm_idx" ON "law_cases" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "law_cases_kontrola_idx" ON "law_cases" USING btree ("kontrola_id");--> statement-breakpoint
CREATE UNIQUE INDEX "law_texts_law_hash_uq" ON "law_texts" USING btree ("law","hash");--> statement-breakpoint
CREATE INDEX "law_texts_law_idx" ON "law_texts" USING btree ("law","as_of");