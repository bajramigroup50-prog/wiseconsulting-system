ALTER TABLE "aml_records" DROP CONSTRAINT "aml_records_firm_id_firms_id_fk";
--> statement-breakpoint
ALTER TABLE "aml_records" ADD CONSTRAINT "aml_records_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE restrict ON UPDATE no action;