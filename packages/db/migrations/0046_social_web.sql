ALTER TABLE "social_posts" ALTER COLUMN "law_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "news_url" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "news_title" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "news_inst" text;--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_news_uq" ON "social_posts" USING btree ("news_url");