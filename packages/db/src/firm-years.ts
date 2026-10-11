/**
 * Working years of a firm in SQL — the database twin of `@wise/core/firms/years` (`firmActiveIn`), used to list only
 * the firms that exist in the selected year (picker, /firmi, office-wide lists, counts).
 *
 * A firm is in year Y when
 *  - `settings.toYear` is empty or ≥ Y, and
 *  - `settings.fromYear` ≤ Y when it is set; otherwise the firm was entered (`created_at`, Skopje) in Y or earlier,
 *    or it has a journal / invoice / purchase dated in Y or earlier, and
 *  - for a year after the current one (Skopje): `fromYear` is Y, or it has a journal (e.g. the carried
 *    „Почетна состојба“) / invoice / purchase dated in Y or later — future years stay empty until the carry.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { firms, invoices, journals, purchases } from './schema/index';
import type { Tx } from './audit';
import { fyNow } from '@wise/core/firms/years';

const yr = (k: 'fromYear' | 'toYear') =>
  sql`(case when ${firms.settings}->>${k} ~ '^[0-9]{4}$' and (${firms.settings}->>${k})::int between 1990 and 2100 then (${firms.settings}->>${k})::int end)`;

/** `where` condition on `firms`: the firm works in `year`. */
export function firmInYearSql(year: number, nowYear = fyNow()): SQL {
  const y = Math.trunc(year);
  const end = `${y}-12-31`, start = `${y}-01-01`;
  const from = yr('fromYear'), to = yr('toYear');
  const future = y <= nowYear ? sql`true` : sql`(coalesce(${from} = ${y}, false)
    or exists (select 1 from ${journals} where ${journals.firmId} = ${firms.id} and ${journals.date} >= ${start})
    or exists (select 1 from ${invoices} where ${invoices.firmId} = ${firms.id} and ${invoices.date} >= ${start})
    or exists (select 1 from ${purchases} where ${purchases.firmId} = ${firms.id} and ${purchases.date} >= ${start})
    or (${from} is null and extract(year from ${firms.createdAt} at time zone 'Europe/Skopje') = ${y}))`;
  return sql`${future} and (${to} is null or ${to} >= ${y}) and (case when ${from} is not null then ${from} <= ${y} else (
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
export async function firmFirstDataYears(db: Tx, firmIds?: readonly string[], agg: 'min' | 'max' = 'min'): Promise<Map<string, number>> {
  if (firmIds && !firmIds.length) return new Map();
  const fn = sql.raw(agg);
  const part = (t: typeof journals | typeof invoices | typeof purchases) =>
    sql`select ${t.firmId} as f, ${fn}(${t.date}) as d from ${t} ${firmIds ? sql`where ${inArray(t.firmId, [...firmIds])}` : sql``} group by ${t.firmId}`;
  const rows = await db.select({ f: sql<string>`u.f`, y: sql<number>`extract(year from ${fn}(u.d))::int` })
    .from(sql`(${part(journals)} union all ${part(invoices)} union all ${part(purchases)}) u`).groupBy(sql`u.f`);
  return new Map(rows.map((r) => [r.f, Number(r.y)]));
}

/** Last data year per firm (journals incl. the carried opening / invoices / purchases). */
export const firmLastDataYears = (db: Tx, firmIds?: readonly string[]): Promise<Map<string, number>> =>
  firmFirstDataYears(db, firmIds, 'max');
