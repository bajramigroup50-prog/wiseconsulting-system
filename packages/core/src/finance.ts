/**
 * Finance & books reports and helpers that had no port yet (pure, unit-tested):
 *
 * - partner cards (legacy `kcCard` 6430, `kcPartners` 6439, `kcSynHTML` 6480, `kcSort` 6428) — Аналитички картици по комитент
 * - partner analytics / ИОС (legacy `anRows` 6643 + filter 12963, `ios` 7302, `partnerCard` 6645)
 * - balance confirmation rows (legacy `POT_ROWS` / `potSaldo` 13744)
 * - result per location (legacy `VIEWS.poobjekti` 5156)
 * - penalty interest (legacy `VIEWS.kamati` 5875 / `kamNote` 7240)
 * - ПДД rent / bonus / services (legacy `PDD_T0`, `pddCalc*`, `pddEntries` 8314–8325)
 * - loans (legacy `lnKontoDir` 16679, `lnLedRows` 16686, `lnBankRows` / `lnState` 16690–16704)
 * - card reconciliation (legacy `recKeys`, `recAggPrior`, `recParse` (table part), `recMatch` 12909–12931; `rfRun` v431 13785)
 * - custom posting schemes (legacy `custApply` 5212 + balance check in `schSaveAll`)
 * - e-invoice buyer check (legacy `efCheck` 15204)
 */
import { r2 } from './money';
import { bmEq, bmKey, type InvKey } from './bank-match';
import { findHeaderRow, parseBankAmount, parseBankDate } from './bank-parsers';

/* ================================================================== partner cards */

/** One ledger line as the card reports need it. */
export interface CardLine {
  account: string;
  debit: number;
  credit: number;
  date: string;
  partnerId?: string | null;
  /** Nalog number (for sorting by nalog and the „Налог“ column). */
  number?: string | null;
  journalId?: string | null;
  kind?: string | null;
  description?: string | null;
  doc?: string | null;
  note?: string | null;
  /** Due date of the source document (invoice / purchase), legacy `kcDue`. */
  due?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}
export type CardSort = 'date' | 'nal';
export interface CardRow { line: CardLine; s: number }
export interface KontoCard { k: string; o: number; rows: CardRow[]; td: number; tp: number; end: number }

const amt = (l: Pick<CardLine, 'debit' | 'credit'>) => (+l.debit || 0) - (+l.credit || 0);

/** Legacy `kcSort` 6428: by date (stable) or by nalog number (numeric collation), then date. */
export function cardSort<T extends { line: Pick<CardLine, 'date' | 'number'> }>(rows: T[], sort: CardSort): T[] {
  const idx = rows.map((r, i) => [r, i] as const);
  idx.sort(([a, i], [b, j]) => {
    if (sort === 'nal') {
      const c = String(a.line.number ?? '').localeCompare(String(b.line.number ?? ''), 'mk', { numeric: true });
      if (c) return c;
    }
    return a.line.date < b.line.date ? -1 : a.line.date > b.line.date ? 1 : i - j;
  });
  return idx.map(([r]) => r);
}

/** Running-balance card of a set of lines: opening (lines before `from`), rows in [from, to]. */
function runCard(L: readonly CardLine[], from: string, to: string, sort: CardSort) {
  const pre = L.filter((l) => l.date < from);
  const rows = L.filter((l) => l.date >= from && l.date <= to);
  const o = r2(pre.reduce((a, l) => a + amt(l), 0));
  let s = o;
  const R = cardSort(rows.map((line) => ({ line })), sort).map((r) => { s = r2(s + amt(r.line)); return { ...r, s }; });
  const td = r2(rows.reduce((a, l) => a + (+l.debit || 0), 0));
  const tp = r2(rows.reduce((a, l) => a + (+l.credit || 0), 0));
  return { o, rows: R, td, tp, end: r2(o + td - tp) };
}

/** Legacy `kcCard` 6430: one card per konto of the partner (lines of the year up to `to`). */
export function partnerKontoCards(lines: readonly CardLine[], partnerId: string, o: { from: string; to: string; sort?: CardSort }): KontoCard[] {
  const my = lines.filter((l) => l.partnerId === partnerId);
  const ks = [...new Set(my.map((l) => String(l.account)))].sort();
  return ks.map((k) => ({ k, ...runCard(my.filter((l) => String(l.account) === k), o.from, o.to, o.sort ?? 'date') }));
}

/** Legacy `kcSynHTML` 6480: all lines of the selected kontos (with or without partner) as one card. */
export function syntheticCard(lines: readonly CardLine[], o: { from: string; to: string; sort?: CardSort }) {
  return runCard(lines, o.from, o.to, o.sort ?? 'date');
}

export interface PartnerSum { id: string; d: number; p: number; s: number; n: number }

/** Legacy `kcPartners` 6439: per partner turnover up to `to` (only lines with a partner); `open` keeps non-zero balances. */
export function partnerSums(lines: readonly CardLine[], o: { to: string; open?: boolean }): PartnerSum[] {
  const by = new Map<string, { d: number; p: number; n: number }>();
  for (const l of lines) {
    if (!l.partnerId || l.date > o.to) continue;
    const b = by.get(l.partnerId) ?? { d: 0, p: 0, n: 0 };
    b.d += +l.debit || 0; b.p += +l.credit || 0; b.n++;
    by.set(l.partnerId, b);
  }
  let P = [...by].map(([id, v]) => ({ id, d: r2(v.d), p: r2(v.p), s: r2(v.d - v.p), n: v.n }));
  if (o.open) P = P.filter((x) => Math.abs(x.s) > 0.009);
  return P;
}

/** Konto selection of the card: lines whose account starts with one of the kontos (legacy `kcLines`). */
export const inKontos = (account: string, kontos: readonly string[]): boolean => !kontos.length || kontos.some((c) => String(account).startsWith(c));

/** Lines on partner-mandatory accounts (120–128 / 220–228) without a partner (legacy `kpNoPLines` 12445). */
export const PARTNER_KONTO_RE = /^(12[0-8]|22[0-8])/;
export function linesWithoutPartner<T extends CardLine>(lines: readonly T[], kontos: readonly string[]): T[] {
  return lines.filter((l) => !l.partnerId && PARTNER_KONTO_RE.test(String(l.account)) && inKontos(l.account, kontos) && (+l.debit || +l.credit));
}

/* ================================================================== partner analytics (ИОС) */

export interface AnRow { p: string; k: string; d: number; c: number }

/** Legacy `anRows` 6643: partner × konto turnover on 12…/22… accounts. */
export function analyticsRows(lines: readonly CardLine[]): AnRow[] {
  const by = new Map<string, AnRow>();
  for (const l of lines) {
    if (!l.partnerId || !/^(12|22)/.test(String(l.account))) continue;
    const key = l.partnerId + '|' + l.account;
    const r = by.get(key) ?? { p: l.partnerId, k: String(l.account), d: 0, c: 0 };
    r.d += +l.debit || 0; r.c += +l.credit || 0;
    by.set(key, r);
  }
  return [...by.values()].map((r) => ({ ...r, d: r2(r.d), c: r2(r.c) }));
}

/** Legacy anRows filter (12963): konto prefix and „само со салдо“ (name search is done by the caller). */
export function filterAnalytics(rows: readonly AnRow[], o: { k?: string; bal?: boolean }): AnRow[] {
  return rows.filter((r) => (!o.k || r.k.startsWith(o.k)) && (!o.bal || Math.abs(r.d - r.c) > 0.009));
}

/** Legacy `ACT.ios` 7302: the partner's 12/22 lines and the balance (positive = in our favour). */
export function iosStatement<T extends CardLine>(lines: readonly T[], partnerId: string): { lines: T[]; saldo: number } {
  const L = lines.filter((l) => l.partnerId === partnerId && /^(12|22)/.test(String(l.account)));
  return { lines: L, saldo: r2(L.reduce((a, l) => a + amt(l), 0)) };
}

/** Legacy `POT_ROWS` 13744: rows of the balance confirmation (чл. 483 ЗТД); sign +1 = receivable, −1 = liability. */
export const POT_ROWS: readonly [string, string, RegExp, 1 | -1][] = [
  ['120', 'Побарувања од купувачи', /^12/, 1], ['162', 'Побарувања по дадени позајмици', /^16/, 1],
  ['220', 'Обврски кон добавувачи', /^22/, -1], ['262', 'Обврски по примени позајмици', /^26/, -1],
];
/** Legacy `potSaldo` 13745. */
export function balanceConfirmation(lines: readonly CardLine[], partnerId: string, to: string): { s: string; n: string; v: number }[] {
  const L = lines.filter((l) => l.partnerId === partnerId && l.date <= to);
  return POT_ROWS.map(([s, n, re, sg]) => ({ s, n, v: r2(r2(L.filter((l) => re.test(String(l.account))).reduce((a, l) => a + amt(l), 0)) * sg) || 0 }));
}

/* ================================================================== result per location */

export interface LocLine { account: string; debit: number; credit: number; locationId?: string | null }
export interface LocResult { w: string; rev: number; cogs: number; exp: number; res: number }

/** Legacy `VIEWS.poobjekti` 5156: revenue 74–79, cost of sales 70–73, other costs class 4, per location ('' = common). */
export function resultsByLocation(lines: readonly LocLine[], locationIds: readonly string[] = []): LocResult[] {
  const W = [...new Set([...locationIds, ...lines.map((l) => l.locationId || '')])];
  return W.map((w) => {
    const X = lines.filter((l) => (l.locationId || '') === w);
    const s = (p: string[]) => r2(X.filter((l) => p.some((q) => String(l.account).startsWith(q))).reduce((a, l) => a + (+l.credit || 0) - (+l.debit || 0), 0));
    const rev = s(['74', '75', '76', '77', '78', '79']), cogs = -s(['70', '71', '72', '73']), exp = -s(['4']);
    return { w, rev, cogs: r2(cogs) || 0, exp: r2(exp) || 0, res: r2(rev - cogs - exp) || 0 };
  }).filter((r) => r.rev || r.cogs || r.exp);
}

/* ================================================================== penalty interest */

/** Days late (legacy `Math.floor((asOf − due)/864e5)`), computed on calendar dates. */
export function daysLate(due: string | null | undefined, asOf: string): number {
  if (!due) return 0;
  const a = Date.parse(asOf + 'T00:00:00Z'), d = Date.parse(due + 'T00:00:00Z');
  return Number.isFinite(a) && Number.isFinite(d) ? Math.floor((a - d) / 864e5) : 0;
}
/** Legacy kamati: open × rate% × max(0, days) / 365. */
export const penaltyInterest = (open: number, ratePct: number, days: number): number => r2(open * (+ratePct || 0) / 100 * Math.max(0, days) / 365);

/** Penalty-interest journal (legacy `kamNote`): Д 1200 купувач / П 7800. */
export function interestLines(amount: number, partnerId: string | null, o: { customer?: string; income?: string } = {}) {
  return [
    { account: o.customer ?? '1200', debit: amount, credit: 0, partnerId },
    { account: o.income ?? '7800', debit: 0, credit: amount, partnerId: null },
  ];
}

/* ================================================================== ПДД (rent, bonuses, services) */

export interface PddType { id: string; sh: string; vid: string; pod: string; ded: number; tax: number; kExp: string; kLiab: string; kTax: string }
/** Legacy `PDD_T0` 8314. */
export const PDD_T0: readonly PddType[] = [
  { id: 's6_1', vid: 'T6. Доход од закуп и подзакуп', pod: 'S6.1. Доход од закуп, освен од издавање на опремени станбени и деловни', ded: 10, tax: 10, kExp: '4143', kLiab: '22052', kTax: '23502', sh: 'Закупнина' },
  { id: 's1_15', vid: 'T1. Доход од работа', pod: 'S1.15. Примања по основ на извршени интелектуални услуги', ded: 0, tax: 10, kExp: '4490', kLiab: '22053', kTax: '2350', sh: 'Интелектуални услуги / бонус' },
];
/** Legacy `pddTypes` 8317: defaults overridden / extended by the firm's types. */
export function pddTypes(user: readonly Partial<PddType>[] | null | undefined): PddType[] {
  const M = new Map(PDD_T0.map((t) => [t.id, { ...t }]));
  for (const t of user ?? []) if (t && t.id) M.set(t.id, { ...(M.get(t.id) ?? ({} as PddType)), ...t } as PddType);
  return [...M.values()];
}
export interface PddRow { tid: string; mode: 'n' | 'g'; amt: number; name: string; embg?: string; acct?: string; pid?: string | null }
export interface PddCalc { G: number; ded: number; tax: number; net: number }

/** Legacy `pddCalcG` 8319: whole denars. */
export function pddCalcGross(G0: number, t: Pick<PddType, 'ded' | 'tax'>): PddCalc {
  const G = Math.round(+G0 || 0);
  const ded = Math.round(G * (+t.ded || 0) / 100 + 1e-9);
  const tax = Math.round((G - ded) * (+t.tax || 0) / 100 + 1e-9);
  return { G, ded, tax, net: G - tax };
}
/** Legacy `pddCalc` 8320: net → gross search ±2 denars. */
export function pddCalc(r: Pick<PddRow, 'mode' | 'amt'>, t: Pick<PddType, 'ded' | 'tax'>): PddCalc {
  if (r.mode !== 'n') return pddCalcGross(r.amt, t);
  const N = Math.round(+r.amt || 0);
  const k = 1 - (+t.tax || 0) / 100 * (1 - (+t.ded || 0) / 100);
  const G = Math.round(N / k);
  for (const d of [0, -1, 1, -2, 2]) { const c = pddCalcGross(G + d, t); if (c.net === N) return c; }
  return pddCalcGross(G, t);
}
const typeOf = (T: readonly PddType[], id: string) => T.find((t) => t.id === id) ?? T[0]!;
export function pddTotal(rows: readonly PddRow[], T: readonly PddType[]): PddCalc {
  return rows.reduce((a, r) => { const c = pddCalc(r, typeOf(T, r.tid)); return { G: a.G + c.G, ded: a.ded + c.ded, tax: a.tax + c.tax, net: a.net + c.net }; }, { G: 0, ded: 0, tax: 0, net: 0 });
}
export interface PddLine { account: string; debit: number; credit: number; note: string; partnerId?: string | null }
/** Legacy `pddEntries` 8322: Д трошок бруто / П обврска нето (примач) / П ПДД; same konto+side+partner+note merged. */
export function pddEntries(rows: readonly PddRow[], T: readonly PddType[]): PddLine[] {
  const L: PddLine[] = [];
  for (const r of rows) {
    const t = typeOf(T, r.tid), c = pddCalc(r, t);
    if (!c.G) continue;
    const nt = (t.sh || t.pod) + ' – ' + (r.name || '');
    L.push({ account: t.kExp, debit: c.G, credit: 0, note: nt }, { account: t.kLiab, debit: 0, credit: c.net, note: nt, partnerId: r.pid || null });
    if (c.tax) L.push({ account: t.kTax, debit: 0, credit: c.tax, note: 'ПДД ' + nt });
  }
  const M: PddLine[] = [];
  for (const l of L) {
    const x = M.find((y) => y.account === l.account && !!y.debit === !!l.debit && (y.partnerId || '') === (l.partnerId || '') && y.note === l.note);
    if (x) { x.debit += l.debit; x.credit += l.credit; } else M.push({ ...l });
  }
  return M;
}

/* ================================================================== loans (позајмици) */

export type LoanDir = 'given' | 'received';
/** Legacy `LN_K`: default kontos for given / received loans. */
export const LOAN_KONTO: Record<LoanDir, string> = { given: '1620', received: '2620' };
const LN_RE = /заем|позајм/i;

/** Legacy `lnKontoDir` 16679: konto → loan direction (033/160–163 given, 260–263/285 received, or a „заем/позајм“ name). */
export function loanKontoDir(k: string, name = ''): LoanDir | null {
  k = String(k || '');
  if (!k || /камат/i.test(name)) return null;
  if (/^(033|16[0-3])/.test(k) || (/^[01]/.test(k) && LN_RE.test(name))) return 'given';
  if (/^(26[0-3]|285)/.test(k) || (/^2/.test(k) && LN_RE.test(name))) return 'received';
  return null;
}

export interface LoanMove { id: string; date: string; partnerId: string; dir: LoanDir; kind: 'out' | 'back'; amt: number; konto: string; desc: string; src: string }

/** Legacy `lnLedRows` 16686: loan disbursements / repayments from ledger lines on loan kontos. */
export function loanMovesFromLedger(lines: readonly (CardLine & { id: string; src?: string })[], kontoName: (k: string) => string = () => ''): LoanMove[] {
  const out: LoanMove[] = [];
  for (const l of lines) {
    if (l.kind === 'close') continue;
    const dir = loanKontoDir(l.account, kontoName(l.account));
    if (!dir) continue;
    const d = +l.debit || 0, p = +l.credit || 0;
    if (!d && !p) continue;
    const kind = dir === 'given' ? (d > 0 ? 'out' : 'back') : (p > 0 ? 'out' : 'back');
    out.push({ id: l.id, date: l.date, partnerId: l.partnerId || '', dir, kind, amt: Math.abs(d || p), konto: String(l.account), desc: [l.description, l.note].filter(Boolean).join(' – '), src: l.src || 'Налог' });
  }
  return out;
}

/**
 * Legacy `lnBankRows` 16690: money TO the partner first repays a received loan, the excess is a new GIVEN loan;
 * money FROM the partner first repays a given loan, the excess is a new RECEIVED loan (per partner, in date order).
 */
export function loanFlows(moves: readonly LoanMove[]): LoanMove[] {
  const R = [...moves].sort((a, c) => String(a.date).localeCompare(String(c.date)));
  const G: Record<string, number> = {}, Rc: Record<string, number> = {};
  const out: LoanMove[] = [];
  for (const r of R) {
    const pk = r.partnerId || '~' + r.desc;
    const toP = (r.dir === 'given' && r.kind === 'out') || (r.dir === 'received' && r.kind === 'back');
    const [openM, newDir, backDir] = toP ? [Rc, 'given', 'received'] as const : [G, 'received', 'given'] as const;
    const newM = toP ? G : Rc;
    const open = Math.max(0, openM[pk] || 0);
    const rep = r2(Math.min(open, r.amt)), ex = r2(r.amt - rep);
    if (rep > 0.5) { openM[pk] = r2(open - rep); out.push({ ...r, dir: backDir, kind: 'back', amt: rep }); }
    if (ex > 0.5) { newM[pk] = r2((newM[pk] || 0) + ex); out.push({ ...r, id: rep > 0.5 ? r.id + ':x' : r.id, dir: newDir, kind: 'out', amt: ex }); }
  }
  return out;
}

export interface LoanContract { id: string; dir: LoanDir; partnerId: string | null; date: string; amount: number; rate: number; termDate?: string | null; signed?: boolean; hasFile?: boolean; moveIds?: readonly string[] }
export interface LoanStateRow<T extends LoanContract> { l: T; rep: number; bal: number; int: number; over: boolean; noSig: boolean }

const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5));

/** Legacy `lnState` 16697: repayments per partner applied FIFO over the contracts; open balance, interest to date, overdue, unsigned; moves without a contract. */
export function loanState<T extends LoanContract>(loans: readonly T[], flows: readonly LoanMove[], today: string, ignored: ReadonlySet<string> = new Set()) {
  const linked = new Set(loans.flatMap((l) => l.moveIds ?? []));
  const unlinked = flows.filter((r) => r.kind === 'out' && !linked.has(r.id) && !ignored.has(r.id));
  const rows: LoanStateRow<T>[] = loans.map((l) => ({ l, rep: 0, bal: 0, int: 0, over: false, noSig: false }));
  const back = (l: T) => r2(flows.filter((r) => r.kind === 'back' && r.dir === l.dir && r.partnerId && r.partnerId === l.partnerId && r.date >= l.date).reduce((s, r) => s + r.amt, 0));
  const byP = new Map<string, LoanStateRow<T>[]>();
  for (const r of rows) { const k = r.l.dir + '|' + r.l.partnerId; byP.set(k, [...(byP.get(k) ?? []), r]); }
  for (const G of byP.values()) {
    G.sort((a, c) => String(a.l.date).localeCompare(String(c.l.date)));
    let pool = G.length ? back(G[0]!.l) : 0;
    for (const r of G) {
      const a = +r.l.amount || 0;
      const take = Math.min(a, pool);
      r.rep = r2(take); pool = r2(pool - take); r.bal = r2(a - take);
      const ir = +r.l.rate || 0;
      r.int = ir && r.bal > 0 ? r2(r.bal * ir / 100 * days(r.l.date, today) / 365) : 0;
      r.over = !!r.l.termDate && r.l.termDate < today && r.bal > 0.5;
      r.noSig = !r.l.signed && !r.l.hasFile;
    }
  }
  return { rows, unlinked };
}

/** Legacy `lnNextNo` 16716: next `n/yyyy`. */
export function nextLoanNo(existing: readonly { no?: string | null; date: string }[], y: string): string {
  const n = existing.filter((l) => String(l.date).startsWith(y)).map((l) => parseInt(String(l.no || '').split('/')[0]!) || 0);
  return (Math.max(0, ...n) + 1) + '/' + y;
}

/* ================================================================== card reconciliation */

export interface TheirRow { date: string; doc: string; desc: string; debit: number; credit: number; prior?: boolean }
export interface OurRow { i: number; date: string; doc: string; label: string; keys: InvKey[]; amt: number; k: string; open: boolean }
export interface RecPair { o: Pick<OurRow, 'date' | 'doc' | 'amt'>; t: TheirRow & { amt: number }; how: string }
export interface RecDiff { o: Pick<OurRow, 'date' | 'doc' | 'amt'>; t: TheirRow & { amt: number }; diff: number }
export interface RecResult { pairs: RecPair[]; adiff: RecDiff[]; onlyO: OurRow[]; onlyT: (TheirRow & { amt: number; i: number })[]; open: OurRow[] }

/** Legacy `recKeys` 12910: document-number keys in a text. */
export const recKeys = (t: unknown): InvKey[] => (String(t || '').match(/\d+(?:[/\-.]\d+)*/g) || []).map((x) => bmKey(x)).filter((k): k is InvKey => !!k && k.n > 0);

/** Our card rows (legacy `recOurs` 12913): amount debit − credit, keys from doc / description. */
export function ourRecRows(lines: readonly CardLine[]): OurRow[] {
  return lines.map((l, i) => ({
    i, date: l.date, doc: String(l.doc || l.number || ''), label: String(l.description || ''), keys: [...recKeys(l.doc), ...recKeys(l.description), ...recKeys(l.note)],
    amt: r2(amt(l)), k: String(l.account), open: l.kind === 'open',
  }));
}

/** Legacy `recAggPrior` 12916: their rows before our period → one „пренесено салдо“ row (when we have an opening balance). */
export function aggregatePrior(rows: readonly TheirRow[], from: string, hasOpen: boolean): TheirRow[] {
  if (!hasOpen) return [...rows];
  const pre = rows.filter((r) => r.date && r.date < from), rest = rows.filter((r) => !(r.date && r.date < from));
  if (!pre.length) return [...rows];
  const d = r2(pre.reduce((a, r) => a + r.debit, 0)), c = r2(pre.reduce((a, r) => a + r.credit, 0));
  return [{ date: from, doc: '', desc: 'Пренесено салдо од претходни години (' + pre.length + ' ставки кај комитентот)', debit: d > c ? r2(d - c) : 0, credit: c > d ? r2(c - d) : 0, prior: true }, ...rest];
}

/** Legacy `recMatch` 12923: number + amount, amount + date (≤ 20 days), unique amount, same number different amount, opening ↔ carried balance. */
export function recMatch(ours: readonly OurRow[], theirs: readonly TheirRow[]): RecResult {
  const T = theirs.map((x, i) => ({ ...x, i, amt: r2(x.credit - x.debit), keys: [...recKeys(x.doc), ...recKeys(x.desc)] }));
  const usedO = new Set<number>(), usedT = new Set<number>();
  const pairs: RecPair[] = [], adiff: RecDiff[] = [];
  const dd = (a: string, b: string) => Math.abs((Date.parse(a) || 0) - (Date.parse(b) || 0)) / 864e5;
  const kEq = (a: InvKey[], b: InvKey[]) => a.some((x) => b.some((y) => bmEq(x, y, true)));
  const strip = (t: (typeof T)[number]) => { const { keys: _k, ...rest } = t; return rest; };
  for (const o of ours) {
    if (o.open) continue;
    const t = T.find((t) => !usedT.has(t.i) && Math.abs(t.amt - o.amt) < 0.01 && o.keys.length && t.keys.length && kEq(o.keys, t.keys));
    if (t) { usedO.add(o.i); usedT.add(t.i); pairs.push({ o, t: strip(t), how: 'број + износ' }); }
  }
  for (const o of ours) {
    if (o.open || usedO.has(o.i)) continue;
    const C = T.filter((t) => !usedT.has(t.i) && Math.abs(t.amt - o.amt) < 0.01 && dd(t.date, o.date) <= 20).sort((a, b) => dd(a.date, o.date) - dd(b.date, o.date));
    if (C[0]) { usedO.add(o.i); usedT.add(C[0].i); pairs.push({ o, t: strip(C[0]), how: 'износ + датум' }); }
  }
  for (const o of ours) {
    if (o.open || usedO.has(o.i)) continue;
    const C = T.filter((t) => !usedT.has(t.i) && Math.abs(t.amt - o.amt) < 0.01);
    if (C.length === 1) { usedO.add(o.i); usedT.add(C[0]!.i); pairs.push({ o, t: strip(C[0]!), how: 'износ (друг датум)' }); }
  }
  for (const o of ours) {
    if (o.open || usedO.has(o.i) || !o.keys.length) continue;
    const t = T.find((t) => !usedT.has(t.i) && t.keys.length && kEq(o.keys, t.keys) && Math.sign(t.amt) === Math.sign(o.amt));
    if (t) { usedO.add(o.i); usedT.add(t.i); adiff.push({ o, t: strip(t), diff: r2(o.amt - t.amt) }); }
  }
  {
    const op = ours.filter((o) => o.open);
    const sO = r2(op.reduce((a, o) => a + o.amt, 0));
    const pr = T.find((t) => t.prior && !usedT.has(t.i));
    if (op.length && pr) {
      usedT.add(pr.i);
      const o = { date: op[0]!.date, doc: 'Почетна состојба', amt: sO };
      if (Math.abs(pr.amt - sO) < 0.01) pairs.push({ o, t: strip(pr), how: 'пренесено салдо' });
      else adiff.push({ o, t: { ...strip(pr), doc: 'Пренесено салдо' }, diff: r2(sO - pr.amt) });
    }
  }
  return { pairs, adiff, onlyO: ours.filter((o) => !o.open && !usedO.has(o.i)), onlyT: T.filter((t) => !usedT.has(t.i)).map(strip), open: ours.filter((o) => o.open) };
}

/** Saldos of a reconciliation (legacy `recSums` 13704): ours, theirs mirrored, difference, all matched. */
export function recSums(ours: readonly OurRow[], theirs: readonly TheirRow[], opening: number, M: RecResult) {
  const sO = r2(ours.reduce((a, o) => a + o.amt, 0));
  const sT = r2(theirs.reduce((a, t) => a + t.credit - t.debit, 0) - (+opening || 0));
  return { sO, sT, dif: r2(sO - sT), ok: Math.abs(sO - sT) < 0.01 && !M.onlyO.length && !M.onlyT.length && !M.adiff.length };
}

/** Card table (Excel / CSV rows) → rows (legacy `recParse` table part 12918); `null` when the columns are not recognised. */
export function parseCardTable(rows: readonly unknown[][]): { rows: TheirRow[]; opening: number } | null {
  const hi = findHeaderRow(rows as unknown[][]);
  if (hi < 0) return null;
  const hd = (rows[hi] ?? []).map((x) => String(x ?? '').toLowerCase());
  const f = (re: RegExp) => hd.findIndex((x) => re.test(x));
  const iD = f(/дат|date/), iDoc = f(/документ|бр\.|број|фактур|doc|nr|содржина/), iDs = f(/опис|содржина|desc|намена/);
  const iDe = f(/должи|задолж|debit|duguje/), iCr = f(/побарув|раздолж|credit|potražuje|potrazuje/);
  if (iD < 0 || (iDe < 0 && iCr < 0)) return null;
  const out = rows.slice(hi + 1).filter((r) => parseBankDate(r[iD])).map((r) => ({
    date: parseBankDate(r[iD]), doc: iDoc >= 0 ? String(r[iDoc] ?? '') : '', desc: iDs >= 0 ? String(r[iDs] ?? '') : '',
    debit: iDe >= 0 ? r2(parseBankAmount(r[iDe])) : 0, credit: iCr >= 0 ? r2(parseBankAmount(r[iCr])) : 0,
  })).filter((r) => r.debit || r.credit);
  return { rows: out, opening: 0 };
}

const RF_OPEN = /почет|пренос|салдо од|состојба на|opening|initial|prenos/i;

/**
 * Legacy `rfRun` (v431, 13785): two arbitrary cards; only the common period is compared, opening / carried rows and
 * rows before the period form the opening saldo, direction (mirror) picked automatically unless `mirror` is given.
 */
export function compareCards(a: readonly TheirRow[], b: readonly TheirRow[], mirror?: boolean) {
  const isOpen = (r: TheirRow) => RF_OPEN.test(String(r.desc || '') + ' ' + String(r.doc || ''));
  const oA = a.filter(isOpen), oB = b.filter(isOpen), A0 = a.filter((r) => !isOpen(r)), B0 = b.filter((r) => !isOpen(r));
  const range = (rows: readonly TheirRow[]) => { const d = rows.map((r) => r.date).filter(Boolean).sort(); return d.length ? { from: d[0]!, to: d[d.length - 1]! } : null; };
  const rA = range(A0), rB = range(B0);
  if (!rA || !rB) return null;
  const from = rA.from > rB.from ? rA.from : rB.from, to = rA.to < rB.to ? rA.to : rB.to;
  const inP = (r: TheirRow) => r.date >= from && r.date <= to;
  const net = (rows: readonly TheirRow[]) => rows.reduce((s, r) => s + (+r.debit || 0) - (+r.credit || 0), 0);
  const preA = r2(net(A0.filter((r) => r.date < from)) + net(oA));
  const preB0 = r2(net(B0.filter((r) => r.date < from)) + net(oB));
  const ours: OurRow[] = A0.filter(inP).map((x, i) => ({ i, date: x.date, doc: x.doc, label: x.desc || '', keys: [...recKeys(x.doc), ...recKeys(x.desc)], amt: r2((+x.debit || 0) - (+x.credit || 0)), k: '', open: false }));
  const Bp = B0.filter(inP);
  const run = (mir: boolean) => { const B = mir ? Bp : Bp.map((x) => ({ ...x, debit: x.credit, credit: x.debit })); return { B, M: recMatch(ours, B) }; };
  let mir = mirror;
  if (mir == null) { const x1 = run(true), x2 = run(false); mir = !(x2.M.pairs.length > x1.M.pairs.length); }
  const { B, M } = run(mir);
  const preB = mir ? r2(-preB0) : preB0;
  return {
    from, to, rA, rB, mirror: mir, auto: mirror == null, M, preA, preB, preDif: r2(preA - preB),
    outA: A0.filter((r) => !inP(r)).length, outB: B0.filter((r) => !inP(r)).length,
    sA: r2(ours.reduce((s, o) => s + o.amt, 0) + preA), sB: r2(B.reduce((s, t) => s + t.credit - t.debit, 0) + preB),
  };
}

/* ================================================================== custom posting schemes */

export interface CustomSchemeRow { k: string; s: 'd' | 'p'; v: number; n?: string }
export interface CustomScheme { id: string; name: string; rows: CustomSchemeRow[] }

/** Legacy `schSaveAll` check: debit % = credit % and > 0. */
export function customSchemeBalanced(c: Pick<CustomScheme, 'rows'>): boolean {
  const d = c.rows.filter((r) => r.s === 'd').reduce((a, r) => a + (+r.v || 0), 0);
  const p = c.rows.filter((r) => r.s === 'p').reduce((a, r) => a + (+r.v || 0), 0);
  return Math.abs(d - p) < 0.001 && d > 0;
}
/** Legacy `custApply` 5212: journal rows for an amount (each row = % of the amount). */
export function applyCustomScheme(c: Pick<CustomScheme, 'rows'>, amount: number) {
  return c.rows.filter((r) => r.k && +r.v).map((r) => {
    const v = r2(amount * (+r.v) / 100);
    return { account: r.k, debit: r.s === 'd' ? v : 0, credit: r.s === 'p' ? v : 0, note: r.n || '' };
  });
}

/* ================================================================== e-invoice preparation */

/** Legacy `efCheck` 15204: buyer data problems (EDB 13 digits, address, city). */
export function einvoiceBuyerProblems(p: { edb?: string | null; address?: string | null; city?: string | null }): string[] {
  const E: string[] = [];
  const e = String(p.edb || '').replace(/\D/g, '');
  if (!e) E.push('нема ЕДБ'); else if (e.length !== 13) E.push('ЕДБ не е 13 цифри');
  if (!p.address) E.push('нема адреса');
  if (!p.city) E.push('нема град');
  return E;
}
/** Legacy `EF_ST`. */
export const EF_STATUS: Record<string, [string, string]> = { no: ['Не е почнато', ''], test: ['Регистрирана во тест', 'warn'], ok: ['Тестирано – подготвена', 'info'], prod: ['Во продукција', 'good'] };
