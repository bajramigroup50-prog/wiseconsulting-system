/** Firm dossier — legacy `DOS_CAT` / `DOS_FRESH` / `dosAgeB` / `dosExp` / `dosBadge` (7989–8002). */
import { addMonths, daysBetween } from './dates';

/** Dossier categories (legacy `sub`), including the 2nd entry spliced in at 7990. */
export const DOS_CAT = [
  'Тековна состојба (ЦРМ)',
  'Тековна состојба – вистински сопственик (ЦРМ)',
  'Годишни сметки и биланси (минати години)',
  'ДДВ пријави и даночни биланси (минати години)',
  'Решение за ДДВ / ЕДБ',
  'Решение за упис / основање',
  'Изјава / договор за основање, статут',
  'Документи на управител / сопственик',
  'Договори (закуп, соработка, кредит)',
  'Решенија за вработени (вработување, одмор, отказ)',
  'Дозволи и лиценци',
  'Решенија и потврди од УЈП / ФЗО / ПИОМ',
  'Сертификати и уверенија',
  'Банкарски документи',
  'Друго',
  // added by legacy at 14039 for documents routed from the client inbox (`irArch`)
  'Плати и персонал',
  'Благајна',
  'Магацински документи',
  'Патни налози и гориво',
  'Друго од клиентот',
] as const;

/** Categories that institutions only accept when recent (≤ 3 or ≤ 6 months). */
export const DOS_FRESH: readonly string[] = [DOS_CAT[0], DOS_CAT[1]];

export interface DossierDocLike { category: string; date?: string | null; validTo?: string | null }

/** Legacy `dosAgeTxt`. */
export function ageText(n: number | null): string {
  if (n == null) return '';
  if (n < 31) return `${n}${n === 1 ? ' ден' : ' дена'}`;
  const m = Math.floor(n / 30.44);
  return `${m}${m === 1 ? ' месец' : ' месеци'}`;
}

export type Lvl = 'good' | 'warn' | 'bad' | 'info';

/** Freshness of a "must be recent" document (legacy `dosAgeB`): good ≤ 3 months, warn ≤ 6, bad older. */
export function freshness(d: DossierDocLike, today: string): { lvl: Lvl; text: string; title: string } | null {
  if (!DOS_FRESH.includes(d.category) || !d.date) return null;
  const n = daysBetween(d.date, today);
  const in3 = today <= addMonths(d.date, 3), in6 = today <= addMonths(d.date, 6);
  return {
    lvl: in3 ? 'good' : in6 ? 'warn' : 'bad',
    text: `${ageText(n)}${in3 ? ' · до 3 мес.' : in6 ? ' · до 6 мес.' : ' · над 6 мес.'}`,
    title: in3 ? 'Важи и за барање до 3 месеци' : in6 ? 'Важи само за барање до 6 месеци (постара од 3)' : 'Постара од 6 месеци – извадете нова',
  };
}

/** Days until `validTo` (legacy `dosExp`), negative when expired. */
export const daysToExpiry = (d: DossierDocLike, today: string): number | null => (d.validTo ? daysBetween(today, d.validTo) : null);

/** Expiry badge (legacy `dosBadge`): expired → bad, ≤ 30 days → warn. */
export function expiry(d: DossierDocLike, today: string): { lvl: Lvl; days: number } | null {
  const n = daysToExpiry(d, today);
  if (n == null) return null;
  return { lvl: n < 0 ? 'bad' : n <= 30 ? 'warn' : 'good', days: n };
}

/** Newest document per category (legacy `dosNewest`). */
export function newestByCategory<T extends DossierDocLike & { createdAt?: Date | string | null }>(L: readonly T[]): Map<string, T> {
  const M = new Map<string, T>();
  for (const d of L) {
    const o = M.get(d.category);
    const k = (x: T) => `${x.date ?? ''}|${x.createdAt instanceof Date ? x.createdAt.toISOString() : x.createdAt ?? ''}`;
    if (!o || k(d) > k(o)) M.set(d.category, d);
  }
  return M;
}
