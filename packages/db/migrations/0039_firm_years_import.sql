-- Firms imported from Excel got „Година“ (the legacy current year) as their first working year (`settings.fromYear`), so they
-- were listed in 2021 / 2023 / 2024 without any data there. User decision: earlier years stay empty until the user fills
-- them. The imported first year is removed where the firm has no journal / invoice / purchase before its creation year;
-- the firm is then listed from the year it was entered (or from the first year it gets data in).
UPDATE "firms" f SET "settings" = f."settings" - 'fromYear'
WHERE f."settings" ? 'fromYear'
  AND (f."settings"->>'fromYear') ~ '^[0-9]{4}$'
  AND (f."settings"->>'fromYear')::int < extract(year from f."created_at" at time zone 'Europe/Skopje')
  AND NOT EXISTS (SELECT 1 FROM "journals" j WHERE j."firm_id" = f."id" AND j."date" < make_date(extract(year from f."created_at" at time zone 'Europe/Skopje')::int, 1, 1))
  AND NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i."firm_id" = f."id" AND i."date" < make_date(extract(year from f."created_at" at time zone 'Europe/Skopje')::int, 1, 1))
  AND NOT EXISTS (SELECT 1 FROM "purchases" p WHERE p."firm_id" = f."id" AND p."date" < make_date(extract(year from f."created_at" at time zone 'Europe/Skopje')::int, 1, 1));
