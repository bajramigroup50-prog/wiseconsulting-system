CREATE TABLE "meal_beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"no" integer,
	"name" text NOT NULL,
	"members" integer DEFAULT 1 NOT NULL,
	"nationality" text,
	"embg" text,
	"place" text,
	"phone" text,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"date" date NOT NULL,
	"meal" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_beneficiaries" ADD CONSTRAINT "meal_beneficiaries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_beneficiary_id_meal_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."meal_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_benef_firm_idx" ON "meal_beneficiaries" USING btree ("firm_id","active","name");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_logs_one_idx" ON "meal_logs" USING btree ("beneficiary_id","date","meal");--> statement-breakpoint
CREATE INDEX "meal_logs_firm_date_idx" ON "meal_logs" USING btree ("firm_id","date");