/**
 * Carry-over of the closed year into the next year's „Почетна состојба“ — konto by konto, partner by partner — and
 * the evidence that compares the closing balances (old year) with the opening journal (new year).
 *
 * Legacy `openYear` 6744 (+ `obResLines` 12386): classes 0, 1, 2, 3, 6, 9 from the closed year (balances INCLUDING the
 * close), 12x/22x split by partner, the rest of those accounts without partner, 951 → 950 / 961 → 960. Kept, and
 * extended (FIX carry-1):
 *  - EVERY account that has lines with a partner is split per partner (loans 033/160–163/260–263/285, 13x, 16x, 23x,
 *    24x, 26x, advances 2270…), not only 12x/22x; the partner-less remainder stays on the account;
 *  - the location / object dimension (`locationId`) is carried where present;
 *  - optional per open document (`doc`) on 12x/22x (`byDoc`, firm setting `carryByDoc`) so open items / ИОС keep
 *    working in the new year;
 *  - an analytic account missing from the chart falls back to its nearest existing parent (synthetic) account,
 *    with the reason in the evidence; an account without any existing parent is not carried (the opening cannot be
 *    posted until it is opened in the chart);
 *  - amounts are summed in integer denar-cents (no float drift).
 * Classes 4, 5, 7 and 8 are not carried (4/7 close to 8000, 8 to 951/961 — Правилник за сметковен план).
 * Statistical (memo) accounts of class 9 that only hold the VAT bases of the period (994x / 999x „Основица за ДДВ“,
 * the scheme's `vbin*` / `vbout*` / `vbimp*` kontos) are not carried either: they are period figures, not balances
 * (prefixes: firm setting `carryStatPrefixes`, default 994 and 999).
 */
import type { YeLine } from './balances';
import { carryForwardAccount } from './close';

/** One posted ledger line of the closed year (all journals, including opening and close). */
export interface CarryLedgerLine {
  account: string;
  debit: number;
  credit: number;
  partnerId?: string | null;
  doc?: string | null;
  locationId?: string | null;
}

/** One line of the opening journal (actual, as posted). */
export type CarryOpenLine = CarryLedgerLine;

export interface CarryOptions {
  /** split 12x/22x partner balances per open document (`doc`) */
  byDoc?: boolean;
  /** accounts that do not exist in the (new year's) chart — the db layer computes this with `missingAccounts` */
  missingAccounts?: ReadonlySet<string> | readonly string[];
  /** partners of the firm that are inactive (carried, with a remark) */
  inactivePartners?: ReadonlySet<string> | readonly string[];
  /** statistical / memo account prefixes that are never carried (default `DEFAULT_CARRY_STAT_PREFIXES`) */
  statPrefixes?: readonly string[];
}

/** Statistical VAT-base accounts (class 9 memo, „Основица за ДДВ“): period figures, never carried. */
export const DEFAULT_CARRY_STAT_PREFIXES: readonly string[] = ['994', '999'];
export const CARRY_STAT_REASON = 'статистичка сметка (основица за ДДВ) – не се пренесува';
/** The account is a statistical (memo) account by one of the prefixes. */
export const carryStatAccount = (account: string, prefixes: readonly string[] = DEFAULT_CARRY_STAT_PREFIXES): boolean =>
  prefixes.some((x) => !!x && String(account).startsWith(x));
/** Clean list of prefixes from user input („994, 999“) — digits only, 2–10 long, unique. */
export function parseCarryStatPrefixes(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[\s,;]+/);
  return [...new Set(list.map((x) => x.trim()).filter((x) => /^\d{2,10}$/.test(x)))].sort();
}

/**
 * Why a balance is not carried by RULE (not an error): the class (4, 5, 7, 8), a statistical account or a zero
 * balance. `null` on rows that are carried or that should be carried but cannot (missing account).
 */
export type CarryRule = 'class' | 'stat' | 'zero';

/** Balance-sheet classes carried into the next year. */
export const CARRY_CLASSES = ['0', '1', '2', '3', '6', '9'] as const;
export const carriedClass = (account: string): boolean => /^[012369]/.test(String(account));

const NOT_CARRIED_REASON: Record<string, string> = {
  '4': 'класа 4 (трошоци) – се затвора на 8000, не се пренесува',
  '5': 'класа 5 – не се пренесува (не е билансна класа)',
  '7': 'класа 7 (приходи и расходи) – се затвора на 8000, не се пренесува',
  '8': 'класа 8 (резултат) – се затвора на 951 / 961, не се пренесува',
};

/** Accounts split per open document when `byDoc` is on. */
export const DOC_SPLIT_RE = /^(12|22)/;

const cents = (v: unknown): number => Math.round((Number(v) || 0) * 100);
const toMoney = (c: number): number => c / 100;
/** document reference as a key part ('|' is the key separator) */
const docOf = (d: unknown): string | null => String(d ?? '').trim().replace(/\|/g, '/') || null;
const keyOf = (account: string, partnerId: string | null, doc: string | null, locationId: string | null) =>
  [account, partnerId ?? '', doc ?? '', locationId ?? ''].join('|');

export interface CarryKey {
  account: string;
  partnerId: string | null;
  doc: string | null;
  locationId: string | null;
}

/** One source balance of the closed year (konto [+ partner [+ document]] [+ location]). */
export interface CarrySourceRow extends CarryKey {
  /** debit − credit at the end of the closed year (including the close) */
  closing: number;
  /** account in the opening journal; null = not carried */
  target: string | null;
  /** remark (carried with a note) or reason (not carried) */
  reason: string;
  /** not carried by rule (class / statistical / zero balance) */
  rule?: CarryRule | null;
}

/** One line of the planned opening journal. */
export interface CarryPlanLine extends CarryKey, YeLine {
  /** source accounts merged into this line (e.g. 951 → 950) */
  sources: string[];
  /** remarks of the sources (fallback, inactive partner, 951 → 950 …) */
  notes: string[];
}

export interface CarryPlan {
  rows: CarrySourceRow[];
  lines: CarryPlanLine[];
  /** sum of debits / credits of the planned opening */
  debit: number;
  credit: number;
  /** accounts with a balance that cannot be carried because neither they nor a parent exist in the chart */
  blocked: string[];
}

/** Partner-carrying split: an account is split per partner when ANY of its lines has a partner. */
function sourceRows(lines: readonly CarryLedgerLine[], byDoc: boolean): { rows: Map<string, CarryKey & { c: number }>; turnover: Set<string> } {
  const withPartner = new Set<string>();
  for (const l of lines) if (l.partnerId) withPartner.add(String(l.account));
  const rows = new Map<string, CarryKey & { c: number }>();
  const turnover = new Set<string>();
  for (const l of lines) {
    const account = String(l.account);
    const partnerId = withPartner.has(account) ? l.partnerId || null : null;
    const doc = byDoc && partnerId && DOC_SPLIT_RE.test(account) ? docOf(l.doc) : null;
    const locationId = l.locationId || null;
    const k = keyOf(account, partnerId, doc, locationId);
    const r = rows.get(k) ?? { account, partnerId, doc, locationId, c: 0 };
    r.c += cents(l.debit) - cents(l.credit);
    rows.set(k, r);
    turnover.add(k);
  }
  return { rows, turnover };
}

/** Nearest existing account: the account itself, else its longest existing prefix of at least 3 digits. */
export function carryTargetAccount(account: string, missing: ReadonlySet<string>): string | null {
  if (!missing.has(account)) return account;
  for (let n = account.length - 1; n >= 3; n--) {
    const p = account.slice(0, n);
    if (!missing.has(p)) return p;
  }
  return null;
}

/** All codes the plan may post to (each account and its prefixes ≥ 3 digits) — feed to `missingAccounts`. */
export function carryCandidateAccounts(lines: readonly CarryLedgerLine[], statPrefixes: readonly string[] = DEFAULT_CARRY_STAT_PREFIXES): string[] {
  const s = new Set<string>();
  for (const l of lines) {
    const a = carryForwardAccount(String(l.account));
    if (!carriedClass(a) || carryStatAccount(a, statPrefixes)) continue;
    for (let n = a.length; n >= 3; n--) s.add(a.slice(0, n));
  }
  return [...s].sort();
}

/**
 * The carry-over plan of a closed year: every source balance with its target (or the reason it is not carried) and
 * the opening journal lines, merged per target key, 950/960 netted (legacy `obResLines`).
 */
export function carryPlan(lines: readonly CarryLedgerLine[], opt: CarryOptions = {}): CarryPlan {
  const missing = new Set(opt.missingAccounts ?? []);
  const inactive = new Set(opt.inactivePartners ?? []);
  const stat = opt.statPrefixes ?? DEFAULT_CARRY_STAT_PREFIXES;
  const { rows: src } = sourceRows(lines, !!opt.byDoc);
  const rows: CarrySourceRow[] = [];
  const plan = new Map<string, CarryPlanLine & { c: number }>();
  const blocked = new Set<string>();
  const sorted = [...src.values()].sort((a, b) =>
    a.account.localeCompare(b.account) || (a.partnerId ?? '').localeCompare(b.partnerId ?? '') ||
    (a.doc ?? '').localeCompare(b.doc ?? '') || (a.locationId ?? '').localeCompare(b.locationId ?? ''));
  for (const s of sorted) {
    const closing = toMoney(s.c);
    const base: CarryKey = { account: s.account, partnerId: s.partnerId, doc: s.doc, locationId: s.locationId };
    const cls = s.account.charAt(0);
    if (!carriedClass(s.account)) {
      const r = NOT_CARRIED_REASON[cls] ?? `класа ${cls} не се пренесува`;
      rows.push({ ...base, closing, target: null, reason: s.c ? `${r} – по затворањето има салдо, проверете го затворањето` : r, rule: 'class' });
      continue;
    }
    if (carryStatAccount(s.account, stat)) {
      rows.push({ ...base, closing, target: null, reason: CARRY_STAT_REASON, rule: 'stat' });
      continue;
    }
    if (!s.c) {
      rows.push({ ...base, closing, target: null, reason: 'нулто салдо на 31.12 – нема што да се пренесе', rule: 'zero' });
      continue;
    }
    const notes: string[] = [];
    const remapped = carryForwardAccount(s.account);
    if (remapped !== s.account) notes.push(`${s.account} → ${remapped} (резултатот од годината станува пренесен резултат)`);
    const target = carryTargetAccount(remapped, missing);
    if (!target) {
      blocked.add(remapped);
      rows.push({ ...base, closing, target: null, reason: `контото ${remapped} (ниту синтетиката) не постои во контниот план – отворете го, па пренесете повторно` });
      continue;
    }
    if (target !== remapped) notes.push(`аналитиката ${remapped} не постои во контниот план – пренесено на ${target}`);
    if (s.partnerId && inactive.has(s.partnerId)) notes.push('партнерот е неактивен – салдото се пренесува, проверете');
    rows.push({ ...base, closing, target, reason: notes.join('; ') });
    const k = keyOf(target, s.partnerId, s.doc, s.locationId);
    const p = plan.get(k) ?? { account: target, partnerId: s.partnerId, doc: s.doc, locationId: s.locationId, debit: 0, credit: 0, sources: [], notes: [], c: 0 };
    p.c += s.c;
    if (!p.sources.includes(s.account)) p.sources.push(s.account);
    for (const n of notes) if (!p.notes.includes(n)) p.notes.push(n);
    plan.set(k, p);
  }
  const out: CarryPlanLine[] = [];
  let D = 0;
  let P = 0;
  for (const p of plan.values()) {
    if (!p.c) continue;
    const { c, ...line } = p;
    line.debit = c > 0 ? toMoney(c) : 0;
    line.credit = c < 0 ? toMoney(-c) : 0;
    if (c > 0) D += c;
    else P -= c;
    if (line.partnerId) line.partner = line.partnerId;
    out.push(line);
  }
  out.sort((a, b) => a.account.localeCompare(b.account) || (a.partnerId ?? '').localeCompare(b.partnerId ?? '') || (a.doc ?? '').localeCompare(b.doc ?? ''));
  return { rows, lines: out, debit: toMoney(D), credit: toMoney(P), blocked: [...blocked].sort() };
}

/* ------------------------------------------------------------------ */
/* Evidence: closing (old year) vs opening (new year)                  */
/* ------------------------------------------------------------------ */

export type CarryStatus = 'ok' | 'note' | 'missing';

export interface CarryEvidenceRow extends CarryKey {
  /** source accounts (for a skipped row: the account itself) */
  sources: string[];
  /** debit − credit at 31.12 of the closed year */
  closing: number;
  /** debit − credit that should be in the opening */
  planned: number;
  /** debit − credit actually in the opening journal (null = no opening journal) */
  opening: number | null;
  /** true when the row belongs in the opening (carried class, non-zero, account exists) */
  carried: boolean;
  status: CarryStatus;
  reason: string;
  /** not carried by rule (class 4–8, statistical account, zero balance) — correct, not a gap */
  rule: CarryRule | null;
}

export interface CarryTotals {
  /** planned opening = closing balances of the carried classes */
  closingDebit: number;
  closingCredit: number;
  /** the posted opening journal */
  openingDebit: number;
  openingCredit: number;
  /** assets (classes 0, 1, 3, 6: debit − credit) / liabilities and capital (classes 2, 9: credit − debit) */
  closingAssets: number;
  closingLiabilities: number;
  openingAssets: number;
  openingLiabilities: number;
  /** closing totals = opening totals, the opening is balanced and assets = liabilities */
  ok: boolean;
}

export interface CarryEvidence {
  rows: CarryEvidenceRow[];
  totals: CarryTotals;
  /** number of rows that should be carried but are not (or differ) */
  missing: number;
}

export interface CarryEvidenceContext {
  /** the opening journal `open-<Y+1>` exists */
  opened: boolean;
  /** the new year is locked (opening cannot be posted / replaced) */
  lockedNext?: boolean;
}

const assetsOf = (account: string) => /^[0136]/.test(account);
const liabOf = (account: string) => /^[29]/.test(account);

export function carryEvidence(plan: CarryPlan, actual: readonly CarryOpenLine[], ctx: CarryEvidenceContext): CarryEvidence {
  const act = new Map<string, number>();
  let oD = 0;
  let oP = 0;
  let oA = 0;
  let oL = 0;
  for (const l of actual) {
    const k = keyOf(String(l.account), l.partnerId || null, docOf(l.doc), l.locationId || null);
    const c = cents(l.debit) - cents(l.credit);
    act.set(k, (act.get(k) ?? 0) + c);
    oD += cents(l.debit);
    oP += cents(l.credit);
    if (assetsOf(String(l.account))) oA += c;
    else if (liabOf(String(l.account))) oL -= c;
  }
  const seen = new Set<string>();
  const rows: CarryEvidenceRow[] = [];
  let cA = 0;
  let cL = 0;
  const notPosted = ctx.lockedNext ? 'периодот на новата година е заклучен – почетната состојба не може да се книжи' : 'почетната состојба за новата година не е пренесена';
  for (const p of plan.lines) {
    const k = keyOf(p.account, p.partnerId, p.doc, p.locationId);
    seen.add(k);
    const pc = cents(p.debit) - cents(p.credit);
    if (assetsOf(p.account)) cA += pc;
    else if (liabOf(p.account)) cL -= pc;
    const ac = ctx.opened ? act.get(k) ?? 0 : null;
    let status: CarryStatus;
    let reason: string;
    if (ac == null) {
      status = 'missing';
      reason = notPosted;
    } else if (ac === pc) {
      status = p.notes.length ? 'note' : 'ok';
      reason = p.notes.join('; ');
    } else if (Math.abs(ac - pc) < 100) {
      status = 'note';
      reason = `разлика од заокружување ${toMoney(ac - pc).toFixed(2)}`;
    } else {
      status = 'missing';
      reason = ac === 0
        ? 'ставката ја нема во почетната состојба – „Пренеси повторно“ или „Пренеси ја ставката“'
        : `во почетната е ${toMoney(ac).toFixed(2)}, салдото на 31.12 е ${toMoney(pc).toFixed(2)} – годината е менувана по преносот, „Пренеси повторно“`;
    }
    rows.push({
      account: p.account, partnerId: p.partnerId, doc: p.doc, locationId: p.locationId, sources: p.sources,
      closing: toMoney(pc), planned: toMoney(pc), opening: ac == null ? null : toMoney(ac), carried: true, status, reason, rule: null,
    });
  }
  // not carried: by rule (class, statistical account, zero balance) or because the account is missing
  for (const r of plan.rows) {
    if (r.target) continue;
    const k = keyOf(r.account, r.partnerId, r.doc, r.locationId);
    // a rule-excluded row that is nevertheless in the opening (posted by an older transfer) is a real difference
    const inOpening = ctx.opened && !!act.get(k);
    if (inOpening) seen.add(k);
    rows.push({
      account: r.account, partnerId: r.partnerId, doc: r.doc, locationId: r.locationId, sources: [r.account],
      closing: r.closing, planned: 0, opening: inOpening ? toMoney(act.get(k)!) : null, carried: false,
      status: inOpening || plan.blocked.includes(carryForwardAccount(r.account)) ? 'missing' : 'note',
      reason: inOpening ? `${r.reason} – но е во почетната состојба (од постар пренос) – „Пренеси повторно“` : r.reason,
      rule: inOpening ? null : r.rule ?? null,
    });
  }
  // in the opening journal but not in the plan (typed by hand or carried before a change)
  if (ctx.opened) {
    for (const [k, c] of act) {
      if (seen.has(k) || !c) continue;
      const [account, partnerId, doc, locationId] = k.split('|') as [string, string, string, string];
      rows.push({
        account, partnerId: partnerId || null, doc: doc || null, locationId: locationId || null, sources: [], closing: 0, planned: 0,
        opening: toMoney(c), carried: false, status: 'missing',
        reason: 'ставка само во почетната состојба (рачно внесена или од постар пренос) – нема салдо на 31.12', rule: null,
      });
    }
  }
  rows.sort((a, b) => a.account.localeCompare(b.account) || (a.partnerId ?? '').localeCompare(b.partnerId ?? '') || (a.doc ?? '').localeCompare(b.doc ?? ''));
  const totals: CarryTotals = {
    closingDebit: plan.debit, closingCredit: plan.credit, openingDebit: toMoney(oD), openingCredit: toMoney(oP),
    closingAssets: toMoney(cA), closingLiabilities: toMoney(cL), openingAssets: toMoney(oA), openingLiabilities: toMoney(oL),
    ok: ctx.opened && oD === cents(plan.debit) && oP === cents(plan.credit) && oD === oP && oA === oL && !plan.blocked.length,
  };
  return { rows, totals, missing: rows.filter((r) => r.status === 'missing').length };
}

/**
 * Carry ONE planned line into an existing opening journal without re-running the whole carry-over: the line is set
 * to its planned amount and the same difference is taken off an excess line of the same account (the partner-less
 * line, the line without document / location, or the parent account it fell back to), so the journal stays
 * balanced. Returns the new opening lines, or an error message when there is no such counterpart.
 */
export function carryOneLine(plan: CarryPlan, actual: readonly CarryOpenLine[], key: CarryKey): { lines: CarryOpenLine[] } | { error: string } {
  const k = keyOf(key.account, key.partnerId, key.doc, key.locationId);
  const p = plan.lines.find((l) => keyOf(l.account, l.partnerId, l.doc, l.locationId) === k);
  if (!p) return { error: 'Ставката не е во планот за пренос.' };
  const act = new Map<string, number>();
  for (const l of actual) {
    const kk = keyOf(String(l.account), l.partnerId || null, docOf(l.doc), l.locationId || null);
    act.set(kk, (act.get(kk) ?? 0) + cents(l.debit) - cents(l.credit));
  }
  const planned = new Map(plan.lines.map((l) => [keyOf(l.account, l.partnerId, l.doc, l.locationId), cents(l.debit) - cents(l.credit)]));
  const delta = (planned.get(k) ?? 0) - (act.get(k) ?? 0);
  if (!delta) return { error: 'Ставката е веќе пренесена.' };
  // counterpart: an actual line with the same excess, on the same account (less specific) or on a parent account
  const cand = [...act.entries()].filter(([kk, c]) => {
    if (kk === k) return false;
    const [a] = kk.split('|') as [string];
    if (!(a === p.account || p.account.startsWith(a) || p.sources.some((s) => s.startsWith(a)))) return false;
    return c - (planned.get(kk) ?? 0) === delta;
  });
  if (!cand.length) return { error: 'Нема соодветна спротивна ставка во почетната состојба – користете „Пренеси повторно“ за целиот пренос.' };
  const [ck] = cand[0]!;
  act.set(k, (act.get(k) ?? 0) + delta);
  act.set(ck, (act.get(ck) ?? 0) - delta);
  const lines: CarryOpenLine[] = [];
  for (const [kk, c] of act) {
    if (!c) continue;
    const [account, partnerId, doc, locationId] = kk.split('|') as [string, string, string, string];
    lines.push({ account, partnerId: partnerId || null, doc: doc || null, locationId: locationId || null, debit: c > 0 ? toMoney(c) : 0, credit: c < 0 ? toMoney(-c) : 0 });
  }
  return { lines };
}

/** Stable key of a carry row (used by the UI for „Пренеси ја ставката“). */
export const carryKeyString = (k: CarryKey): string => keyOf(k.account, k.partnerId, k.doc, k.locationId);
export function parseCarryKey(s: string): CarryKey {
  const [account = '', partnerId, doc, locationId] = String(s).split('|');
  return { account, partnerId: partnerId || null, doc: doc || null, locationId: locationId || null };
}
