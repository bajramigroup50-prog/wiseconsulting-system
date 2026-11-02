-- Non-taxable payroll payments (регрес, отпремнина, јубилејна, помош): line category 'nep'.
ALTER TABLE "payroll_lines" DROP CONSTRAINT IF EXISTS "payroll_lines_cat_chk";--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_cat_chk" CHECK ("payroll_lines"."cat" in ('reg','dop','bol','odm','kor','sin','nep'));
