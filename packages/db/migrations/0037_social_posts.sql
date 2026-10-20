CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"law_id" uuid NOT NULL,
	"status" text NOT NULL,
	"fb_post_id" text,
	"ig_media_id" text,
	"ig_link" text,
	"error" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_law_id_law_changes_id_fk" FOREIGN KEY ("law_id") REFERENCES "public"."law_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_law_uq" ON "social_posts" USING btree ("law_id");--> statement-breakpoint
CREATE INDEX "social_posts_created_idx" ON "social_posts" USING btree ("created_at");