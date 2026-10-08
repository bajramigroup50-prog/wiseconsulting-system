/**
 * Ledger — pure logic for the persisted double-entry books (Phase 2).
 *
 * Ported from legacy/index.html (final patched versions, see docs/LEGACY-MAP.md "Phase 2"):
 *   balances 3600, sumPref 3601, bbRows 6650→13619, kkData 6679 (+ kkTable 12823),
 *   NAL_DEF 3478, nalCode 3479, bankNalCode 3480, nalPer 3482, nalogMap 3483 / nalogList 3511,
 *   closeYear 6732, openYear 6744 + obResK/obResLines 12386–12389,
 *   parseAmount 4745, obDig/obN/obMatch 10620–10622, obSheet 10626, obDropSums 10659, importOpen 10670, obRes 10688.
 *
 * In legacy the ledger was recomputed from documents on every render; here the caller passes
 * journal lines that were persisted at posting time (`journal_lines`), so everything below is
 * a pure function of those lines. Money is kept as numbers rounded with `r2` at every sum.
 *
 * Fix-on-purpose notes are marked `FIX(#n)` with the item number of LEGACY-MAP §2.4
 * (or `FIX(P8 #n)` for §8.4).
 */
import { r2 } from './money';

/* ------------------------------------------------------------------ */
/* Lines & accounts                                                    */
/* ------------------------------------------------------------------ */

/** One persisted ledger line (a `journal_lines` row joined with its journal header). */
export interface LedgerLine {
  account: string;
  debit: number;
  credit: number;
  date: string;
  partnerId?: string | null;
  /** Journal source document type (`bank_statement`, `cash_voucher`, `invoice`, …), null for manual journals. */
  sourceType?: string | null;
  /** Journal kind (`open`, `close`, `bbimp`, `manual`, `izlez`, …). */
  kind?: string | null;
  journalId?: string;
  number?: string | null;
  description?: string | null;
  note?: string | null;
  doc?: string | null;
  lineNo?: number;
}

/**
 * Accounts that must carry a partner (customers 120–128, suppliers 220–228) — legacy `BKPK_RE` 12409.
 * FIX(#6): legacy required a partner on `12[0-8]|22[0-8]` but broke balances down by partner on any
 * `12…`/`22…` (anRows, ios, openYear). One predicate is now used for both the requirement and the
 * per-partner breakdown (carry-forward), so 129x/229x are never silently split by partner.
 */
export const PARTNER_ACCOUNT_RE = /^(12[0-8]|22[0-8])/;
export const needsPartner = (account: string): boolean => PARTNER_ACCOUNT_RE.test(String(account));

/** Codes in the built-in chart have 2–10 digits; user-created accounts 3–8 digits (legacy saveAcc/saveOpen). */
export const ACCOUNT_CODE_RE = /^\d{2,10}$/;
export const NEW_ACCOUNT_CODE_RE = /^\d{3,8}$/;

/** Legacy `KONTO` 3167: parse `KONTO_SRC` (`konto|name` per line). */
export function parseKontoSrc(src: string): [string, string][] {
  return src.split('\n').filter((l) => l.includes('|')).map((l) => {
    const x = l.indexOf('|');
    return [l.slice(0, x).trim(), l.slice(x + 1).trim()];
  });
}

/** Account classes (legacy `CLS` 6648). */
export const CLS = [
  '0 Нетековни средства', '1 Парични средства и побарувања', '2 Обврски', '3 Залихи на суровини и материјали',
  '4 Трошоци и расходи', '5 —', '6 Производство, готови производи и стоки', '7 Приходи и трошоци на продажба',
  '8 Резултат', '9 Капитал',
] as const;

/** Trial-balance levels (legacy `BB_LV` 6649). */
export const BB_LEVELS = [['1', 'Класи'], ['2', 'Групи'], ['3', 'Синтетики'], ['4', 'Синтетики (4)'], ['5', 'Синтетики (5)'], ['a', 'Аналитики']] as const;
export type BbLevel = (typeof BB_LEVELS)[number][0];

const sortLines = (L: readonly LedgerLine[]): LedgerLine[] =>
  L.map((l, i) => [l, i] as const)
    .sort(([a, i], [b, j]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : i - j))
    .map(([l]) => l);

/* ------------------------------------------------------------------ */
/* Balances                                                            */
/* ------------------------------------------------------------------ */

export interface Balance { d: number; p: number; s: number }

/** Legacy `balances` 3600: per-account debit / credit / saldo (d − p). */
export function balances(L: Iterable<Pick<LedgerLine, 'account' | 'debit' | 'credit'>>): Record<string, Balance> {
  const by: Record<string, Balance> = {};
  for (const l of L) {
    const o = (by[l.account] ??= { d: 0, p: 0, s: 0 });
    o.d += +l.debit || 0;
    o.p += +l.credit || 0;
  }
  for (const o of Object.values(by)) { o.d = r2(o.d); o.p = r2(o.p); o.s = r2(o.d - o.p); }
  return by;
}

/** Legacy `sumPref` 3601: sum of saldos over account prefixes; `!prefix` excludes. */
export function sumPref(B: Record<string, Balance>, prefs: readonly string[], sign = 1): number {
  const inc = prefs.filter((p) => p[0] !== '!');
  const exc = prefs.filter((p) => p[0] === '!').map((p) => p.slice(1));
  return r2(Object.entries(B)
    .filter(([k]) => inc.some((p) => k.startsWith(p)) && !exc.some((p) => k.startsWith(p)))
    .reduce((s, [, v]) => s + v.s * sign, 0));
}

/* ------------------------------------------------------------------ */
/* Trial balance (бруто биланс)                                        */
/* ------------------------------------------------------------------ */

export interface TbRow {
  /** Account / class / group prefix, or partner id when `byPartnerOf` is set ('' = without partner). */
  k: string;
  name: string;
  /** Opening (почетна состојба) debit / credit. */
  od: number; op: number;
  /** Turnover in the period. */
  td: number; tp: number;
  /** Totals and saldo. */
  vd: number; vp: number; s: number;
}

export interface TrialBalanceOpts {
  level: BbLevel;
  from: string;
  to: string;
  /** Include the year-end closing journal (`kind = close`). Legacy checkbox „со налогот за затворање“. */
  withClose?: boolean;
  /** Only lines of this partner. */
  partnerId?: string | null;
  /** Break one account down by partner (legacy `byPart`). */
  byPartnerOf?: string | null;
  accountName?: (k: string) => string | undefined;
  partnerName?: (id: string) => string | undefined;
}

export interface TrialBalance {
  rows: TbRow[];
  total: Omit<TbRow, 'k' | 'name'>;
  balanced: boolean;
  /**
   * FIX(#12): legacy counted an imported full-year trial balance (`bbimp`) as ordinary turnover,
   * which double-counts when the same year also has real documents. The posting service now refuses
   * a `bbimp` journal in a year that already has turnover; this flag reports old/mixed data.
   */
  bbimpMixed: boolean;
}

/** Opening columns come only from the opening journal (legacy 6651: `kind === 'open'`). */
export const OPENING_KINDS: ReadonlySet<string> = new Set(['open']);
/** Kinds that are not "real" turnover for the bbimp-mix check. */
const NON_TURNOVER = new Set(['open', 'close', 'bbimp']);

/** Legacy `bbRows(lvl, from, to, withClose, pf, byPart)` 6650 (final wrapper 13619 only caches args). */
export function trialBalance(lines: readonly LedgerLine[], o: TrialBalanceOpts): TrialBalance {
  const by: Record<string, { k: string; od: number; op: number; td: number; tp: number }> = {};
  let hasBbimp = false, hasTurnover = false;
  for (const l of lines) {
    if (!o.withClose && l.kind === 'close') continue;
    if (l.date < o.from || l.date > o.to) continue;
    if (o.partnerId && (l.partnerId ?? '') !== o.partnerId) continue;
    if (o.byPartnerOf && String(l.account) !== String(o.byPartnerOf)) continue;
    if (l.kind === 'bbimp') hasBbimp = true;
    else if (!NON_TURNOVER.has(l.kind ?? '')) hasTurnover = true;
    const key = o.byPartnerOf ? (l.partnerId ?? '') : o.level === 'a' ? l.account : l.account.slice(0, +o.level);
    const x = (by[key] ??= { k: key, od: 0, op: 0, td: 0, tp: 0 });
    if (OPENING_KINDS.has(l.kind ?? '')) { x.od += +l.debit || 0; x.op += +l.credit || 0; } else { x.td += +l.debit || 0; x.tp += +l.credit || 0; }
  }
  const name = (k: string): string => {
    if (o.byPartnerOf) return k ? (o.partnerName?.(k) ?? k) : '(без комитент)';
    if (o.level === '1') return (CLS[+k as 0] ?? '').slice(2);
    return o.accountName?.(k) ?? '';
  };
  const rows = Object.values(by).map((x) => {
    const vd = r2(x.od + x.td), vp = r2(x.op + x.tp);
    return { k: x.k, name: name(x.k), od: r2(x.od), op: r2(x.op), td: r2(x.td), tp: r2(x.tp), vd, vp, s: r2(vd - vp) };
  }).filter((r) => r.vd || r.vp)
    .sort((a, b) => (o.byPartnerOf ? String(a.name).localeCompare(String(b.name), 'mk') : a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const total = tbTotal(rows);
  return { rows, total, balanced: Math.abs(total.vd - total.vp) < 0.01, bbimpMixed: hasBbimp && hasTurnover };
}

/** Column totals (legacy `bbTable` `tot`). */
export function tbTotal(rows: readonly TbRow[]): Omit<TbRow, 'k' | 'name'> {
  const sum = (f: keyof Omit<TbRow, 'k' | 'name'>) => r2(rows.reduce((s, r) => s + r[f], 0));
  return { od: sum('od'), op: sum('op'), td: sum('td'), tp: sum('tp'), vd: sum('vd'), vp: sum('vp'), s: sum('s') };
}

/* ------------------------------------------------------------------ */
/* Account card (аналитичка картица по конто)                          */
/* ------------------------------------------------------------------ */

export interface AccountCardOpts {
  account: string;
  /** Include sub-accounts (all accounts starting with `account`). */
  sub?: boolean;
  partnerId?: string | null;
  /** Only lines without a partner. */
  noPartner?: boolean;
  from: string;
  to: string;
}

export interface AccountCard {
  account: string;
  from: string;
  to: string;
  /** Saldo before `from` (within the lines given — the caller passes one business year). */
  opening: number;
  rows: { line: LedgerLine; balance: number }[];
  debit: number;
  credit: number;
  closing: number;
}

/** Legacy `kkData` 6679. */
export function accountCard(lines: readonly LedgerLine[], o: AccountCardOpts): AccountCard {
  const k = String(o.account).trim();
  const L = sortLines(lines)
    .filter((l) => (o.sub ? String(l.account).startsWith(k) : String(l.account) === k))
    .filter((l) => (o.noPartner ? !l.partnerId : !o.partnerId || l.partnerId === o.partnerId));
  const pre = L.filter((l) => l.date < o.from);
  const R = L.filter((l) => l.date >= o.from && l.date <= o.to);
  const opening = r2(pre.reduce((a, l) => a + (+l.debit || 0) - (+l.credit || 0), 0));
  let s = opening;
  const rows = R.map((line) => { s = r2(s + (+line.debit || 0) - (+line.credit || 0)); return { line, balance: s }; });
  const debit = r2(R.reduce((a, l) => a + (+l.debit || 0), 0));
  const credit = r2(R.reduce((a, l) => a + (+l.credit || 0), 0));
  return { account: k, from: o.from, to: o.to, opening, rows, debit, credit, closing: r2(opening + debit - credit) };
}

/* ------------------------------------------------------------------ */
/* Journal numbering (налози)                                          */
/* ------------------------------------------------------------------ */

/** Default nalog codes / titles per type (legacy `NAL_DEF` 3478). */
export const NAL_DEF = {
  izlez: ['1', 'ИЗЛЕЗНИ ФАКТУРИ'],
  vlez: ['2', 'ВЛЕЗНИ ФАКТУРИ'],
  vlezDev: ['22', 'ВЛЕЗНИ ДЕВИЗНИ ФАКТУРИ'],
  kasa: ['1020', 'БЛАГАЈНА'],
  plati: ['12', 'ПЛАТА'],
  zaliha: ['3', 'ЗАЛИХИ'],
  amort: ['43', 'АМОРТИЗАЦИЈА'],
  kamata: ['5', 'КАМАТИ'],
  ddv: ['4', 'ДДВ ПРИЈАВА'],
  open: ['0', 'ПОЧЕТНА СОСТОЈБА'],
  close: ['999', 'ЗАТВОРАЊЕ'],
  pdd: ['13', 'ЗАКУПНИНА, БОНУСИ, УСЛУГИ'],
  odobr: ['14', 'ОДОБРЕНИЈА И ПОВРАТНИЦИ – КУПУВАЧИ'],
  povrat: ['15', 'ОДОБРЕНИЈА И ПОВРАТНИЦИ – ДОБАВУВАЧИ'],
  komp: ['16', 'КОМПЕНЗАЦИИ'],
} as const satisfies Record<string, readonly [string, string]>;
export type NalDefKey = keyof typeof NAL_DEF;

/**
 * Journal kinds understood by the numbering.
 * - NAL_DEF keys are numbered per period: `code/m1-m2` (e.g. `2/1-3`), shared by every journal of that type in the period.
 * - `bank` — per bank account and period, code from {@link bankNalCode}.
 * - `mpin` — numbered like payroll (`plati`).
 * - `open` / `close` — just the code (`0`, `999`).
 * - anything else (`manual`, `bbimp`, `kauc`, fiscal period, transfer, levelling…) — a counter (1021, 1022, …).
 */
export type JournalKind = NalDefKey | 'bank' | 'mpin' | 'manual' | 'bbimp' | (string & {});

export interface NalogBank { id: string; name?: string; cur?: string | null; nal?: string | null }

/** Per-firm numbering settings (legacy firm fields, stored in `firms.settings`). */
export interface NalogSettings {
  nalCodes?: Partial<Record<NalDefKey, string>>;
  /** `period` (default): by type and period; `doc`: every journal its own sequential number. */
  nalogMode?: 'period' | 'doc';
  nalogPer?: 'quarter' | 'month';
  nalPayPer?: 'month' | 'year';
  banks?: readonly NalogBank[];
}

/** Legacy `nalCode` 3479. */
export const nalCode = (k: NalDefKey, s: NalogSettings = {}): string => s.nalCodes?.[k] || NAL_DEF[k][0];

/** Legacy `bankNalCode` 3480: explicit `nal`, else 6/66/666… (MKD accounts) or 7/77/777… (FX accounts) by position. */
export function bankNalCode(acct: string | null | undefined, banks: readonly NalogBank[] = []): string {
  const B = banks.length ? banks : [{ id: 'main' }];
  const b0 = B.find((b) => b.id === (acct || 'main')) ?? B[0]!;
  if (b0.nal) return b0.nal;
  const fx = (x: NalogBank) => (x.cur || 'MKD') !== 'MKD';
  const same = B.filter((x) => fx(x) === fx(b0));
  const i = Math.max(0, same.indexOf(b0));
  return (fx(b0) ? '7' : '6').repeat(i + 1);
}

/** Legacy `nalPer` 3482: month range of the period containing `date`. */
export function nalPer(date: string, per: 'quarter' | 'month' = 'quarter'): [number, number] {
  const m = +String(date).slice(5, 7) || 1;
  if (per === 'month') return [m, m];
  const q = Math.ceil(m / 3);
  return [q * 3 - 2, q * 3];
}

export interface NalogNumberInput {
  kind: JournalKind;
  date: string;
  settings?: NalogSettings;
  /** For `bank`: the firm bank-account id (legacy `acct`). */
  bankAccountId?: string | null;
  /** For `plati` / `mpin`: payroll month 1–12 (defaults to the month of `date`). */
  payMonth?: number;
  /** For `ddv`: the firm's VAT period (`firms.vat_period`). */
  vatPeriod?: 'quarter' | 'month';
}

export interface NalogNumber {
  /** Final number (`2/1-3`, `0`, `999`), or `null` when a counter must be allocated. */
  no: string | null;
  code: string | null;
  range: [number, number] | null;
  /** Nalog title (legacy `desc`). */
  title: string;
}

/**
 * Number for a journal (legacy `nalogMap` 3483, period mode, one journal at a time).
 * FIX(#10): legacy recomputed numbers from the whole ledger on every render, so a back-dated
 * document renumbered every manual nalog after it until someone "froze" the numbers. Here the number
 * is computed once at posting time and persisted in `journals.number` — it never changes afterwards.
 */
export function nalogNumber(i: NalogNumberInput): NalogNumber {
  const s = i.settings ?? {};
  const counter = (title: string): NalogNumber => ({ no: null, code: null, range: null, title });
  if (s.nalogMode === 'doc') return counter(titleFor(i.kind));
  const per = s.nalogPer ?? 'quarter';
  const ranged = (code: string, range: [number, number], title: string): NalogNumber =>
    ({ no: `${code}/${range[0]}-${range[1]}`, code, range, title });
  const k = i.kind;
  if (k === 'open' || k === 'close') {
    const code = nalCode(k as 'open' | 'close', s);
    return { no: code, code, range: null, title: NAL_DEF[k as 'open' | 'close'][1] };
  }
  if (k === 'bank') {
    const code = bankNalCode(i.bankAccountId, s.banks);
    const b = (s.banks ?? []).find((x) => x.id === (i.bankAccountId || 'main'));
    return ranged(code, nalPer(i.date, per), ('ИЗВОДИ ' + (b?.name ?? '')).trim().toUpperCase());
  }
  if (k === 'plati' || k === 'mpin') {
    const y = i.date.slice(0, 4);
    if (s.nalPayPer === 'year') return ranged(nalCode('plati', s), [1, 12], 'ПЛАТИ ' + y);
    const mm = i.payMonth || +i.date.slice(5, 7);
    return ranged(nalCode('plati', s), [mm, mm], 'ПЛАТА ' + String(mm).padStart(2, '0') + '-' + y);
  }
  if (k === 'ddv') return ranged(nalCode('ddv', s), nalPer(i.date, i.vatPeriod ?? 'quarter'), NAL_DEF.ddv[1]);
  if (k in NAL_DEF) return ranged(nalCode(k as NalDefKey, s), nalPer(i.date, per), NAL_DEF[k as NalDefKey][1]);
  return counter(titleFor(k));
}

const titleFor = (k: string): string => (k in NAL_DEF ? NAL_DEF[k as NalDefKey][1] : k === 'bbimp' ? 'БРУТО БИЛАНС' : 'НАЛОГ');

/** First counter used by manual / per-document nalozi in period mode (legacy `man = 1020`, pre-increment). */
export const MANUAL_COUNTER_BASE = 1020;

/**
 * Next free counter number after `base`, skipping every number already used in the year
 * (legacy `do{++man}while(usedN.has(String(man)))`).
 * FIX(#10): legacy only skipped *frozen* numbers, so a manual nalog could get `1020` style overlaps;
 * every number already persisted in the year is skipped here.
 */
export function nextCounter(used: Iterable<string>, base = MANUAL_COUNTER_BASE): string {
  const U = new Set([...used].map(String));
  let n = base;
  do { n++; } while (U.has(String(n)));
  return String(n);
}

export interface NumberableJournal {
  id: string;
  kind: JournalKind;
  date: string;
  /** Explicit / persisted number — kept as is (legacy `nalNo` on manual journals, frozen `firm.nalNo`). */
  number?: string | null;
  bankAccountId?: string | null;
  payMonth?: number;
}

/**
 * Batch numbering of one business year in date order — what legacy `nalogMap` produced.
 * Used by the importer / recompute; the posting service numbers one journal at a time with
 * {@link nalogNumber} + {@link nextCounter}, which gives the same result when journals are posted in date order.
 */
export function assignNumbers(journals: readonly NumberableJournal[], settings: NalogSettings = {}, opts: { vatPeriod?: 'quarter' | 'month' } = {}): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set(journals.map((j) => j.number).filter((n): n is string => !!n));
  const doc = settings.nalogMode === 'doc';
  const sorted = journals.map((j, i) => [j, i] as const).sort(([a, i], [b, j]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : i - j)).map(([j]) => j);
  for (const j of sorted) {
    if (j.number) { out.set(j.id, j.number); continue; }
    const n = nalogNumber({ kind: j.kind, date: j.date, settings, bankAccountId: j.bankAccountId, payMonth: j.payMonth, vatPeriod: opts.vatPeriod });
    const no = n.no ?? nextCounter(used, doc ? 0 : MANUAL_COUNTER_BASE);
    used.add(no);
    out.set(j.id, no);
  }
  return out;
}

export interface NalogGroup<J> { no: string; date: string; journals: J[] }

/**
 * Group journals into nalozi by number (legacy `nalogList` 3511): sorted by the numeric code,
 * then date. Within a business year, journals sharing a period number (e.g. `2/1-3`) form one nalog.
 */
export function groupNalozi<J extends { number: string; date: string }>(journals: readonly J[]): NalogGroup<J>[] {
  const G = new Map<string, NalogGroup<J>>();
  for (const j of journals) {
    const g = G.get(j.number) ?? { no: j.number, date: j.date, journals: [] };
    if (j.date > g.date) g.date = j.date;
    g.journals.push(j);
    G.set(j.number, g);
  }
  const num = (x: string) => parseFloat(x) || 0;
  return [...G.values()].sort((a, b) => num(a.no) - num(b.no) || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no.localeCompare(b.no)));
}

/* ------------------------------------------------------------------ */
/* Close / open year                                                   */
/* ------------------------------------------------------------------ */

export interface PostingLine {
  account: string;
  debit: number;
  credit: number;
  partnerId?: string | null;
  note?: string | null;
}

/**
 * Result accounts — one convention everywhere.
 * FIX(#1, P8 #1, P8 #3): legacy closed to 951/961 but its help texts said 9500/9600 and 2340, `openYear`
 * remapped to 950/960 and `obRebuild` used 800/810. The rebuild uses the 4-digit closing accounts
 * 8000/8100/8200, profit tax on 2330 (2340 is payroll income tax), current-year result on 951/961 and
 * retained result on 950/960 in the next year's opening balance.
 */
export const RESULT_ACCOUNTS = {
  preTax: '8000', tax: '8100', net: '8200', taxPayable: '2330',
  profitYear: '951', lossYear: '961', retainedProfit: '950', carriedLoss: '960',
} as const;

export interface CloseYearOpts {
  /** Profit tax amount (e.g. from the ДБ tax balance, AOP 56). When omitted: `taxRate` × max(0, profit + nondeductible). */
  tax?: number;
  nondeductible?: number;
  taxRate?: number;
}

export interface CloseYearResult { lines: PostingLine[]; profit: number; tax: number; net: number }

/**
 * Legacy `closeYear` 6732: close classes 4 and 7 to 8000, book profit tax (8100 / 2330),
 * carry the result through 8200 to 951 (profit) or 961 (loss). Pass the year's lines; any
 * existing `close` journal lines are ignored.
 */
export function closeYearLines(lines: readonly LedgerLine[], o: CloseYearOpts = {}): CloseYearResult {
  const A = RESULT_ACCOUNTS;
  const B = balances(lines.filter((l) => l.kind !== 'close'));
  const out: PostingLine[] = [];
  let res = 0;
  for (const k of Object.keys(B).sort()) {
    const v = B[k]!;
    if (!(k.startsWith('4') || k.startsWith('7')) || Math.abs(v.s) < 0.005) continue;
    if (v.s > 0) out.push({ account: A.preTax, debit: v.s, credit: 0 }, { account: k, debit: 0, credit: v.s });
    else out.push({ account: k, debit: -v.s, credit: 0 }, { account: A.preTax, debit: 0, credit: -v.s });
    res -= v.s;
  }
  res = r2(res);
  const tax = o.tax != null ? r2(o.tax) : r2(Math.max(0, res + (o.nondeductible ?? 0)) * (o.taxRate ?? 0.1));
  if (res > 0) out.push({ account: A.preTax, debit: res, credit: 0 }, { account: A.net, debit: 0, credit: res });
  else if (res < 0) out.push({ account: A.net, debit: -res, credit: 0 }, { account: A.preTax, debit: 0, credit: -res });
  if (tax) out.push({ account: A.tax, debit: tax, credit: 0 }, { account: A.taxPayable, debit: 0, credit: tax },
    { account: A.net, debit: tax, credit: 0 }, { account: A.tax, debit: 0, credit: tax });
  const net = r2(res - tax);
  if (net > 0) out.push({ account: A.net, debit: net, credit: 0 }, { account: A.profitYear, debit: 0, credit: net });
  else if (net < 0) out.push({ account: A.lossYear, debit: -net, credit: 0 }, { account: A.net, debit: 0, credit: -net });
  return { lines: out, profit: res, tax, net };
}

/**
 * Legacy `obResK` 12386: current-year result → retained result in the new year (951 → 950, 961 → 960).
 * FIX(P8 #2): legacy skipped the remap whenever the UI checkbox `S.obFull` was on, so `openYear`
 * could silently keep 951/961. The remap is now unconditional; callers that import a full-year
 * trial balance (`bbimp`) simply don't call it.
 */
export const resultAccountForOpening = (k: string): string =>
  /^951/.test(k) ? RESULT_ACCOUNTS.retainedProfit : /^961/.test(k) ? RESULT_ACCOUNTS.carriedLoss : String(k);

/** Legacy `obResLines` 12387: remap 951/961 lines, merge them with existing 950/960 lines, net 950/960 to one side. */
export function remapResultAccounts(L: readonly PostingLine[]): PostingLine[] {
  const out: PostingLine[] = [];
  const m: Record<string, PostingLine> = {};
  for (const l0 of L) {
    const k = resultAccountForOpening(l0.account);
    if (k !== String(l0.account) && !l0.partnerId) {
      const ex = m[k];
      if (ex) { ex.debit = r2(ex.debit + l0.debit); ex.credit = r2(ex.credit + l0.credit); continue; }
      const n = { ...l0, account: k };
      m[k] = n;
      out.push(n);
    } else out.push({ ...l0 });
  }
  for (const [k, x] of Object.entries(m)) {
    const ex = out.find((l) => l !== x && l.account === k && !l.partnerId);
    if (ex) { ex.debit = r2(ex.debit + x.debit); ex.credit = r2(ex.credit + x.credit); out.splice(out.indexOf(x), 1); }
  }
  for (const l of out) {
    const n = r2(l.debit - l.credit);
    if (/^9[56]0$/.test(l.account) && l.debit && l.credit) { l.debit = n > 0 ? n : 0; l.credit = n < 0 ? -n : 0; }
  }
  return out;
}

/**
 * Legacy `openYear` 6744: carry the saldos of classes 0, 1, 2, 3, 6 and 9 into the next year's opening
 * balance; partner accounts are carried per partner, then the remainder without partner; 951/961 → 950/960.
 * Pass all lines of the closing year (including its `close` journal).
 */
export function openYearLines(lines: readonly LedgerLine[]): PostingLine[] {
  const B = balances(lines);
  const carried = Object.keys(B).sort()
    .filter((k) => /^[012369]/.test(k) && Math.abs(B[k]!.s) >= 0.005)
    .map((k) => { const s = B[k]!.s; return s > 0 ? { account: k, debit: s, credit: 0 } : { account: k, debit: 0, credit: -s }; });
  const pb = new Map<string, number>();
  for (const l of lines) {
    if (!l.partnerId || !needsPartner(l.account)) continue; // FIX(#6): same predicate as the partner requirement
    const key = l.account + '|' + l.partnerId;
    pb.set(key, (pb.get(key) ?? 0) + (+l.debit || 0) - (+l.credit || 0));
  }
  const out: PostingLine[] = carried.filter((l) => !needsPartner(l.account));
  for (const [key, s] of [...pb.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [k, p] = key.split('|') as [string, string];
    if (!/^[012369]/.test(k)) continue;
    const v = r2(s);
    if (Math.abs(v) < 0.005) continue;
    out.push(v > 0 ? { account: k, debit: v, credit: 0, partnerId: p } : { account: k, debit: 0, credit: -v, partnerId: p });
  }
  for (const l of carried.filter((x) => needsPartner(x.account))) {
    const withP = [...pb.entries()].filter(([key]) => key.startsWith(l.account + '|')).reduce((s, [, v]) => s + v, 0);
    const rest = r2(l.debit - l.credit - withP);
    if (Math.abs(rest) > 0.005) out.push(rest > 0 ? { account: l.account, debit: rest, credit: 0 } : { account: l.account, debit: 0, credit: -rest });
  }
  return remapResultAccounts(out);
}

/* ------------------------------------------------------------------ */
/* Opening balance (почетна состојба)                                  */
/* ------------------------------------------------------------------ */

/** Legacy `parseAmount` 4745: `1.234,56` / `1,234.56` / `1234,5` → number. */
export function parseAmount(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return +s || 0;
}

/** Legacy `obDig` 10620. */
export const digitsOnly = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

/**
 * Legacy `obN` 10621: normalized firm name for matching (drops legal-form words and punctuation).
 * FIX: legacy used `\b…\b`, which is an ASCII-only word boundary in JS, so the Cyrillic legal forms
 * (дооел, доо, ад…) were never stripped and "Алфа ДООЕЛ" did not match "Алфа". Whitespace boundaries are used instead.
 */
export const normalizeName = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/["„“”'.,()]/g, ' ')
    .replace(/(^|\s)(дооел|доо|ад|јтд|тп|увоз-извоз|експорт-импорт|скопје|dooel|doo)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();

export interface MatchablePartner { id: string; name: string; code?: string | null; edb?: string | null; embs?: string | null }

/** Legacy `obMatch` 10622: partner by EDB/EMBS digits, then by code, then by normalized name (prefix match for > 5 chars). */
export function matchPartner(name: string, code: string | null | undefined, P: readonly MatchablePartner[]): string {
  const c = digitsOnly(code);
  if (c.length >= 7) { const x = P.find((p) => digitsOnly(p.edb) === c || digitsOnly(p.embs) === c); if (x) return x.id; }
  if (code) { const x = P.find((p) => p.code && String(p.code).trim() === String(code).trim()); if (x) return x.id; }
  const n = normalizeName(name);
  if (!n) return '';
  const x = P.find((p) => normalizeName(p.name) === n)
    ?? (n.length > 5 ? P.find((p) => { const q = normalizeName(p.name); return q.length > 5 && (q.startsWith(n) || n.startsWith(q)); }) : undefined);
  return x ? x.id : '';
}

/** Parsed sheet row: `[konto, account name, partner name, partner code/EDB, saldo debit, saldo credit]`. */
export type ObRow = [string, string, string, string, number, number];

export interface ParsedSheet { rows: ObRow[]; totals: [string, number, number][]; src: 'excel' | 'csv' }

/** Split CSV text the legacy way (delimiter = whichever of `;`, tab, `,` splits the first line most). */
export function csvToGrid(text: string): string[][] {
  const L = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!L.length) return [];
  const dl = [';', '\t', ','].sort((a, b) => L[0]!.split(b).length - L[0]!.split(a).length)[0]!;
  return L.map((l) => l.split(dl).map((x) => x.replace(/^"|"$/g, '').trim()));
}

/**
 * Legacy `obSheet` 10626 (the effective Excel/CSV parser): finds the header row (konto/сметка),
 * handles a two-row header (Салдо → Должи / Побарува), picks the saldo columns, detects analytic
 * partner rows under an account header and `вкупно` total rows. Input: a 2-D grid from SheetJS
 * (`sheet_to_json(ws, {header: 1})`) or {@link csvToGrid}.
 * FIX(#5): the dead `importOpen` 6342 CSV rules are not ported — only this parser runs.
 */
export function parseOpeningSheet(A: readonly (readonly unknown[])[], src: 'excel' | 'csv' = 'excel'): ParsedSheet | null {
  const low = (r: readonly unknown[] | undefined) => (r ?? []).map((c) => String(c ?? '').toLowerCase());
  let hi = -1;
  for (let i = 0; i < Math.min(A.length, 25); i++) if (low(A[i]).some((c) => /конто|сметка|konto/.test(c))) { hi = i; break; }
  if (hi < 0) {
    /* no header: konto; name; debit; credit */
    const rows: ObRow[] = [];
    for (const c of A) {
      const k = digitsOnly(c[0]);
      if (!/^\d{3,8}$/.test(k) || (String(c[0]).trim() !== k && !/^\s*\d/.test(String(c[0])))) continue;
      let d = parseAmount(c[c.length - 2]), p = parseAmount(c[c.length - 1]);
      if (c.length === 3) { const v = parseAmount(c[2]); d = v > 0 ? v : 0; p = v < 0 ? -v : 0; }
      rows.push([k, String(c[1] ?? ''), '', '', d, p]);
    }
    return rows.length ? { rows, totals: [], src: 'csv' } : null;
  }
  const up = hi > 0 ? low(A[hi - 1]) : [];
  let last = '';
  const upF = up.map((c) => (c ? (last = c) : last));
  const H = low(A[hi]).map((c, i) => ((upF[i] || '') + ' ' + c).trim());
  const H2 = low(A[hi + 1]);
  let start = hi + 1;
  if (H2.some((c) => /^долж|^побар/.test(c)) && !H2.some((c) => /^\d{3,6}$/.test(c))) {
    let l2 = '';
    const hf = low(A[hi]).map((c) => (c ? (l2 = c) : l2));
    for (let i = 0; i < H.length || i < H2.length; i++) H[i] = ((hf[i] || '') + ' ' + (H2[i] || '')).trim();
    start = hi + 2;
  }
  const col = (re: RegExp) => H.findIndex((c) => re.test(c));
  const cK = col(/конто|сметка|konto/), cN = col(/назив на конто|назив|опис/);
  const cP = col(/партнер|комитент|купувач|добавувач|субјект/), cC = col(/шифра на (партнер|комитент)|едб|даночен|шифра/);
  let cD = H.findIndex((c) => /салдо/.test(c) && /долж/.test(c)), cR = H.findIndex((c) => /салдо/.test(c) && /побар/.test(c)), cS = -1;
  if (cD < 0 || cR < 0) {
    const dI = H.map((c, i) => (/долж/.test(c) ? i : -1)).filter((i) => i >= 0);
    const pI = H.map((c, i) => (/побар/.test(c) ? i : -1)).filter((i) => i >= 0);
    if (dI.length && pI.length) { cD = dI[dI.length - 1]!; cR = pI[pI.length - 1]!; } else cS = col(/салдо/);
  }
  if (cK < 0 || (cD < 0 && cS < 0)) return null;
  const rows: ObRow[] = [], totals: [string, number, number][] = [];
  let curK = '';
  for (let i = start; i < A.length; i++) {
    const c = A[i];
    if (!c || !c.length) continue;
    const raw = String(c[cK] ?? '').trim();
    const k = digitsOnly(raw);
    const same = cP >= 0 && cP === cN;
    let pn = cP >= 0 ? String(c[cP] ?? '').trim() : '';
    let nn = cN >= 0 ? String(c[cN] ?? '').trim() : '';
    if (same) { if (k && !/^(12|13|15|16|22|23|25|26)/.test(k)) pn = ''; else if (k) nn = ''; }
    const d = cS >= 0 ? Math.max(0, parseAmount(c[cS])) : parseAmount(c[cD]);
    const p = cS >= 0 ? Math.max(0, -parseAmount(c[cS])) : parseAmount(c[cR]);
    if (/вкупно|збир|сума|total/i.test(raw + ' ' + nn + ' ' + pn)) { if (k) totals.push([k, d, p]); continue; }
    if (/^\d{3,8}$/.test(k)) curK = k;
    else if (!(!k && (pn || nn) && curK)) continue;
    if (!r2(d) && !r2(p)) continue;
    rows.push([k || curK, k ? nn : '', pn || (!k && nn ? nn : ''), cC >= 0 ? String(c[cC] ?? '').trim() : '', d, p]);
  }
  return rows.length ? { rows, totals, src } : null;
}

/** Legacy `obDropSums` 10659: drop synthetic rows that are sums of their sub-accounts / partner rows. */
export function dropSummaryRows(rows: readonly ObRow[]): { rows: ObRow[]; dropped: number } {
  const by: Record<string, ObRow[]> = {};
  for (const r of rows) (by[r[0]] ??= []).push(r);
  const keys = Object.keys(by);
  const drop = new Set<ObRow>();
  for (const k of keys) {
    const kids = keys.filter((x) => x !== k && x.startsWith(k));
    const L = by[k]!;
    if (kids.length && L.length === 1 && !L[0]![2]) {
      const sum = kids.reduce((s, x) => s + by[x]!.reduce((a, r) => a + r[4] - r[5], 0), 0);
      if (Math.abs(sum - (L[0]![4] - L[0]![5])) < 1) drop.add(L[0]!);
    }
    const withP = L.filter((r) => r[2]), noP = L.filter((r) => !r[2]);
    if (withP.length >= 1 && noP.length === 1) {
      const s = withP.reduce((a, r) => a + r[4] - r[5], 0);
      if (Math.abs(s - (noP[0]![4] - noP[0]![5])) < 1) drop.add(noP[0]!);
    }
  }
  return { rows: rows.filter((r) => !drop.has(r)), dropped: drop.size };
}

/** One editable opening-balance row (legacy draft row 6321). */
export interface OpeningRow {
  account: string;
  name: string;
  partnerId: string;
  /** Partner to create on save when not matched (legacy `pname` / `pcode`). */
  partnerName?: string;
  partnerCode?: string;
  debit: number;
  credit: number;
  note?: string;
}

export interface OpeningControl {
  n: number; nP: number; nNew: number; dropped: number; src: string;
  D: number; P: number;
  /** Printed account totals that don't match the parsed rows. */
  bad: { k: string; doc: number; got: number }[];
  chk: number;
  /** Result of the income/expense classes that were left out (negative = profit). */
  res: number;
  byK: { k: string; name: string; n: number; nP: number; d: number; p: number; doc: number | null }[];
}

/**
 * Legacy `importOpen` 10670: turn a parsed sheet into opening rows + a control summary.
 * With `full` (whole-year trial balance for year-end, legacy `S.obFull`) all classes are kept;
 * otherwise classes 4, 5, 7 and 8 are left out and their result is reported in `control.res`.
 */
export function buildOpening(R: ParsedSheet, opts: { full?: boolean; partners?: readonly MatchablePartner[] } = {}): { rows: OpeningRow[]; control: OpeningControl } {
  const ds = dropSummaryRows(R.rows.filter((r) => r2(r[4]) || r2(r[5])));
  let all = ds.rows;
  const resRows = opts.full ? [] : all.filter((r) => /^[4578]/.test(r[0]));
  const res = r2(resRows.reduce((s, r) => s + r[4] - r[5], 0));
  if (!opts.full) all = all.filter((r) => !/^[4578]/.test(r[0]));
  const P = opts.partners ?? [];
  const rows: OpeningRow[] = all.map((r) => {
    const net = r2(r[4] - r[5]);
    const pid = r[2] ? matchPartner(r[2], r[3], P) : '';
    return {
      account: r[0], name: r[1] || '', partnerId: pid,
      ...(r[2] && !pid ? { partnerName: String(r[2]).trim(), partnerCode: r[3] || '' } : {}),
      debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0,
    };
  });
  const byK: Record<string, OpeningControl['byK'][number]> = {};
  for (const r of rows) {
    const x = (byK[r.account] ??= { k: r.account, name: r.name, n: 0, nP: 0, d: 0, p: 0, doc: null });
    x.n++;
    if (r.partnerId || r.partnerName) x.nP++;
    x.d = r2(x.d + r.debit);
    x.p = r2(x.p + r.credit);
  }
  const bad: OpeningControl['bad'] = [];
  let chk = 0;
  for (const [k, d, p] of R.totals) {
    if (/^[4578]/.test(k)) continue;
    const got = r2(rows.filter((r) => r.account.startsWith(k)).reduce((s, r) => s + r.debit - r.credit, 0));
    const doc = r2(d - p);
    chk++;
    if (byK[k]) byK[k].doc = doc;
    if (Math.abs(got - doc) >= 1) bad.push({ k, doc, got });
  }
  const newN = new Set(rows.filter((r) => r.partnerName).map((r) => normalizeName(r.partnerName)));
  return {
    rows,
    control: {
      n: rows.length, nP: rows.filter((r) => r.partnerId || r.partnerName).length, nNew: newN.size,
      dropped: ds.dropped, src: R.src,
      D: r2(all.reduce((s, r) => s + r[4], 0)), P: r2(all.reduce((s, r) => s + r[5], 0)),
      bad, chk, res, byK: Object.values(byK).sort((a, b) => a.k.localeCompare(b.k)),
    },
  };
}

/**
 * Legacy `obRes` 10688: the balancing row for the left-out result (profit → credit 950, loss → debit 960).
 * FIX(#1): same 950/960 convention as {@link openYearLines}.
 */
export function resultBalancingRow(res: number): Pick<OpeningRow, 'account' | 'debit' | 'credit'> | null {
  if (!res) return null;
  const v = Math.abs(r2(res));
  return res < 0 ? { account: RESULT_ACCOUNTS.retainedProfit, debit: 0, credit: v } : { account: RESULT_ACCOUNTS.carriedLoss, debit: v, credit: 0 };
}

/** Totals and balance check of any line list (journal editor footer). */
export function lineTotals(L: Iterable<{ debit?: number | string | null; credit?: number | string | null }>): { D: number; P: number; diff: number; balanced: boolean } {
  let D = 0, P = 0;
  for (const l of L) { D += +(l.debit ?? 0) || 0; P += +(l.credit ?? 0) || 0; }
  D = r2(D); P = r2(P);
  const diff = r2(D - P);
  return { D, P, diff, balanced: Math.abs(diff) < 0.005 };
}
