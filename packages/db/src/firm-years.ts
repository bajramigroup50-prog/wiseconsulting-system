/**
 * Working years of a firm in SQL — the database twin of `@wise/core/firms/years` (`firmActiveIn`), used to list only
 * the firms that exist in the selected year (picker, /firmi, office-wide lists, counts).
 *
 * A firm is in year Y when
 *  - `settings.toYear` is empty or ≥ Y, and
 *  - `settings.fromYear` ≤ Y when it is set; otherwise the firm was entered (`created_at`, Skopje) in Y or earlier,
 *    or it has a journal / invoice / purchase dated in Y or earlier.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
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

/** `where` condition on `firms`: not closed before `year` (`settings.toYear` empty or ≥ year) — for background jobs. */
export function firmOpenInSql(year: number): SQL {
  const to = yr('toYear');
  return sql`(${to} is null or ${to} >= ${Math.trunc(year)})`;
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

/** First data year per firm (journals / invoices / purchases), for lists that show the working years. */
export async function firmFirstDataYears(db: Tx, firmIds?: readonly string[]): Promise<Map<string, number>> {
  if (firmIds && !firmIds.length) return new Map();
  const part = (t: typeof journals | typeof invoices | typeof purchases) =>
    sql`select ${t.firmId} as f, min(${t.date}) as d from ${t} ${firmIds ? sql`where ${inArray(t.firmId, [...firmIds])}` : sql``} group by ${t.firmId}`;
  const rows = await db.select({ f: sql<string>`u.f`, y: sql<number>`extract(year from min(u.d))::int` })
    .from(sql`(${part(journals)} union all ${part(invoices)} union all ${part(purchases)}) u`).groupBy(sql`u.f`);
  return new Map(rows.map((r) => [r.f, Number(r.y)]));
}
