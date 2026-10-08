/**
 * Profit tax: ДБ (УЈП образец 6-2020, AOP 01–70) and ДБ-ВП (annual tax on total income).
 *
 * Legacy: `DB_F` 10748–10827, `DB_MIG` 10828, `dbData` 10829 (the hoisted winner; 7646 is dead), `dbEdb` 10843,
 * `vpData` 17105.
 */
import { r2 } from '../money';
import dbData from '../data/yearend-db-form.json';
import { zsV, type ZsResult } from './aop';

export type DbRowType = 'auto' | 'akont' | 'inc';
/** Header `['h', roman, title]` or data `[aop, '', label, type?]`. */
export type DbFormRow = readonly [string, string, string, DbRowType?];
export const DB_F: readonly DbFormRow[] = dbData.rows as unknown as DbFormRow[];
/** Old ДБ keys → AOP (legacy firms stored `dbAdj` under these names). */
export const DB_MIG: Readonly<Record<string, string>> = dbData.migrate;

/** Profit tax rate (ЗДД). */
export const DB_RATE = 0.1;

export interface DbResult {
  V: Record<string, number>;
  /** adjustments after DB_MIG, by AOP */
  A: Record<string, number>;
  akAuto: number;
  incAuto: number;
  profit: number;
  nd: number;
  base: number;
  tax: number;
  ak: number;
  diff: number;
  red: number;
}

/**
 * Compute the ДБ return (legacy `dbData`).
 * @param C        AOP result of the year
 * @param adj      `firm.dbAdj[year]` — manual inputs by AOP (or old DB_MIG keys)
 * @param akontAuto sum of DEBITS on konto 2330 in the year excluding the opening balance (prepayments made)
 */
export function computeDb(C: Pick<ZsResult, 'V'>, adj: Readonly<Record<string, number | string>> | null | undefined, akontAuto: number): DbResult {
  const A: Record<string, number> = {};
  for (const [k, v] of Object.entries(adj ?? {})) {
    const kk = DB_MIG[k] || k;
    if (/^\d\d$/.test(kk)) A[kk] = r2((A[kk] || 0) + (+v || 0));
  }
  const R = (v: unknown) => Math.round(+(v as number) || 0);
  const V: Record<string, number> = {};
  const a = (k: string) => R(A[k]);
  const g = (k: string) => V[k] ?? 0;
  V['01'] = R(zsV('bu', '250', C) - zsV('bu', '251', C));
  for (let i = 3; i <= 39; i++) {
    const k = String(i).padStart(2, '0');
    V[k] = a(k);
  }
  V['02'] = Array.from({ length: 37 }, (_, i) => g(String(i + 3).padStart(2, '0'))).reduce((s, x) => s + x, 0);
  V['40'] = g('01') + g('02');
  for (let i = 42; i <= 48; i++) V[String(i)] = a(String(i));
  V['41'] = [42, 43, 44, 45, 46, 47, 48].reduce((s, i) => s + g(String(i)), 0);
  V['49'] = Math.max(0, g('40') - g('41'));
  V['50'] = R(g('49') * DB_RATE);
  for (const i of [52, 53, 54, 55]) V[String(i)] = a(String(i));
  V['51'] = Math.min(g('50'), g('52') + g('53') + g('54') + g('55'));
  V['56'] = Math.max(0, g('50') - g('51'));
  const akAuto = R(akontAuto);
  V['57'] = A['57'] != null ? a('57') : akAuto;
  V['58'] = a('58');
  V['59'] = g('56') - g('57') - g('58');
  for (const i of [60, 61, 63, 64, 66, 67, 68, 69, 70]) V[String(i)] = a(String(i));
  V['62'] = A['62'] != null ? a('62') : g('40') < 0 ? -g('40') : 0;
  const incAuto = R(zsV('bu', '201', C) + zsV('bu', '223', C) + zsV('bu', '244', C) + zsV('bu', '248', C));
  V['65'] = A['65'] != null ? a('65') : incAuto;
  return { V, A, akAuto, incAuto, profit: g('01'), nd: g('02'), base: g('49'), tax: g('56'), ak: g('57'), diff: g('59'), red: g('41') };
}

/** Prepayments of profit tax: debits on 2330 that are not part of the opening balance (legacy `akAuto`). */
export function dbAkontFromTurnover(rows: readonly { account: string; debit: number }[]): number {
  return Math.round(rows.filter((r) => String(r.account) === '2330').reduce((s, r) => s + (+r.debit || 0), 0));
}

/** EDB with the "МК" prefix the УЈП form expects (legacy `dbEdb`). */
export function dbEdb(edb: string | null | undefined): string {
  const e = String(edb || '');
  return /^(MK|МК)/.test(e) ? e : e ? 'МК' + e : '';
}

/* ---------------- ДБ-ВП ---------------- */

export interface VpAdj {
  '01'?: number | string;
  '07'?: number | string;
  nace?: string;
  naceN?: string;
  desc?: string;
  inv?: string;
  form?: string;
  gdvp?: string;
}
export interface VpResult {
  A: VpAdj;
  inc: number;
  incAuto: number;
  rate: number;
  tax: number;
  ak: number;
  akAuto: number;
  elig: boolean;
  diff: number;
  nace: string;
  naceN: string;
  desc: string;
  inv: string;
  form: string;
  gdvp: string;
}

/** Lower / upper bound of total income for ДБ-ВП (legacy hard-coded 3 000 000 < inc ≤ 6 000 000). */
export const VP_MIN_INCOME = 3_000_000;
export const VP_MAX_INCOME = 6_000_000;
export const VP_RATE = 1;

/** ДБ-ВП (legacy `vpData`): 1% on total income when it is above 3 M and up to 6 M denars. */
export function computeVp(
  C: Pick<ZsResult, 'V'>,
  adj: VpAdj | null | undefined,
  akontAuto: number,
  firm: { name?: string; nkd?: string; activity?: string; activityName?: string } = {},
): VpResult {
  const A = adj ?? {};
  const R = (v: unknown) => Math.round(+(v as number) || 0);
  const incAuto = R(zsV('bu', '201', C) + zsV('bu', '223', C));
  const inc = A['01'] != null ? R(A['01']) : incAuto;
  const rate = VP_RATE;
  const elig = inc > VP_MIN_INCOME && inc <= VP_MAX_INCOME;
  const tax = elig ? R((inc * rate) / 100) : 0;
  const akAuto = R(akontAuto);
  const ak = A['07'] != null ? R(A['07']) : akAuto;
  const name = firm.name || '';
  return {
    A,
    inc,
    incAuto,
    rate,
    tax,
    ak,
    akAuto,
    elig,
    diff: tax - ak,
    nace: A.nace ?? (firm.nkd || firm.activity || ''),
    naceN: A.naceN ?? (firm.activityName || ''),
    desc: A.desc ?? '',
    inv: A.inv ?? 'НЕ',
    // fix: legacy used /\bАД\b/, which never matches because \b ignores Cyrillic letters
    form: A.form ?? (/ДООЕЛ/i.test(name) ? 'ДООЕЛ' : /ДОО/i.test(name) ? 'ДОО' : /(^|[^\p{L}])АД([^\p{L}]|$)/u.test(name) ? 'АД' : ''),
    gdvp: A.gdvp ?? '',
  };
}
