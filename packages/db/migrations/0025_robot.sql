CREATE TABLE "robot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"role" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"deep" boolean DEFAULT false NOT NULL,
	"free" boolean DEFAULT false NOT NULL,
	"reply_to" uuid,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unverified" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"error" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robot_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"message_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"result" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "robot_messages" ADD CONSTRAINT "robot_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_messages" ADD CONSTRAINT "robot_messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_proposals" ADD CONSTRAINT "robot_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_proposals" ADD CONSTRAINT "robot_proposals_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "robot_messages_user_firm_idx" ON "robot_messages" USING btree ("user_id","firm_id","created_at");--> statement-breakpoint
CREATE INDEX "robot_proposals_msg_idx" ON "robot_proposals" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "robot_proposals_firm_idx" ON "robot_proposals" USING btree ("firm_id","status");--> statement-breakpoint
CREATE INDEX "robot_proposals_open_idx" ON "robot_proposals" USING btree ("user_id") WHERE "robot_proposals"."status" = 'open';