/**
 * P39 — automatic debit / credit side of an imported opening balance („Почетна состојба“), so „⇄ Д/П“ per row is only
 * the fallback. Pure; the screen runs it on every parsed sheet / read before `buildOpening`.
 *
 *  - Separate Должи / Побарува columns (`columns`): the file says the side → kept.
 *  - One signed „Салдо“ column (`signed`): the sign says it (− = побарува). A heading with the convention („Д−П“ /
 *    „П−Д“) is final; without one, a file whose signs contradict the normal balance of most accounts (assets on
 *    побарува, liabilities on должи) is the П−Д convention → every row turned around.
 *  - Only positive amounts (`unsigned`, or a read with every amount on one side): the side by the account's class and
 *    normal balance (assets 0/1/3 должи, 12x customers должи, 2 liabilities and 22x suppliers побарува, 9 capital
 *    побарува, 96x loss должи). Accounts without a sure normal side (value adjustments x9, classes 5/7/8, 99x) are
 *    decided by Σ должи = Σ побарува when exactly ONE assignment balances.
 *  - Not sure (does not balance, or several assignments balance): the rows stay as read and a hint with the class-based
 *    suggestion is returned — never a silent guess.
 */
import type { ObRow, SheetSide } from '../ledger';

export type Side = 'd' | 'p';

/** Normal balance side of an account by the Macedonian chart of accounts; null = not sure (decided by the balance). */
export function normalSide(konto: string): Side | null {
  const k = String(konto ?? '').trim();
  if (!/^\d{3}/.test(k)) return null;
  const c = k[0]!;
  // value adjustments / accumulated depreciation („исправка на вредноста“) of the asset classes are credit
  if ((c === '0' || c === '1' || c === '3') && k[2] === '9') return null;
  if (c === '0' || c === '1' || c === '3' || c === '6') return 'd';
  if (c === '2') return 'p';
  if (c === '4') return 'd';
  if (c === '9') return k.startsWith('96') ? 'd' : k.startsWith('99') ? null : 'p';
  return null;
}

export interface ObSideResult {
  rows: ObRow[];
  /** `kept` = as read; `flip` = every sign turned around (П−Д file); `class` = positive amounts placed by class. */
  how: 'kept' | 'flip' | 'class';
  /** false = not sure: `rows` are as read and `suggestion` holds the class-based placement. */
  sure: boolean;
  /** rows whose side changed (in `rows`, or in `suggestion` when not sure) */
  changed: number;
  hint: string;
  suggestion?: ObRow[];
}

const cents = (n: number) => Math.round((Number(n) || 0) * 100);
const money = (c: number) => (c / 100).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const put = (r: ObRow, s: Side): ObRow => { const a = (Number(r[4]) || 0) + (Number(r[5]) || 0); return [r[0], r[1], r[2], r[3], s === 'd' ? a : 0, s === 'p' ? a : 0]; };
const sideOf = (r: ObRow): Side => (Number(r[5]) > 0 && !(Number(r[4]) > 0) ? 'p' : 'd');
/** Up to 2^18 combinations of the accounts without a normal side. */
const MAX_FREE = 18;

export function obAutoSide(rows: readonly ObRow[], side?: SheetSide | null): ObSideResult {
  const R = rows.map((r) => [...r] as ObRow);
  const kept = (hint = ''): ObSideResult => ({ rows: R, how: 'kept', sure: true, changed: 0, hint });
  if (!R.length) return kept();
  const anyD = R.some((r) => Number(r[4]) > 0), anyP = R.some((r) => Number(r[5]) > 0);
  // everything on one side cannot be a balance sheet: the file did not carry the side (also a read without a mode)
  const mode = anyD && anyP ? (side?.mode === 'unsigned' ? 'columns' : side?.mode ?? 'columns') : 'unsigned';
  if (mode === 'columns') return kept();

  if (mode === 'signed') {
    if (side?.hdr) return kept(`Страната е според знакот на салдото (насловот: ${side.hdr === 'pd' ? 'П − Д' : 'Д − П'}).`);
    let agree = 0, disagree = 0;
    for (const r of R) { const n = normalSide(r[0]); if (n) (sideOf(r) === n ? agree++ : disagree++); }
    if (disagree >= 3 && disagree > 2 * agree) {
      return { rows: R.map((r) => [r[0], r[1], r[2], r[3], r[5], r[4]] as ObRow), how: 'flip', sure: true, changed: R.length,
        hint: `Салдата се со обратен знак (+ = побарува): ${disagree} од ${agree + disagree} конта беа на спротивната страна од вообичаената – сите ставки се свртени. Проверете; „⇄ Д/П“ останува за поединечни ставки.` };
    }
    return kept('Страната е според знакот на салдото (− = побарува).');
  }

  // unsigned: by class, the rest by Σ должи = Σ побарува
  const A = R.map((r) => cents((Number(r[4]) || 0) + (Number(r[5]) || 0)));
  const want: (Side | null)[] = R.map((r) => normalSide(r[0]));
  let D = 0, P = 0;
  const free: number[] = [];
  want.forEach((s, i) => { if (s === 'd') D += A[i]!; else if (s === 'p') P += A[i]!; else free.push(i); });
  let pick: number | null = null, sols = 0;
  if (free.length <= MAX_FREE) {
    const tot = free.reduce((a, i) => a + A[i]!, 0);
    for (let m = 0; m < 1 << free.length && sols < 2; m++) {
      let dS = 0;
      for (let b = 0; b < free.length; b++) if (m & (1 << b)) dS += A[free[b]!]!;
      if (Math.abs(D + dS - (P + tot - dS)) <= 1) { sols++; pick = m; }
    }
  }
  const assign = (m: number | null): ObRow[] => R.map((r, i) => {
    const s = want[i] ?? (m == null ? sideOf(r) : (m & (1 << free.indexOf(i)) ? 'd' : 'p'));
    return put(r, s);
  });
  const diffCount = (X: ObRow[]) => X.filter((x, i) => sideOf(x) !== sideOf(R[i]!)).length;
  if (sols === 1) {
    const X = assign(pick);
    const sum = X.reduce((a, r) => a + cents(r[4]), 0);
    return { rows: X, how: 'class', sure: true, changed: diffCount(X),
      hint: `Сите износи беа позитивни – страната (Д/П) е одредена според класата на контото${free.length ? ` и изедначувањето (${free.length} конта без вообичаена страна)` : ''}: Должи = Побарува = ${money(sum)}. „⇄ Д/П“ останува за поединечни ставки.` };
  }
  const S = assign(null);
  const sd = S.reduce((a, r) => a + cents(r[4]), 0), sp = S.reduce((a, r) => a + cents(r[5]), 0);
  const why = sols > 1 ? 'повеќе распореди даваат Должи = Побарува' : free.length > MAX_FREE ? `${free.length} конта немаат вообичаена страна` : `по класата на контото Должи ≠ Побарува (разлика ${money(sd - sp)})`;
  const changed = diffCount(S);
  return { rows: R, how: 'kept', sure: false, changed, suggestion: changed ? S : undefined,
    hint: `Сите износи се позитивни, а страната (Д/П) не може сигурно да се одреди: ${why}. Ставките се оставени како што се прочитани${changed ? ` – предлог според класата на контото: Должи ${money(sd)} / Побарува ${money(sp)} (${changed} ставки на другата страна)` : ''}.` };
}
