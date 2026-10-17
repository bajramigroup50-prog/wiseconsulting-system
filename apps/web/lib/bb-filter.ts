/**
 * Бруто биланс – рекапитулар (old desktop program): the level tabs „Класи | Групи | Синтетики (3) | Синтетики (4) |
 * Синтетики (5) | Аналитики | Вкупно“ and the parameters Префикс, Суфикс, Од конто, До конто, „Без колона ‚Само од
 * тековна година‘“, „Скратено печатење“, portrait / landscape. Pure: the screen (`app/(app)/bilanc`) and the print
 * (`app/print/bilanc`, `app/print/kkart/zbir`) share it.
 */
import { tbTotal, trialBalance, type BbLevel, type LedgerLine, type TbRow } from '@wise/core';

/** Tab value → level of `trialBalance` (`v` = Вкупно: only the class totals and the grand total). */
export type BbTab = BbLevel | 'v';
export const BB_TABS: readonly (readonly [BbTab, string])[] = [
  ['1', 'Класи'], ['2', 'Групи'], ['3', 'Синтетики (3)'], ['4', 'Синтетики (4)'], ['5', 'Синтетики (5)'], ['a', 'Аналитики'], ['v', 'Вкупно'],
];
export const bbTab = (v: unknown): BbTab => (BB_TABS.find(([x]) => x === v)?.[0] ?? 'a');

export interface BbFilter { pre: string; suf: string; kf: string; kt: string }
const digits = (v: unknown) => (/^\d{1,10}$/.test(String(v ?? '').trim()) ? String(v).trim() : '');
export const bbFilterOf = (sp: { pre?: string; suf?: string; kf?: string; kt?: string }): BbFilter => ({ pre: digits(sp.pre), suf: digits(sp.suf), kf: digits(sp.kf), kt: digits(sp.kt) });
export const bbFilterOn = (f: BbFilter) => !!(f.pre || f.suf || f.kf || f.kt);

/**
 * Does an (analytic) konto pass the parameters? Префикс = starts with, Суфикс = ends with, Од / До конто = range on
 * the konto's leading digits (До 2299 keeps 229999, Од 2200 keeps 2200 and every konto after it).
 */
export function bbKontoOk(k: string, f: BbFilter): boolean {
  if (f.pre && !k.startsWith(f.pre)) return false;
  if (f.suf && !k.endsWith(f.suf)) return false;
  if (f.kf && k.slice(0, Math.max(f.kf.length, 1)) < f.kf) return false;
  if (f.kt && k.slice(0, f.kt.length) > f.kt) return false;
  return true;
}

/** The lines of the kontos that pass (filtering before the grouping, so a class / group sums only those kontos). */
export const bbFilterLines = <L extends Pick<LedgerLine, 'account'>>(lines: readonly L[], f: BbFilter): L[] => (bbFilterOn(f) ? lines.filter((l) => bbKontoOk(l.account, f)) : [...lines]);

export interface BbView {
  /** rows to list (empty on „Вкупно“) */
  rows: TbRow[];
  /** per class: its total (shown under the class, and the only rows of „Вкупно“) */
  classes: { c: string; rows: TbRow[]; total: Omit<TbRow, 'k' | 'name'> }[];
  total: Omit<TbRow, 'k' | 'name'>;
  /** imported trial balance mixed with booked documents (see `trialBalance`) */
  bbimpMixed: boolean;
}

/** Rows of one tab with the parameters (and the existing search `q`: konto prefix or a word of the name). */
export function bbView(lines: readonly LedgerLine[], o: { tab: BbTab; from: string; to: string; withClose?: boolean; partnerId?: string | null; f: BbFilter; q?: string; accountName?: (k: string) => string | undefined }): BbView {
  const level: BbLevel = o.tab === 'v' ? 'a' : o.tab;
  const tb = trialBalance(bbFilterLines(lines, o.f), { level, from: o.from, to: o.to, withClose: o.withClose, partnerId: o.partnerId, accountName: o.accountName });
  const q = (o.q ?? '').trim().toLowerCase();
  const R = q ? tb.rows.filter((r) => r.k.startsWith(q) || r.name.toLowerCase().includes(q)) : tb.rows;
  const classes = [...new Set(R.map((r) => r.k[0]!))].sort().map((c) => {
    const rows = R.filter((r) => r.k[0] === c);
    return { c, rows, total: tbTotal(rows) };
  });
  return { rows: o.tab === 'v' ? [] : R, classes, total: tbTotal(R), bbimpMixed: tb.bbimpMixed };
}

/** Analytic kontos of the range with turnover — „Збирна аналитичка картица“ prints one card per konto. */
export function bbCardKontos(lines: readonly LedgerLine[], f: BbFilter, max = 300): string[] {
  const K = new Set<string>();
  for (const l of bbFilterLines(lines, f)) if ((+l.debit || 0) || (+l.credit || 0)) K.add(l.account);
  return [...K].sort().slice(0, max);
}
