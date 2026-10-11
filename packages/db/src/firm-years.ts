/**
 * Working years of a firm in SQL — the database twin of `@wise/core/firms/years` (`firmActiveIn`), used to list only
 * the firms that exist in the selected year (picker, /firmi, office-wide lists, counts).
 *
 * A firm is in year Y when
 *  - `settings.toYear` is empty or ≥ Y, and
 *  - `settings.fromYear` ≤ Y when it is set; otherwise the firm was entered (`created_at`, Skopje) in Y or earlier,
 *    or it has a journal / invoice / purchase dated in Y or earlier.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { firms, invoices, journals, purchases } from './schema/index';
import type { Tx } from './audit';

const yr = (k: 'fromYear' | 'toYear') =>
  sql`(case when ${firms.settings}->>${k} ~ '^[0-9]{4}$' and (${firms.settings}->>${k})::int between 1990 and 2100 then (${firms.settings}->>${k})::int end)`;

/** `where` condition on `firms`: the firm works in `year`. */
export function firmInYearSql(year: number): SQL {
  const y = Math.trunc(year);
  const end = `${y}-12-31`;
  const from = yr('fromYear'), to = yr('toYear');
  return sql`(${to} is null or ${to} >= ${y}) and (case when ${from} is not null then ${from} <= ${y} else (
    extract(year from ${firms.createdAt} at time zone 'Europe/Skopje') <= ${y}
    or exists (select 1 from ${journals} where ${journals.firmId} = ${firms.id} and ${journals.date} <= ${end})
    or exists (select 1 from ${invoices} where ${invoices.firmId} = ${firms.id} and ${invoices.date} <= ${end})
    or exists (select 1 from ${purchases} where ${purchases.firmId} = ${firms.id} and ${purchases.date} <= ${end})
  ) end)`;
}

/** Active (not archived) and working in `year`. */
export const firmListedIn = (year: number): SQL => and(eq(firms.active, true), firmInYearSql(year))!;

/** Year of the firm's earliest journal / invoice / purchase, or `null` without data. */
export async function firmFirstDataYear(db: Tx, firmId: string): Promise<number | null> {
  const [r] = await db.select({ y: sql<number | null>`least(
    (select extract(year from min(${journals.date}))::int from ${journals} where ${journals.firmId} = ${firmId}),
    (select extract(year from min(${invoices.date}))::int from ${invoices} where ${invoices.firmId} = ${firmId}),
    (select extract(year from min(${purchases.date}))::int from ${purchases} where ${purchases.firmId} = ${firmId})
  )` }).from(firms).where(eq(firms.id, firmId));
  return r?.y == null ? null : Number(r.y);
}
