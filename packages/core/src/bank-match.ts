/**
 * Bank matching & classification (Phase 4) — pure port of the final legacy behaviour.
 *
 * Legacy `autoMatch` is a chain of 7 wrappers (LEGACY-MAP §4.1); outermost runs first:
 *   13073 POS → 12775 VAT via bank → 12666 (wait for duplicate-import prompt; UI only)
 *   → 12646 payment-code rules (`osnovK`) → 12590 `bmRunFx` → 12500 `bmRun` → 4818 base
 * Each layer saved rows immediately and later layers saw the result; {@link autoMatch} applies the
 * layers in the same order to a working copy and returns the changed rows instead of saving.
 *
 * Import-time classification (legacy `save('bank')` wrappers 13072 POS → 12758 currency conversion
 * → 12568 own-account transfer → 12421 partner) is the explicit pipeline {@link classifyImported}.
 *
 * All amounts are integer cents (deni). Bank row `amount` is the signed MKD amount (+ inflow).
 *
 * Deliberate fixes (LEGACY-MAP Phase 4 §4.4) are marked `FIX #n:`.
 */
import { toCents, fromCents } from './bank/cents';

export { ppIban, ppIbanOn, ppAccTxt, ibanValid, mkAccountValid, bankCodeOf, bankByText, BANKS_MK } from './bank/payment-order';

/* ================================================================== types */

export type DocType = 'invoice' | 'purchase';

export interface BankAccount {
  id: string;
  name?: string;
  /** Bank account number (15 digits for MK). */
  account?: string;
  /** Ledger account (konto) of this bank account, e.g. 1000, 1030. */
  konto: string;
  /** Currency; empty/MKD = denar account. */
  cur?: string;
  nal?: string;
}

export interface DocRef { type: DocType; id: string; label: string }
export interface DocRefAmt extends DocRef { /** cents */ amt: number }
export interface SplitLine { k: string; /** cents */ a: number; n?: string }

export interface BankRow {
  id: string;
  /** Bank account id (`'main'` when missing). */
  acct?: string;
  date: string;
  /** Signed MKD amount in cents (+ inflow). */
  amount: number;
  /** Signed amount in the account currency (cents) for FX accounts. */
  amountCur?: number;
  cur?: string;
  desc?: string;
  name?: string;
  purpose?: string;
  osnov?: string;
  bref?: string;
  /** Counter account; empty = 1200 (inflow) / 2200 (outflow). */
  konto?: string;
  partner?: string;
  ref?: DocRef;
  refs?: DocRefAmt[];
  /** Amount (cents, MKD) that settles the linked document; the rest is an FX difference. */
  settle?: number;
  split?: SplitLine[];
  payRef?: string;
  pos?: boolean;
  own?: boolean;
  conv?: boolean;
  ai?: boolean;
  manual?: boolean;
}

/** An invoice (issued, non-credit) or a purchase invoice, with its total. */
export interface OpenDoc {
  id: string;
  number?: string;
  date: string;
  partner?: string;
  /** Document total in cents (legacy `invTotal` / `purTotal`). */
  total: number;
  /** Paid outside bank statements, cents (credit notes, supplier credits, journals, cash, compensations). */
  paidOther?: number;
  /** Purchase paid in cash (legacy: fully paid). */
  cash?: boolean;
  /** Client-submitted, not approved. */
  pend?: boolean;
  /** Credit note (excluded from matching, legacy `sInv`). */
  credit?: boolean;
  /** Import purchase → supplier konto `supKonto` (default 2210). */
  imp?: boolean;
  supKonto?: string;
  /** FX document: currency and rate used when it was booked. */
  cur?: string;
  fx?: number;
}

export interface Partner { id: string; name: string; edb?: string; embs?: string; code?: string; pos?: boolean }
export interface BankRule { match: string; konto: string; learned?: boolean }
export interface PayMatch { month: string; konto: string; split?: SplitLine[] }

/** Konto defaults that legacy hard-coded (FIX #10, #11: configurable, one place). */
export interface BankKonta {
  customer: string; // 1200
  supplier: string; // 2200
  importSupplier: string; // 2210
  fee: string; // 4460
  fxGain: string; // 7810
  fxLoss: string; // 4810
  fxDefault: string; // 1030
  transitFx: string; // 1039
  transit: string; // 1009
  pos: string; // 1200001
  ddvPay: string; // 23008
  ddvClaim: string; // 1308
}

export const BANK_KONTA: BankKonta = {
  customer: '1200', supplier: '2200', importSupplier: '2210', fee: '4460', fxGain: '7810', fxLoss: '4810',
  fxDefault: '1030', transitFx: '1039', transit: '1009', pos: '1200001', ddvPay: '23008', ddvClaim: '1308',
};

export interface MatchContext {
  rows: BankRow[];
  accounts: BankAccount[];
  /** Issued invoices (credit notes are ignored). */
  invoices: OpenDoc[];
  purchases: OpenDoc[];
  partners: Partner[];
  /** Working year: `bmRun`/`bmRunFx` only touch rows of this year (legacy `inYear`). Omit = all. */
  year?: number | string;
  firmName?: string;
  rules?: BankRule[];
  /** Learned payment-code rules `'<osnov>|in' | '<osnov>|out' → konto`. */
  osnovK?: Record<string, string>;
  /** POS partner id (legacy `posPid`); missing → result asks for one to be created. */
  posPartner?: string;
  konta?: Partial<BankKonta>;
  /** Payroll payment recogniser (legacy `payMatch`, owned by payroll). */
  payMatch?: (amountCents: number, date: string) => PayMatch | null;
}

/* ================================================================== small helpers */

const low = (s: unknown) => String(s ?? '').toLowerCase();
const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const kOf = (ctx: { konta?: Partial<BankKonta> }): BankKonta => ({ ...BANK_KONTA, ...(ctx.konta || {}) });
const inYear = (ctx: MatchContext, d: string) => ctx.year == null || String(d || '').startsWith(String(ctx.year));
const byDate = <T extends { x: { date: string } }>(A: T[]) => A.slice().sort((a, c) => (a.x.date < c.x.date ? -1 : a.x.date > c.x.date ? 1 : 0));

/** Legacy `acctOf`. */
export const acctOf = (b: { acct?: string }): string => b.acct || 'main';

/** Legacy `bankOf`: unknown id → first account; no accounts → `main` on konto 1000. */
export function bankOf(accounts: BankAccount[], id?: string): BankAccount {
  const B = accounts.length ? accounts : [{ id: 'main', konto: '1000' }];
  return B.find((b) => b.id === (id || 'main')) || B[0]!;
}

/** Legacy `isFx`. */
export const isFxAccount = (accounts: BankAccount[], acct?: string): boolean => (bankOf(accounts, acct).cur || 'MKD') !== 'MKD';

/** FIX #9: rows whose account no longer exists (legacy silently re-booked them to the first account). */
export const orphanBankRows = (rows: BankRow[], accounts: BankAccount[]): BankRow[] =>
  accounts.length ? rows.filter((b) => !accounts.some((a) => a.id === acctOf(b))) : [];

/** Legacy `BKPK_RE`: kontos that need a partner (customers 120–128, suppliers 220–228). */
export const BKPK_RE = /^(12[0-8]|22[0-8])/;

/** Legacy `bkEffK`: effective counter account (empty konto = 1200 inflow / 2200 outflow). */
export const bankEffKonto = (b: BankRow): string =>
  b.split && b.split.length && +b.amount < 0 ? '' : String(b.konto || (+b.amount >= 0 ? '1200' : '2200'));

/** Supplier konto for a purchase. FIX #3: legacy base `autoMatch` always used 2200, even for imports. */
export const supplierKonto = (p: OpenDoc, konta?: Partial<BankKonta>): string => {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  return p.imp ? p.supKonto || K.importSupplier : K.supplier;
};

/** Legacy `BANK_FEE` (12404). */
export const BANK_FEE = /надомест|провизи|одржување на (девизна |трансакциска |жиро )?сметка|пакет (на )?услуги|трошоци (за|на) платен промет|банкарск[аи] (услуг|трошо)|наплата на трошоци|maintenance fee|bank fee|commission/i;

/* ================================================================== partners & names */

/** Legacy `obN` (10621) — kept verbatim (its `\b` only works for the Latin suffixes). */
export const partnerKey = (s: unknown): string =>
  low(s).replace(/["„“”'.,()]/g, ' ').replace(/\b(дооел|доо|ад|јтд|тп|увоз-извоз|експорт-импорт|скопје|dooel|doo)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Legacy `obMatch` (10622): partner by tax/registry number, code, then normalised name. */
export function matchPartner(partners: Partner[], name: unknown, code?: unknown): string {
  const c = dig(code);
  if (c.length >= 7) { const x = partners.find((p) => dig(p.edb) === c || dig(p.embs) === c); if (x) return x.id; }
  if (code) { const x = partners.find((p) => p.code && String(p.code).trim() === String(code).trim()); if (x) return x.id; }
  const n = partnerKey(name);
  if (!n) return '';
  const x = partners.find((p) => partnerKey(p.name) === n) ||
    (n.length > 5 ? partners.find((p) => { const q = partnerKey(p.name); return q.length > 5 && (q.startsWith(n) || n.startsWith(q)); }) : undefined);
  return x ? x.id : '';
}

/** Legacy `bankParty` (3548): counterparty name and purpose from a bank row. */
export function bankParty(x: BankRow, partners: Partner[] = []): { name: string; purpose: string } {
  const d = String(x.desc || '').trim();
  let name = String(x.name || '').trim();
  let purpose = d;
  if (!name) {
    const m = d.match(/^(.{3,80}?)(?:\s+[-–]\s+|,\s*)(.*)$/);
    if (m && /[A-Za-zА-Яа-яЃЌЉЊЏЅЈ]{3}/.test(m[1]!) && !/^\d/.test(m[1]!)) { name = m[1]!.trim(); purpose = m[2]!.trim(); }
    else name = partners.find((p) => p.id === x.partner)?.name || '';
  } else if (d.toLowerCase().startsWith(name.toLowerCase())) purpose = d.slice(name.length).replace(/^\s*[-–,]\s*/, '');
  return { name, purpose };
}

/** Legacy `bkName` (12413). */
export const bankName = (b: BankRow, partners: Partner[] = []): string => String(bankParty(b, partners).name || '').trim().slice(0, 80);

/** Legacy `counterparty` (4855): the key a learned rule is stored under. */
export function counterparty(desc: unknown): string {
  let t = String(desc || '').split(/[,·;]| - | – /)[0]!.trim().toLowerCase();
  t = t.replace(/\s+(ад|доо|дооел|ad|doo|dooel)(?=\s|$).*$/u, '').trim();
  return t.length >= 3 ? t.slice(0, 40) : '';
}

/**
 * Learn a description rule after the user books a row to a konto (legacy change listener 4842).
 * Returns the new rule list, or `null` when nothing changes.
 */
export function learnRule(rules: BankRule[], desc: unknown, konto: string): BankRule[] | null {
  const key = counterparty(desc);
  if (!key) return null;
  const ex = rules.find((r) => r.match.toLowerCase() === key);
  if (!ex) return [...rules, { match: key, konto, learned: true }];
  if (String(ex.konto) !== String(konto)) return rules.map((r) => (r === ex ? { ...r, konto, learned: true } : r));
  return null;
}

/**
 * Learn a payment-code rule (legacy save wrapper 12645): a row with `osnov` booked by the user to a
 * non-12/22 konto. Returns the updated map or `null`. (Not applied by {@link autoMatch}: automatic
 * bookings do not teach rules — legacy learned from its own VAT/rule bookings too.)
 */
export function learnOsnov(osnovK: Record<string, string>, b: BankRow): Record<string, string> | null {
  if (!b.osnov || !b.konto || b.ref || /^(12|22)/.test(String(b.konto)) || b.ai) return null;
  const k = String(b.osnov) + '|' + (+b.amount > 0 ? 'in' : 'out');
  return osnovK[k] !== b.konto ? { ...osnovK, [k]: b.konto } : null;
}

/* ================================================================== open amounts */

/**
 * Bank part of legacy `paidFor` (3602 + refs patch 12481): payments linked by `ref` count
 * `settle ?? |amount|`; multi-document payments count their `refs[].amt`.
 */
export function bankPaid(rows: BankRow[], type: DocType, id: string): number {
  let s = 0;
  for (const b of rows) {
    const own = !!b.ref && b.ref.type === type && b.ref.id === id;
    if (b.refs && b.refs.length && b.ref) {
      for (const r of b.refs) if (r.type === type && r.id === id) s += +r.amt || 0;
    } else if (own) s += b.settle != null ? +b.settle : Math.abs(+b.amount || 0);
  }
  return s;
}

/**
 * Open amount of a document (cents). FIX #7: always the *real* open amount; legacy `paidFor` also
 * applied virtual FIFO advances (`bkVirt`) unless the hidden flag `S._noVirt` was set, so the base
 * `autoMatch` saw different open amounts than `bmRun`. Use {@link virtualAdvances} for reports.
 */
export function openAmount(rows: BankRow[], type: DocType, d: OpenDoc): number {
  if (type === 'purchase' && d.cash) return 0;
  return d.total - (d.paidOther || 0) - bankPaid(rows, type, d.id);
}

/* ================================================================== invoice numbers */

/** Legacy `bmSeg`. */
const bmSeg = (s: unknown) => (String(s || '').match(/\d+/g) || []).map((x) => +x);

export interface InvKey { n: number; y: number | null; raw: string }

/** Legacy `bmKey` (12472): invoice number → {number, 2-digit year, raw}. */
export function bmKey(num: unknown): InvKey | null {
  const g = bmSeg(num);
  if (!g.length) return null;
  let n = g[0]!;
  let y: number | null = null;
  if (g.length > 1 && g[0]! >= 2000 && g[0]! < 2100) { y = g[0]! % 100; n = g[1]!; }
  else if (g.length > 1) { const L = g[g.length - 1]!; if (L >= 2000 && L < 2100) y = L % 100; else if (L < 100) y = L; }
  return { n, y, raw: String(num).replace(/\s+/g, '').toLowerCase() };
}

/** Legacy `bmNums` (12475): invoice numbers mentioned in a payment description. */
export function bmNums(text: unknown): string[] {
  const t = String(text || '');
  const out: string[] = [];
  const SEP = /\s*(?:,|;|\+|&|\s и\s|\s i\s|\sdhe\s)\s*/;
  const re = /(?:ф(?:актур\S*|-?р[аи]|\.)|faktur\S*|fakt\.?|invoice\S*|inv\.?|сметк\S*|smetk\S*|бр(?:ој)?\.?|br\.?|nr\.?|#|№)\s*[:.]?\s*(\d[\d\/\-.]*(?:\s*(?:,|;|\+|&|\sи\s|\si\s|\sdhe\s)\s*\d[\d\/\-.]*)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    for (let x of m[1]!.split(SEP)) {
      x = x.replace(/[.\-\/]+$/, '');
      if (x && !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(x) && !out.includes(x)) out.push(x);
    }
  }
  for (const x of t.match(/\b\d{1,6}[\/\-]\d{2,4}\b/g) || []) if (!out.includes(x)) out.push(x);
  return out;
}

/** Legacy `bmEq` (12479): same invoice number; `weakOk` accepts a missing year on one side. */
export function bmEq(d: InvKey | null, k: InvKey | null, weakOk: boolean): boolean {
  if (!d || !k) return false;
  if (d.raw === k.raw) return true;
  if (d.n !== k.n) return false;
  if (d.y != null && k.y != null) return d.y === k.y;
  return !!weakOk;
}

/** Hard cap on documents considered by the subset search (2^14 = 16,384 combinations). */
export const SUBSET_MAX_ITEMS = 14;

/**
 * Legacy `bmSubset` (12482): the combination of ≥ 2 open documents (first 14, oldest first) whose open
 * amounts sum exactly to the payment; fewest documents wins, then the earliest combination.
 * Bounded: at most `2^SUBSET_MAX_ITEMS` sums.
 */
export function bmSubset<T extends { o: number }>(P: T[], amt: number): T[] | null {
  const X = P.slice(0, SUBSET_MAX_ITEMS);
  const N = X.length;
  let best: { mask: number; c: number } | null = null;
  for (let mask = 1; mask < 1 << N; mask++) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < N; i++) if (mask & (1 << i)) { s += X[i]!.o; c++; }
    if (s === amt && c > 1 && (!best || c < best.c || (c === best.c && mask < best.mask))) best = { mask, c };
  }
  return best ? X.filter((_, i) => best!.mask & (1 << i)) : null;
}

/**
 * Split a payment over picked documents (legacy `bmRun`/`bmLink` allocation).
 * FIX #8: legacy gave a single document — or the last of several — the *whole* remainder even when it
 * exceeded the open amount (over-allocation). Each document now takes at most its open amount; the
 * rest is returned as `excess` (an advance that stays on the partner) and zero allocations are dropped.
 */
export function allocatePayment(amt: number, pick: { x: OpenDoc; o: number }[], type: DocType): { refs: DocRefAmt[]; excess: number; capped: boolean } {
  let rem = amt;
  const refs: DocRefAmt[] = [];
  for (const z of pick) {
    const a = Math.min(z.o, rem);
    rem -= a;
    if (a > 0) refs.push({ type, id: z.x.id, label: String(z.x.number || ''), amt: a });
  }
  return { refs, excess: rem, capped: rem > 0 };
}

function linkRow(b: BankRow, pick: { x: OpenDoc; o: number }[], type: DocType, pid: string, K: BankKonta): { nb: BankRow; refs: DocRefAmt[]; excess: number } | null {
  const amt = Math.abs(+b.amount);
  const { refs, excess } = allocatePayment(amt, pick, type);
  if (!refs.length) return null;
  const f = pick[0]!.x;
  const inc = type === 'invoice';
  const nb: BankRow = {
    ...b,
    partner: f.partner || pid || b.partner,
    konto: inc ? K.customer : supplierKonto(f, K),
    ref: { type, id: refs[0]!.id, label: refs.map((r) => r.label).join(', ') },
  };
  // multi-document payment, or a capped single one (so `bankPaid` counts only the allocated part)
  if (refs.length > 1 || excess > 0) nb.refs = refs;
  else delete nb.refs;
  delete nb.ai;
  delete nb.settle;
  if (!nb.partner) delete nb.partner;
  return { nb, refs, excess };
}

/* ================================================================== matching layers */

export type MatchHow = 'pos' | 'vat' | 'osnov' | 'fx' | 'num' | 'amt' | 'sum' | 'fxnear' | 'invoice' | 'purchase' | 'fee' | 'payroll' | 'rule';

export interface MatchChange {
  id: string;
  how: MatchHow;
  row: BankRow;
  refs?: DocRefAmt[];
  /** Payment part not allocated to any document (FIX #8), cents. */
  excess?: number;
  /** Partner to create for this row (legacy created it silently in `bankFindPartner`). */
  newPartner?: string;
}

export interface MatchResult {
  /** All rows after matching (unchanged rows are the same objects). */
  rows: BankRow[];
  /** Changed rows in the order legacy saved them (a row may appear once per layer). */
  changes: MatchChange[];
  /** True when a POS row needs the "POS терминал" partner, which does not exist yet. */
  needPosPartner: boolean;
}

interface Work {
  ctx: MatchContext;
  K: BankKonta;
  rows: BankRow[];
  changes: MatchChange[];
  needPosPartner: boolean;
}

const pName = (ctx: MatchContext, id?: string) => ctx.partners.find((p) => p.id === id)?.name;
const invoicesOf = (ctx: MatchContext) => ctx.invoices.filter((i) => !i.credit);

/** Save a row into the working set, applying the partner step of the save chain (legacy 12421). */
function commit(w: Work, nb: BankRow, how: MatchHow, extra: Partial<MatchChange> = {}): void {
  let row = nb;
  let newPartner: string | undefined;
  if (!row.partner && BKPK_RE.test(bankEffKonto(row))) {
    const r = resolvePartner(row, w.ctx);
    if (r.partner) row = { ...row, partner: r.partner };
    else if (r.newPartner) newPartner = r.newPartner;
  }
  const i = w.rows.findIndex((x) => x.id === row.id);
  if (i >= 0) w.rows[i] = row;
  w.changes.push({ id: row.id, how, row, ...extra, ...(newPartner ? { newPartner } : {}) });
}

/** Legacy `POS_RE` / `posIs` (13068–13069). */
export const POS_RE = /\bPOS\b|\bП\.?О\.?С\b|ПОС[ -]?терм|картич|kartic|\bcard\b|merchant|мерчант|acquir|трговец|casys|касис|visa|master ?card|maestro|diners|amex|american express|дебитн|кредитн/i;
export const isPosInflow = (b: BankRow, accounts: BankAccount[]): boolean =>
  +b.amount > 0 && !isFxAccount(accounts, b.acct) && POS_RE.test([b.name, b.desc, b.purpose].filter(Boolean).join(' ')) && !/плата|кредит бр|loan|камата/i.test(String(b.desc || ''));

/** Legacy VAT-via-bank recogniser (12775). */
export const isVatPayment = (b: BankRow): boolean => {
  const t = String(b.desc || '') + ' ' + String(b.name || '') + ' ' + String(b.purpose || '');
  return /УЈП|управа за јавни приходи|ujp|uprava za javni/i.test(t) && /ДДВ|данок на додадена|\bDDV\b|\bVAT\b/i.test(t);
};

function layerPos(w: Work): void {
  const { ctx, K } = w;
  for (const b of w.rows.filter((b) => !b.ref && !b.pos && !b.own && (!b.konto || b.ai) && isPosInflow(b, ctx.accounts))) {
    if (!ctx.posPartner) w.needPosPartner = true;
    const nb: BankRow = { ...b, konto: K.pos, pos: true, ...(ctx.posPartner ? { partner: ctx.posPartner } : {}) };
    delete nb.ai;
    commit(w, nb, 'pos');
  }
}

function layerVat(w: Work): void {
  const { ctx, K } = w;
  for (const b of w.rows.filter((b) => !b.ref && !b.konto && +b.amount && !isFxAccount(ctx.accounts, b.acct))) {
    if (!isVatPayment(b)) continue;
    const nb: BankRow = { ...b, konto: +b.amount < 0 ? K.ddvPay : K.ddvClaim };
    delete nb.partner;
    commit(w, nb, 'vat');
  }
}

function layerOsnov(w: Work): void {
  const M = w.ctx.osnovK || {};
  for (const b of w.rows.filter((b) => !b.ref && !b.konto && b.osnov && !b.own)) {
    const k = M[String(b.osnov) + '|' + (+b.amount > 0 ? 'in' : 'out')];
    if (!k) continue;
    commit(w, { ...b, konto: k }, 'osnov');
  }
}

/** Legacy `bmRunFx` (12578): FX accounts — close an invoice by number or (near) amount, with FX difference. */
function layerFx(w: Work): void {
  const { ctx, K } = w;
  const PB: Record<string, number> = {};
  const alloc: Record<string, number> = {};
  const L = w.rows.filter((b) => inYear(ctx, b.date) && isFxAccount(ctx.accounts, b.acct) && !b.ref && !b.own && !b.pos && +b.amount && !(b.split && b.split.length) && (!b.konto || BKPK_RE.test(String(b.konto))));
  for (const b of L) {
    const inc = +b.amount > 0;
    const type: DocType = inc ? 'invoice' : 'purchase';
    const cur = bankOf(ctx.accounts, b.acct).cur;
    const amt = Math.abs(+b.amount);
    const acur = Math.abs(+(b.amountCur ?? 0) || 0);
    const docs = inc ? invoicesOf(ctx) : ctx.purchases.filter((p) => !p.cash && !p.pend);
    // FIX: stable date order (legacy comparator returned 1 for equal dates → engine-dependent order)
    const O = byDate(docs.filter((x) => !x.pend).map((x) => ({ x, o: x.total - (x.paidOther || 0) - (PB[type + x.id] ??= bankPaid(w.rows, type, x.id)) - (alloc[x.id] || 0) })).filter((z) => z.o > 0));
    const pid = b.partner || matchPartner(ctx.partners, bankName(b, ctx.partners), '');
    const P = pid ? O.filter((z) => z.x.partner === pid) : [];
    const Kn = bmNums(b.desc).map(bmKey).filter(Boolean) as InvKey[];
    const ocur = (z: { x: OpenDoc; o: number }) => (z.x.cur === cur && +(z.x.fx || 0) ? toCents(fromCents(z.o) / +z.x.fx!) : null);
    const near = (z: { x: OpenDoc; o: number }) => {
      const oc = ocur(z);
      return oc != null && acur ? Math.abs(oc - acur) <= Math.max(2, oc * 0.001) : Math.abs(z.o - amt) / z.o < 0.04;
    };
    let pick: { x: OpenDoc; o: number } | null = null;
    if (Kn.length) { const pool = P.length ? P : O; pick = pool.find((z) => Kn.some((k) => bmEq(bmKey(z.x.number), k, !!P.length))) || null; }
    if (!pick) { const pool = P.length ? P : pid ? [] : O; const ex = pool.filter(near); if (ex.length && (P.length || ex.length === 1)) pick = ex[0]!; }
    if (!pick) continue;
    const z = pick;
    const oc = ocur(z);
    const full = near(z);
    const settle = full ? z.o : Math.min(z.o, oc != null && acur ? toCents(fromCents(acur) * +z.x.fx!) : amt);
    const nb: BankRow = { ...b, partner: z.x.partner || pid || b.partner, konto: inc ? K.customer : supplierKonto(z.x, K), ref: { type, id: z.x.id, label: String(z.x.number || '') }, settle };
    if (!nb.partner) delete nb.partner;
    delete nb.ai;
    delete nb.refs;
    commit(w, nb, 'fx');
    alloc[z.x.id] = (alloc[z.x.id] || 0) + settle;
  }
}

/** Legacy `bmRun` (12484): MKD accounts — by invoice number, exact amount, or subset sum of a partner's open invoices. */
function layerBm(w: Work): void {
  const { ctx, K } = w;
  const alloc: Record<string, number> = {};
  const PB: Record<string, number> = {};
  const L = w.rows.filter((b) => inYear(ctx, b.date) && !b.ref && !b.pos && !(b.split && b.split.length) && +b.amount && !isFxAccount(ctx.accounts, b.acct) && (!b.konto || BKPK_RE.test(String(b.konto))));
  for (const b of L) {
    const inc = +b.amount > 0;
    const type: DocType = inc ? 'invoice' : 'purchase';
    const amt = Math.abs(+b.amount);
    const docs = inc ? invoicesOf(ctx) : ctx.purchases.filter((p) => !p.cash && !p.pend);
    const O = byDate(docs.map((x) => ({ x, o: x.total - (x.paidOther || 0) - (PB[type + x.id] ??= bankPaid(w.rows, type, x.id)) - (alloc[x.id] || 0) })).filter((z) => z.o > 0 && !z.x.pend));
    const pid = b.partner || matchPartner(ctx.partners, bankName(b, ctx.partners), '');
    const P = pid ? O.filter((z) => z.x.partner === pid) : [];
    const Kn = bmNums(b.desc).map(bmKey).filter(Boolean) as InvKey[];
    let pick: { x: OpenDoc; o: number }[] | null = null;
    let how: MatchHow = 'num';
    if (Kn.length) {
      const pool = P.length ? P : O;
      const hits = pool.filter((z) => Kn.some((k) => bmEq(bmKey(z.x.number), k, !!P.length)));
      if (hits.length) { pick = hits; how = 'num'; }
    }
    if (!pick) {
      const pool = P.length ? P : pid ? [] : O;
      const ex = pool.filter((z) => z.o === amt);
      if (ex.length && (P.length || ex.length === 1)) { pick = [ex[0]!]; how = 'amt'; }
      else if (P.length > 1) { const ss = bmSubset(P, amt); if (ss) { pick = ss; how = 'sum'; } }
    }
    if (!pick) continue;
    const r = linkRow(b, pick, type, pid, K);
    if (!r) continue;
    commit(w, r.nb, how, { refs: r.refs, ...(r.excess ? { excess: r.excess } : {}) });
    for (const x of r.refs) alloc[x.id] = (alloc[x.id] || 0) + x.amt;
  }
}

/** Legacy base `autoMatch` (4818). */
function layerBase(w: Work): void {
  const { ctx, K } = w;
  const used = new Set<string>();
  const rules = ctx.rules || [];
  const open = (type: DocType, d: OpenDoc) => openAmount(w.rows, type, d);
  for (const b0 of w.rows.filter((b) => !b.ref && !b.konto)) {
    const b = w.rows.find((x) => x.id === b0.id) || b0;
    const desc = low(b.desc);
    const amt = Math.abs(+b.amount);
    if (!amt) continue;
    let hit: { type: DocType; doc: OpenDoc } | null = null;
    const nm8 = (x: OpenDoc) => low(pName(ctx, x.partner) || '~~').slice(0, 8);
    if (isFxAccount(ctx.accounts, b.acct)) {
      const near = (o: number) => o > 0 && Math.abs(o - amt) / o < 0.04;
      const src = +b.amount > 0
        ? invoicesOf(ctx).filter((i) => !i.pend).map((x) => ({ t: 'invoice' as DocType, x, o: open('invoice', x) }))
        : ctx.purchases.filter((p) => !p.pend).map((x) => ({ t: 'purchase' as DocType, x, o: open('purchase', x) }));
      const c = src.find((c) => !used.has(c.x.id) && near(c.o) && (desc.includes(low(c.x.number || '~~').split('/')[0]!) || desc.includes(nm8(c.x))));
      if (c) {
        used.add(c.x.id);
        const nb: BankRow = { ...b, ref: { type: c.t, id: c.x.id, label: String(c.x.number ?? '') }, partner: c.x.partner, konto: c.t === 'invoice' ? K.customer : supplierKonto(c.x, K), settle: c.o };
        if (!nb.partner) delete nb.partner;
        commit(w, nb, 'fxnear');
        continue;
      }
    } else if (+b.amount > 0) {
      const cand = invoicesOf(ctx).filter((i) => !i.pend && !used.has(i.id) && open('invoice', i) === amt);
      const i = cand.find((i) => desc.includes(String(i.number).split('/')[0]!) || desc.includes(nm8(i))) || cand[0];
      if (i) hit = { type: 'invoice', doc: i };
    } else if (BANK_FEE.test(desc) && !ctx.purchases.some((p) => !used.has(p.id) && p.number && desc.includes(low(p.number)) && open('purchase', p) === amt)) {
      const fk = rules.find((r) => r.match && desc.includes(r.match.toLowerCase()));
      commit(w, { ...b, konto: fk ? fk.konto : K.fee }, 'fee');
      continue;
    } else {
      const cand = ctx.purchases.filter((p) => !p.pend && !used.has(p.id) && open('purchase', p) === amt);
      const p = cand.find((p) => desc.includes(low(p.number || '~~')) || desc.includes(nm8(p))) || cand[0];
      if (p) hit = { type: 'purchase', doc: p };
    }
    if (!hit && +b.amount < 0 && ctx.payMatch) {
      const pm = ctx.payMatch(amt, b.date);
      if (pm) {
        const nb: BankRow = { ...b, konto: pm.konto, payRef: pm.month };
        if (pm.split) nb.split = pm.split;
        else delete nb.split;
        commit(w, nb, 'payroll');
        continue;
      }
    }
    if (hit) {
      used.add(hit.doc.id);
      const nb: BankRow = { ...b, ref: { type: hit.type, id: hit.doc.id, label: String(hit.doc.number ?? '') }, partner: hit.doc.partner, konto: hit.type === 'invoice' ? K.customer : supplierKonto(hit.doc, K) };
      if (!nb.partner) delete nb.partner;
      commit(w, nb, hit.type);
      continue;
    }
    const rule = rules.find((r) => r.match && desc.includes(r.match.toLowerCase()));
    if (rule) commit(w, { ...b, konto: rule.konto }, 'rule');
  }
}

/**
 * Automatic matching of unbooked bank rows (legacy `autoMatch`, all 7 layers in legacy order):
 * POS card inflows → VAT payments/refunds → learned payment-code rules → FX invoices (`bmRunFx`) →
 * MKD invoices by number / amount / subset sum (`bmRun`) → base (FX near-amount, exact amount,
 * bank fees, payroll, description rules).
 *
 * Deliberate differences from legacy: real open amounts everywhere (FIX #7), allocation capped at the
 * open amount (FIX #8), import-supplier konto in the base layer (FIX #3), pending (client-submitted)
 * documents never matched (legacy base layer matched them), configurable kontos (FIX #10/#11), and
 * partners that would have been auto-created are returned as `newPartner` instead (FIX #5).
 */
export function autoMatch(ctx: MatchContext): MatchResult {
  const w: Work = { ctx, K: kOf(ctx), rows: ctx.rows.slice(), changes: [], needPosPartner: false };
  layerPos(w);
  layerVat(w);
  layerOsnov(w);
  layerFx(w);
  layerBm(w);
  layerBase(w);
  return { rows: w.rows, changes: w.changes, needPosPartner: w.needPosPartner };
}

/** Only the invoice-closing pass (legacy `bmRun`), e.g. for a "close invoices" button. */
export function bmRun(ctx: MatchContext): MatchResult {
  const w: Work = { ctx, K: kOf(ctx), rows: ctx.rows.slice(), changes: [], needPosPartner: false };
  layerBm(w);
  return { rows: w.rows, changes: w.changes, needPosPartner: false };
}

/** Only the FX invoice-closing pass (legacy `bmRunFx`). */
export function bmRunFx(ctx: MatchContext): MatchResult {
  const w: Work = { ctx, K: kOf(ctx), rows: ctx.rows.slice(), changes: [], needPosPartner: false };
  layerFx(w);
  return { rows: w.rows, changes: w.changes, needPosPartner: false };
}

/* ================================================================== manual linking */

/** Legacy `bmOpenFor` (12508): open documents a payment could close (partner's, else all), oldest first. */
export function openDocsFor(b: BankRow, ctx: MatchContext): { type: DocType; pid: string; O: { x: OpenDoc; o: number }[] } {
  const inc = +b.amount > 0;
  const type: DocType = inc ? 'invoice' : 'purchase';
  const docs = inc ? invoicesOf(ctx) : ctx.purchases.filter((p) => !p.cash && !p.pend);
  const pid = b.partner || matchPartner(ctx.partners, bankName(b, ctx.partners), '');
  const O = byDate(docs.filter((x) => !x.pend && (!pid || x.partner === pid)).map((x) => ({ x, o: openAmount(ctx.rows, type, x) })).filter((z) => z.o > 0));
  return { type, pid, O };
}

/** Legacy "close in order" choice (12519): oldest documents until the payment is used up. */
export function fifoPick(b: BankRow, O: { x: OpenDoc; o: number }[]): { x: OpenDoc; o: number }[] {
  let rem = Math.abs(+b.amount);
  const P: { x: OpenDoc; o: number }[] = [];
  for (const z of O) { if (rem <= 0) break; P.push(z); rem -= z.o; }
  return P;
}

/** Legacy `bmLink` (12510): link a payment to picked documents (allocation capped — FIX #8). */
export function linkPayment(b: BankRow, pick: { x: OpenDoc; o: number }[], type: DocType, konta?: Partial<BankKonta>): { row: BankRow; refs: DocRefAmt[]; excess: number } | null {
  const r = linkRow(b, pick, type, '', { ...BANK_KONTA, ...(konta || {}) });
  return r && { row: r.nb, refs: r.refs, excess: r.excess };
}

/** Legacy `bkUnl` (12507): payments booked on a partner (12x/22x) but not linked to a document. */
export const unlinkedPayments = (ctx: Pick<MatchContext, 'rows' | 'accounts' | 'year'>): BankRow[] =>
  ctx.rows.filter((b) => (ctx.year == null || String(b.date).startsWith(String(ctx.year))) && !b.ref && !b.pos && +b.amount && !(b.split && b.split.length) && !isFxAccount(ctx.accounts, b.acct) && BKPK_RE.test(bankEffKonto(b)));

export interface AdvanceInfo { type: DocType; pid: string; pays: BankRow[]; paid: number; applied: number; left: number }

/**
 * Legacy `bkVirt` (12529), as an explicit report helper: unlinked partner payments applied FIFO to the
 * partner's oldest open documents. `V[type+id]` = virtual payment per document; `ADV` = per partner.
 */
export function virtualAdvances(ctx: Pick<MatchContext, 'rows' | 'accounts' | 'invoices' | 'purchases'>): { V: Record<string, number>; ADV: AdvanceInfo[] } {
  const V: Record<string, number> = {};
  const ADV: AdvanceInfo[] = [];
  for (const type of ['invoice', 'purchase'] as DocType[]) {
    const inc = type === 'invoice';
    const pay: Record<string, BankRow[]> = {};
    for (const b of ctx.rows) {
      if (b.ref || !b.partner || !+b.amount || (b.split && b.split.length) || isFxAccount(ctx.accounts, b.acct)) continue;
      if (!BKPK_RE.test(bankEffKonto(b))) continue;
      if (inc !== +b.amount > 0) continue;
      (pay[b.partner] = pay[b.partner] || []).push(b);
    }
    const docs = inc ? ctx.invoices.filter((i) => !i.credit) : ctx.purchases.filter((p) => !p.cash);
    for (const [pid, B] of Object.entries(pay)) {
      const paid = B.reduce((s, b) => s + Math.abs(+b.amount), 0);
      let rem = paid;
      const O = byDate(docs.filter((x) => x.partner === pid && !x.pend).map((x) => ({ x, o: openAmount(ctx.rows, type, x) })).filter((z) => z.o > 0));
      for (const z of O) { if (rem <= 0) break; const a = Math.min(z.o, rem); V[type + z.x.id] = a; rem -= a; }
      ADV.push({ type, pid, pays: B.slice().sort((a, c) => (a.date < c.date ? -1 : 1)), paid, applied: paid - rem, left: rem });
    }
  }
  return { V, ADV };
}

/* ================================================================== import classification */

const BK_LAT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', џ: 'dzh', ш: 'sh' };
/** Legacy `bkLat` (12562). */
export const bkLat = (s: unknown): string => low(s).split('').map((c) => BK_LAT[c] ?? c).join('').replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'dj');
/** Legacy `bkCore` (12563): company name core for own-account detection. */
export const bkCore = (s: unknown): string =>
  bkLat(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\b(dooel|doo|ad|tp|jtd|dpu|dptu|ltd|llc|skopje|tetovo|gostivar|kumanovo|bitola|struga|ohrid|veles|shtip|stip|kichevo|kicevo|debar|export|import|eksport|uvoz|izvoz|mk|r|s|n)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Legacy `bkOwn` (12564): transfer between the firm's own accounts. */
export function isOwnTransfer(b: BankRow, ctx: Pick<MatchContext, 'firmName' | 'accounts' | 'partners'>): boolean {
  const me = bkCore(ctx.firmName);
  if (me.length < 4) return false;
  const nm = bkCore(bankName(b, ctx.partners) || b.desc || '');
  if (!nm) return false;
  if (nm === me || nm.startsWith(me + ' ') || (me.startsWith(nm + ' ') && nm.length >= 6)) return true;
  const d = dig(b.desc);
  return ctx.accounts.some((x) => x.id !== acctOf(b) && dig(x.account).length >= 10 && d.includes(dig(x.account).slice(-10)));
}

/** Legacy `CONV_RE` / `isConv` (12754, 12757): currency purchase/sale. */
export const CONV_RE = /откуп\s+на\s+(денари|девиз)|откуп\s+девиз|продажба\s+на\s+девиз|купување\s+(на\s+)?девиз|купопродажба\s+(на\s+)?девиз|конверзиј|менувач|otkup\s+(na\s+)?(denar|deviz)|kupoprodaj|kupoprodazb|konverzij|currency\s+exchange|fx\s+(deal|conversion)/i;
export const isConversion = (b: BankRow): boolean => CONV_RE.test(String(b.desc || '') + ' ' + String(b.purpose || '') + ' ' + String(b.name || ''));

/** Legacy `convFxKonto` (12755): FX bank konto for the denar side of a currency purchase/sale. */
export function convFxKonto(b: BankRow, accounts: BankAccount[], konta?: Partial<BankKonta>): string {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  const F = accounts.filter((x) => (x.cur || 'MKD') !== 'MKD');
  if (!F.length) return K.fxDefault;
  if (F.length === 1) return String(F[0]!.konto || K.fxDefault);
  const t = String(b.desc || '') + ' ' + String(b.purpose || '');
  const cur = /(EUR|евр)/i.test(t) ? 'EUR' : /(USD|долар)/i.test(t) ? 'USD' : /(CHF|франк)/i.test(t) ? 'CHF' : /(GBP|фунт)/i.test(t) ? 'GBP' : '';
  const hit = cur && F.find((x) => x.cur === cur);
  return String((hit || F[0]!).konto || K.fxDefault);
}

/**
 * Partner for a row on 12x/22x (legacy save wrapper 12421 / `bankFindPartner`): the linked document's
 * partner, else a partner matched by the bank name. When the row already has a konto and no partner
 * matches, legacy silently created one — here it is returned as `newPartner` (FIX #5).
 */
export function resolvePartner(b: BankRow, ctx: Pick<MatchContext, 'partners' | 'invoices' | 'purchases'>): { partner?: string; newPartner?: string } {
  const r = b.ref;
  if (r) {
    const d = (r.type === 'invoice' ? ctx.invoices : ctx.purchases).find((x) => x.id === r.id);
    if (d?.partner) return { partner: d.partner };
  }
  const nm = bankName(b, ctx.partners);
  if (b.konto) {
    if (!nm || nm.length < 3) return {};
    const pid = matchPartner(ctx.partners, nm, '');
    return pid ? { partner: pid } : { newPartner: nm };
  }
  const pid = matchPartner(ctx.partners, nm, '');
  return pid ? { partner: pid } : {};
}

export type ImportClass = 'pos' | 'conv' | 'own' | null;

/**
 * Classify a freshly imported row (legacy `save('bank')` wrappers, outermost first — FIX #5: one
 * explicit pipeline instead of order-dependent persistence hooks):
 * 1. POS card inflow → POS konto + POS partner (13072)
 * 2. currency purchase/sale → FX bank konto (denar side) or neutral FX side (12758)
 * 3. own-account transfer → transit 1039 (FX) / 1009 (12568)
 * 4. partner for 12x/22x rows (12421)
 * Steps 1–3 only apply to rows without konto/ref/split. Run {@link pairConversions} after a batch.
 */
export function classifyImported(row: BankRow, ctx: Pick<MatchContext, 'accounts' | 'partners' | 'invoices' | 'purchases' | 'firmName' | 'posPartner' | 'konta'>): { row: BankRow; cls: ImportClass; newPartner?: string; needPosPartner?: boolean } {
  const K = kOf(ctx);
  let b: BankRow = row;
  let cls: ImportClass = null;
  let needPosPartner = false;
  const free = (x: BankRow) => !x.konto && !x.ref && !(x.split && x.split.length);
  if (free(b) && !b.own && isPosInflow(b, ctx.accounts)) {
    b = { ...b, konto: K.pos, pos: true, ...(ctx.posPartner ? { partner: ctx.posPartner } : {}) };
    delete b.ai;
    if (!ctx.posPartner) needPosPartner = true;
    cls = 'pos';
  }
  if (free(b) && isConversion(b)) {
    const fx = isFxAccount(ctx.accounts, b.acct);
    b = { ...b, konto: fx ? String(bankOf(ctx.accounts, b.acct).konto || K.fxDefault) : convFxKonto(b, ctx.accounts, K), conv: true };
    if (fx) b.own = true;
    else delete b.own;
    delete b.partner;
    cls = 'conv';
  }
  if (free(b) && isOwnTransfer(b, ctx)) {
    b = { ...b, konto: isFxAccount(ctx.accounts, b.acct) || /откуп|девиз|конверз|kupoproda|otkup|deviz|convers|exchange/i.test(String(b.desc || '')) ? K.transitFx : K.transit, own: true };
    delete b.partner;
    cls = 'own';
  }
  let newPartner: string | undefined;
  if (!b.partner && BKPK_RE.test(bankEffKonto(b))) {
    const r = resolvePartner(b, ctx);
    if (r.partner) b = { ...b, partner: r.partner };
    else if (r.newPartner) newPartner = r.newPartner;
  }
  return { row: b, cls, ...(newPartner ? { newPartner } : {}), ...(needPosPartner ? { needPosPartner } : {}) };
}

/**
 * Legacy `convPair` (12769): an FX-account row parked on the FX transit konto (1039) on the same day as
 * an opposite denar currency purchase/sale (within 5 %) is the neutral FX side of that conversion.
 * Returns the rows to update.
 */
export function pairConversions(rows: BankRow[], accounts: BankAccount[], konta?: Partial<BankKonta>): BankRow[] {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  const out: BankRow[] = [];
  for (const x of rows) {
    if (!isFxAccount(accounts, x.acct) || x.conv || x.ref || String(x.konto) !== K.transitFx) continue;
    const sgn = Math.sign(+x.amount);
    const mk = rows.find((y) => !isFxAccount(accounts, y.acct) && y.conv && y.date === x.date && Math.sign(+y.amount) === -sgn && Math.abs(Math.abs(+y.amount) - Math.abs(+x.amount)) <= Math.abs(+x.amount) * 0.05);
    if (mk) out.push({ ...x, konto: String(bankOf(accounts, x.acct).konto || K.fxDefault), conv: true, own: true });
  }
  return out;
}

/** Legacy ACT `feeFix` (12406). FIX #2: bank fees belong on 4460 — rows booked on 2200/4400 without a document. */
export function feeFix(rows: BankRow[], year?: number | string, konta?: Partial<BankKonta>): BankRow[] {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  return rows
    .filter((b) => (year == null || String(b.date).startsWith(String(year))) && +b.amount < 0 && !b.ref && ['2200', '4400'].includes(String(b.konto)) && BANK_FEE.test(String(b.desc || '')))
    .map((b) => { const nb = { ...b, konto: K.fee }; delete nb.ai; return nb; });
}

/* ================================================================== FX */

/** Legacy `FX_DEF` (6491): default middle rates (MKD per unit) as of `FX_DATE0`. */
export const FX_DATE0 = '2026-09-30';
export const FX_DEF: [string, string, number][] = [
  ['EUR', 'Евро', 61.5], ['USD', 'Американски долар', 54.2519], ['GBP', 'Британска фунта', 71.762], ['CHF', 'Швајцарски франк', 65.0175],
  ['TRY', 'Турска лира', 1.1069], ['RSD', 'Српски динар', 0.5234], ['ALL', 'Албански лек', 0.628], ['BAM', 'Конвертибилна марка', 31.4444],
  ['HUF', 'Унгарска форинта', 0.1677], ['RON', 'Романски леј', 11.6469], ['CZK', 'Чешка круна', 2.5161], ['PLN', 'Полски злот', 14.0755],
  ['SEK', 'Шведска круна', 5.427], ['NOK', 'Норвешка круна', 5.6467], ['DKK', 'Данска круна', 8.2264], ['CAD', 'Канадски долар', 38.213],
  ['AUD', 'Австралиски долар', 37.8159], ['JPY', 'Јапонски јен', 0.3454], ['CNY', 'Кинески јуан', 8.0937], ['RUB', 'Руска рубља', 0.6459],
];

export interface FxRateRow { cur: string; rate: number; date?: string }

/**
 * Legacy `getFx` (6494): firm currency codebook → office rate list → `FX_DEF`. The newest rate on or
 * before `date` (undated rows always qualify). FIX #4: the single rate source — callers must not use
 * hard-coded EUR 61.5 or the `BLG_FX0` table.
 */
export function fxRate(cur: string, date: string, sources: { firm?: FxRateRow[]; office?: FxRateRow[] } = {}): number {
  const c = String(cur || '').toUpperCase();
  if (!c || c === 'MKD') return 1;
  const pick = (L: FxRateRow[]) => L.filter((x) => String(x.cur).toUpperCase() === c && +x.rate).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).find((x) => !x.date || x.date <= date) || null;
  const own = pick(sources.firm || []);
  if (own) return +own.rate;
  const g = pick(sources.office || []);
  if (g) return +g.rate;
  const d = FX_DEF.find((x) => x[0] === c);
  return d ? d[2] : 0;
}

/**
 * Legacy `fxItem` (4816): MKD amount of a foreign-currency line — the bank's denar counter-value when
 * printed, else `amountCur × rate`. Cents in, cents out.
 */
export const fxToMkd = (amountCur: number, rate: number, mkd?: number): number =>
  mkd ? Math.sign(amountCur) * Math.abs(mkd) : toCents(fromCents(amountCur) * rate);

export interface FxDifference { konto: string; side: 'd' | 'p'; amount: number }

/**
 * FX difference of a linked payment (the `settle` part of legacy `bankEntries` 3387–3389): paid MKD
 * amount minus the document amount it settles. Inflow: surplus → 7810 (income), shortfall → 4810.
 * Outflow: surplus → 4810 (expense), shortfall → 7810. `null` when there is no difference.
 */
export function fxDifference(b: Pick<BankRow, 'amount' | 'ref' | 'settle'>, konta?: Partial<BankKonta>): FxDifference | null {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  const a = Math.abs(+b.amount || 0);
  if (!a) return null;
  const st = b.ref && b.settle != null ? +b.settle : a;
  const diff = a - st;
  if (!diff) return null;
  if (+b.amount >= 0) return diff > 0 ? { konto: K.fxGain, side: 'p', amount: diff } : { konto: K.fxLoss, side: 'd', amount: -diff };
  return diff > 0 ? { konto: K.fxLoss, side: 'd', amount: diff } : { konto: K.fxGain, side: 'p', amount: -diff };
}

export interface LedgerLine { k: string; date: string; d: number; p: number }

/**
 * Legacy `trResid` (12570): residue left on the transit kontos (1039, 1009) per day after a currency
 * purchase/sale — both sides present and the residue ≤ 5 % → an FX difference to book. Cents.
 */
export function transitResidue(lines: LedgerLine[], konta?: Partial<BankKonta>): { k: string; date: string; r: number }[] {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  const out: { k: string; date: string; r: number }[] = [];
  for (const k of [K.transitFx, K.transit]) {
    const by: Record<string, { d: number; p: number }> = {};
    for (const l of lines) { if (String(l.k) !== k) continue; const o = (by[l.date] ||= { d: 0, p: 0 }); o.d += +l.d || 0; o.p += +l.p || 0; }
    for (const [date, o] of Object.entries(by)) {
      const r = o.d - o.p;
      if (o.d > 0 && o.p > 0 && r && Math.abs(r) <= Math.max(o.d, o.p) * 0.05) out.push({ k, date, r });
    }
  }
  return out;
}

/** Journal lines closing a transit residue (legacy ACT `trClose` 12572): debit 4810 / credit 7810. */
export function transitCloseLines(x: { k: string; r: number }, konta?: Partial<BankKonta>): { k: string; d: number; p: number }[] {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  return x.r > 0 ? [{ k: K.fxLoss, d: x.r, p: 0 }, { k: x.k, d: 0, p: x.r }] : [{ k: x.k, d: -x.r, p: 0 }, { k: K.fxGain, d: 0, p: -x.r }];
}

/* ================================================================== statement numbers & balances */

/** Legacy `izvKey` (3469): `[acct:]date`. */
export const statementKey = (acct: string | undefined, date: string): string => (acct && acct !== 'main' ? acct + ':' : '') + date;

/**
 * Legacy `ensureIzvNos` (3474): numbers for statement dates that have none — the file's number when
 * given, else the year's max + 1. FIX (#12): legacy used the file's number only when the file held a
 * single date; a multi-date statement now gets the given number on its latest date (where its balances
 * are keyed) and sequential numbers on the earlier dates.
 */
export function assignStatementNumbers(existing: Record<string, string>, acct: string, dates: string[], given?: string): Record<string, string> {
  const cur = { ...existing };
  const add: Record<string, string> = {};
  const pre = acct && acct !== 'main' ? acct + ':' : '';
  const D = [...new Set(dates)].sort();
  const last = D[D.length - 1];
  for (const d of D) {
    const key = pre + d;
    if (cur[key]) continue;
    const y = d.slice(0, 4);
    if (given && d === last) { add[key] = String(given); continue; }
    const used = Object.entries({ ...cur, ...add }).filter(([k]) => (pre ? k.startsWith(pre + y) : /^\d{4}-/.test(k) && k.startsWith(y))).map(([, n]) => parseInt(n) || 0);
    add[key] = String((used.length ? Math.max(...used) : 0) + 1);
  }
  return add;
}

export interface StatementBalance { o: number; c: number; no?: string }

/** Legacy `izvGaps` (12597): closing balance of a statement ≠ opening of the next one (missing statement). */
export function statementGaps(izvSal: Record<string, StatementBalance>, accounts: BankAccount[], year: number | string): { acct: string; a: StatementBalance & { d: string }; b: StatementBalance & { d: string }; diff: number }[] {
  const out: { acct: string; a: StatementBalance & { d: string }; b: StatementBalance & { d: string }; diff: number }[] = [];
  const B = accounts.length ? accounts : [{ id: 'main', konto: '1000' }];
  for (const bk of B) {
    const pre = bk.id && bk.id !== 'main' ? bk.id + ':' : '';
    const L = Object.entries(izvSal)
      .filter(([k]) => (pre ? k.startsWith(pre) : !k.includes(':')))
      .map(([k, v]) => ({ d: k.slice(pre.length), ...v }))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d) && x.d.startsWith(String(year)))
      .sort((a, b) => (a.d < b.d ? -1 : 1));
    for (let i = 1; i < L.length; i++) {
      const a = L[i - 1]!;
      const b = L[i]!;
      if (a.c !== b.o) out.push({ acct: bk.id, a, b, diff: b.o - a.c });
    }
  }
  return out;
}

/** Legacy `bKey` (4811): duplicate-detection key of a bank row. */
export const bankDupKey = (b: BankRow): string =>
  acctOf(b) + '|' + b.date + '|' + fromCents(b.amountCur ?? b.amount) + '|' + low(b.desc).replace(/[^\p{L}\p{N}]+/gu, '');
