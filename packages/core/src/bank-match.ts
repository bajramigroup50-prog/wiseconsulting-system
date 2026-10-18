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
import { PAY_SCH0, type PayScheme } from './payroll/entries';

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
  /** Counterparty bank account / IBAN as the bank gave it. */
  counterAccount?: string;
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
  /**
   * Counter konto the document is booked on (e.g. 1201, 2210). When set, a payment linked to it is
   * booked on this konto instead of the customer / supplier default (open items read from the ledger).
   */
  konto?: string;
}

/** `accs`: the partner's known bank accounts (digits / IBAN, `partners.data.accounts` + `bank_account`). */
export interface Partner { id: string; name: string; edb?: string; embs?: string; code?: string; pos?: boolean; accs?: string[] }
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
  /** Own-account transfer (denars). The db layer defaults it to the analytic 10091 when the chart has it. */
  transit: string; // 1009 (fallback) / 10091
  /** Deposit of the daily turnover / „пазар“ (the cash on the way from the till to the bank). */
  dailyTurnover: string; // 1009
  /** Cash withdrawn from the bank for the cash box (подигање готовина, материјални трошоци). */
  cashWithdraw: string; // 1020
  pos: string; // 1200001
  /** Purchase paid with the firm's payment card (MBDP / VISA* / POS merchant) — no partner. */
  card: string; // 1020
  /** Monthly profit-tax advance paid to the Ministry of Finance / Treasury („уплата мдб MM/YYYY“). */
  profitTax: string; // 2330
  /** Interest on late tax payments („камата“ to the Treasury / УЈП). */
  taxInterest: string; // 44792
  ddvPay: string; // 23008
  ddvClaim: string; // 1308
}

export const BANK_KONTA: BankKonta = {
  customer: '1200', supplier: '2200', importSupplier: '2210', fee: '4460', fxGain: '7810', fxLoss: '4810',
  fxDefault: '1030', transitFx: '1039', transit: '1009', dailyTurnover: '1009', cashWithdraw: '1020', pos: '1200001', card: '1020', profitTax: '2330', taxInterest: '44792', ddvPay: '23008', ddvClaim: '1308',
};

/** Chart entry as needed for the bank konto defaults / validation. */
export interface BankChartEntry { code: string; name: string }

/**
 * Transit defaults from the chart: own transfers in denars go to the analytic 10091 „Пренос на средства од сметка на
 * сметка денари“ when the chart has it (1009 „Предона сметка“ is synthetic; it stays the fallback). The FX transit
 * 1039 moves to an analytic only when one under 1039 is clearly a transfer konto (its name says „пренос“) — e.g.
 * 10391 „Девизни сметки паунд“ is not.
 */
export function bankTransitDefaults(chart: readonly BankChartEntry[] | undefined): Partial<BankKonta> {
  if (!chart?.length) return {};
  const out: Partial<BankKonta> = {};
  if (chart.some((a) => a.code === '10091')) out.transit = '10091';
  const fx = chart.filter((a) => a.code.length > 4 && a.code.startsWith(BANK_KONTA.transitFx) && /пренос/i.test(a.name)).sort((a, b) => (a.code < b.code ? -1 : 1))[0];
  if (fx) out.transitFx = fx.code;
  return out;
}

/** The kontos of „Конта за изводи“ an accountant may set per firm (`firms.settings.bankKonta`). */
export const BANK_KONTA_FIELDS: readonly { key: keyof BankKonta; label: string; note?: string }[] = [
  { key: 'customer', label: 'Наплата од купувач', note: 'со комитент' },
  { key: 'supplier', label: 'Плаќање на добавувач', note: 'со комитент' },
  { key: 'dailyTurnover', label: 'Уплата на дневен промет / пазар' },
  { key: 'cashWithdraw', label: 'Подигање готовина (материјални трошоци)' },
  { key: 'transit', label: 'Пренос меѓу сопствени сметки (денари)' },
  { key: 'transitFx', label: 'Пренос / откуп – девизни сметки' },
  { key: 'pos', label: 'Приливи од POS терминали' },
  { key: 'card', label: 'Плаќање со платежна картичка', note: 'без комитент' },
  { key: 'fee', label: 'Банкарски провизии / надоместоци', note: 'без комитент' },
  { key: 'profitTax', label: 'Аконтација данок на добивка (мдб)', note: 'без комитент' },
  { key: 'taxInterest', label: 'Камата за доцнење (даноци)', note: 'без комитент' },
];

/** A konto the bank lines may be booked on: in the chart and a real konto (4+ digits, not a class / group). */
export const bankKontoBookable = (chart: readonly BankChartEntry[], k: string): boolean => /^\d{4,10}$/.test(k) && chart.some((a) => a.code === k);

/** Validate the per-firm bank kontos against the chart; returns the cleaned overrides or the errors. */
export function validateBankKonta(input: Partial<Record<keyof BankKonta, string>>, chart: readonly BankChartEntry[]): { konta: Partial<BankKonta>; errors: string[] } {
  const konta: Partial<BankKonta> = {};
  const errors: string[] = [];
  for (const f of BANK_KONTA_FIELDS) {
    const v = String(input[f.key] ?? '').trim().split(/\s/)[0]!;
    if (!v) continue;
    if (!bankKontoBookable(chart, v)) errors.push(`${f.label}: контото ${v} го нема во контниот план.`);
    else konta[f.key] = v;
  }
  return { konta, errors };
}

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
  /** The firm's ЕДБ: a counterparty with this ЕДБ is the firm itself (own transfer). */
  firmEdb?: string;
  rules?: BankRule[];
  /** Learned payment-code rules `'<osnov>|in' | '<osnov>|out' → konto`. */
  osnovK?: Record<string, string>;
  /** POS partner id (legacy `posPid`); missing → result asks for one to be created. */
  posPartner?: string;
  konta?: Partial<BankKonta>;
  /** Payroll posting scheme (`pay_net`, `pay_pio`, …): kontos of salary / contribution payments recognised by the text. */
  payScheme?: Partial<PayScheme>;
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

export { ruleSideOk, wrongSideWarning } from './bank/side';
import { ruleSideOk } from './bank/side';

/** Supplier konto for a purchase. FIX #3: legacy base `autoMatch` always used 2200, even for imports. */
export const supplierKonto = (p: OpenDoc, konta?: Partial<BankKonta>): string => {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  if (p.konto) return p.konto;
  return p.imp ? p.supKonto || K.importSupplier : K.supplier;
};

/** Counter konto of a payment that settles `d`: the document's own konto when known, else customer / supplier. */
export const docKonto = (type: DocType, d: OpenDoc, konta?: Partial<BankKonta>): string =>
  d.konto || (type === 'invoice' ? { ...BANK_KONTA, ...(konta || {}) }.customer : supplierKonto(d, konta));

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

/**
 * The partner whose known accounts include the line's counterparty account – one company paying from any of its
 * accounts is the same partner, whatever its name looks like on the statement. Only when exactly ONE partner has that
 * account (two partners with the same account are a duplicate to merge, not a guess).
 */
export function partnerByAccount(partners: Partner[], counterAccount: unknown): string {
  const ca = String(counterAccount ?? '').replace(/[\s.-]+/g, '').toUpperCase();
  const key = (s: string) => (/^[A-Z]{2}\d{2}/.test(s) ? s.slice(4) : s).replace(/\D/g, '').slice(-15);
  const k = key(ca);
  if (k.length < 10) return '';
  const hit = partners.filter((p) => p.accs?.some((a) => key(String(a).replace(/[\s.-]+/g, '').toUpperCase()) === k));
  return hit.length === 1 ? hit[0]!.id : '';
}

/** The line's partner: by the counterparty account first, then by the name (`matchPartner`). */
export const linePartner = (partners: Partner[], b: Pick<BankRow, 'counterAccount'>, name: unknown): string =>
  partnerByAccount(partners, b.counterAccount) || matchPartner(partners, name, '');

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
  // a bare „07-2026“ / „7/2026“ is a period (salary month, rent month …), never an invoice number
  // (unless the text speaks of invoices, or it is the tail of a lettered number such as „EX-4/2026“)
  const docWord = /фактур|faktur|invoice|ф-?р[аи]|сметк|smetk/i.test(t);
  for (const m of t.matchAll(/\b\d{1,6}[\/\-]\d{2,4}\b/g)) {
    const x = m[0];
    if (isPeriodToken(x) && !docWord && !/\p{L}[-\/]?$/u.test(t.slice(Math.max(0, m.index - 2), m.index))) continue;
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

/** A period token „MM-YYYY“ / „MM/YYYY“ / „M.YYYY“ (month 1–12, year 2000–2099) — a payroll / rent month, not a document number. */
export const isPeriodToken = (x: unknown): boolean => /^(0?[1-9]|1[0-2])[\/\-.]20\d\d$/.test(String(x ?? '').trim());
/** The text mentions a period „MM-YYYY“ / „MM/YYYY“. */
export const PERIOD_RE = /(?:^|[^\d])(0?[1-9]|1[0-2])\s*[\/\-.]\s*20\d\d(?!\d)/;

/**
 * Document numbers with a letter prefix mentioned in a text („CLK-202606-1019“, „ФК-12/26“): the normalised token
 * (lowercase, without spaces) and its letter prefix (the series).
 */
export function docNoTokens(text: unknown): { raw: string; series: string }[] {
  const out: { raw: string; series: string }[] = [];
  for (const m of String(text ?? '').matchAll(/(?:^|[^\p{L}\d])(\p{L}{1,6}[-\/]?\d{2,}(?:[-\/.]\d+)*)/gu)) {
    const raw = m[1]!.toLowerCase();
    const series = raw.replace(/[\d\-\/.].*$/, '');
    if (/^(бр|br|nr|no|фак|fak|inv|ф|f|visa|mc|mbdp)$/.test(series)) continue; // keywords / card prefixes, not a series
    if (!out.some((o) => o.raw === raw)) out.push({ raw, series });
  }
  return out;
}

const normNo = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const seriesOf = (number: unknown) => normNo(number).replace(/[\d\-\/.].*$/, '');

/** The text contains the full document number as a token (≥ 5 characters with a letter or a separator, e.g. „CLK-202606-1019“). */
export function textHasDocNo(text: unknown, number: unknown): boolean {
  const n = normNo(number);
  if (n.length < 5 || !/\D/.test(n)) return false;
  const t = String(text ?? '').toLowerCase();
  let i = t.indexOf(n);
  while (i >= 0) {
    const a = t[i - 1], z = t[i + n.length];
    if (!(a && /[\p{L}\d]/u.test(a)) && !(z && /\d/.test(z))) return true;
    i = t.indexOf(n, i + 1);
  }
  return false;
}

/**
 * May a payment be matched by AMOUNT ALONE to document `d`? When the text names a document (by keyword / `n/yy`, or a
 * lettered number such as „CLK-202606-1019“), not to a DIFFERENT document of the same series and not to a document
 * dated after the payment.
 */
export function amountOnlyOk(text: string, b: Pick<BankRow, 'date'>, d: Pick<OpenDoc, 'number' | 'date'>): boolean {
  const Kn = bmNums(text).map(bmKey).filter(Boolean) as InvKey[];
  const T = docNoTokens(text);
  if (!Kn.length && !T.length) return true;
  if (Kn.some((k) => bmEq(bmKey(d.number), k, false)) || textHasDocNo(text, d.number)) return true;
  if (d.date > b.date) return false;
  const ser = seriesOf(d.number);
  if (ser && T.some((t) => t.series === ser)) return false;
  // a plain „123/26“ reference and a plain-numbered document: a different number of the same kind
  if (!ser && Kn.length) return false;
  return true;
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
    konto: docKonto(type, f, K),
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

export type MatchHow = 'pos' | 'vat' | 'osnov' | 'fx' | 'num' | 'amt' | 'sum' | 'fxnear' | 'invoice' | 'purchase' | 'fee' | 'payroll' | 'rule' | 'turnover' | 'cash' | 'card' | 'conv';

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

/**
 * Lines that never get a partner / invoice ({@link noPartnerLine}): bank charges → fee konto, card purchases → card konto
 * (a learned description rule wins for both), salaries → `pay_net` (the payroll run's split when `payMatch` finds it),
 * Treasury payroll contributions / PIT → their payroll kontos. A currency purchase on a denar account → FX bank konto.
 */
function layerNoPartner(w: Work): void {
  const { ctx, K } = w;
  const rules = ctx.rules || [];
  for (const b of w.rows.filter((b) => !b.ref && !(b.split && b.split.length) && !b.pos && !b.own && !b.conv && +b.amount && (!b.konto || b.ai || (BKPK_RE.test(String(b.konto)) && !b.manual)))) {
    if (!isFxAccount(ctx.accounts, b.acct) && isConversion(b)) {
      const nb: BankRow = { ...b, konto: convKonto(K), conv: true };
      delete nb.partner;
      delete nb.ai;
      commit(w, nb, 'conv');
      continue;
    }
    const hit = noPartnerLine(b, ctx);
    if (!hit?.konto) continue;
    const desc = low(b.desc);
    let nb: BankRow = { ...b, konto: hit.konto };
    let how: MatchHow = hit.kind === 'fee' ? 'fee' : hit.kind === 'card' ? 'card' : 'payroll';
    if (hit.kind === 'fee' || hit.kind === 'card') {
      const rule = rules.find((r) => r.match && desc.includes(r.match.toLowerCase()) && !BKPK_RE.test(String(r.konto)));
      if (rule) { nb.konto = rule.konto; how = 'rule'; }
    } else if (hit.kind === 'wage' && ctx.payMatch) {
      const pm = ctx.payMatch(Math.abs(+b.amount), b.date);
      if (pm) { nb = { ...nb, konto: pm.konto, payRef: pm.month, ...(pm.split ? { split: pm.split } : {}) }; }
    }
    delete nb.partner;
    delete nb.ai;
    delete nb.refs;
    commit(w, nb, how);
  }
}

/** The line never closes a document (bank, Treasury, card, salary — {@link noPartnerLine}). */
const noDoc = (b: BankRow, ctx: MatchContext) => !!noPartnerLine(b, ctx);

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
    if (noDoc(b, ctx)) continue;
    const inc = +b.amount > 0;
    const type: DocType = inc ? 'invoice' : 'purchase';
    const cur = bankOf(ctx.accounts, b.acct).cur;
    const amt = Math.abs(+b.amount);
    const acur = Math.abs(+(b.amountCur ?? 0) || 0);
    const docs = inc ? invoicesOf(ctx) : ctx.purchases.filter((p) => !p.cash && !p.pend);
    // FIX: stable date order (legacy comparator returned 1 for equal dates → engine-dependent order)
    const O = byDate(docs.filter((x) => !x.pend).map((x) => ({ x, o: x.total - (x.paidOther || 0) - (PB[type + x.id] ??= bankPaid(w.rows, type, x.id)) - (alloc[x.id] || 0) })).filter((z) => z.o > 0));
    const pid = b.partner || linePartner(ctx.partners, b, bankName(b, ctx.partners));
    const P = pid ? O.filter((z) => z.x.partner === pid) : [];
    const Kn = bmNums(b.desc).map(bmKey).filter(Boolean) as InvKey[];
    const ocur = (z: { x: OpenDoc; o: number }) => (z.x.cur === cur && +(z.x.fx || 0) ? toCents(fromCents(z.o) / +z.x.fx!) : null);
    const near = (z: { x: OpenDoc; o: number }) => {
      const oc = ocur(z);
      return oc != null && acur ? Math.abs(oc - acur) <= Math.max(2, oc * 0.001) : Math.abs(z.o - amt) / z.o < 0.04;
    };
    let pick: { x: OpenDoc; o: number } | null = null;
    if (Kn.length) { const pool = P.length ? P : O; pick = pool.find((z) => Kn.some((k) => bmEq(bmKey(z.x.number), k, !!P.length))) || null; }
    if (!pick) { const pool = P.length ? P : pid ? [] : O; const ex = pool.filter((z) => near(z) && amountOnlyOk(rowText(b), b, z.x)); if (ex.length && (P.length || ex.length === 1)) pick = ex[0]!; }
    if (!pick) continue;
    const z = pick;
    const oc = ocur(z);
    const full = near(z);
    const settle = full ? z.o : Math.min(z.o, oc != null && acur ? toCents(fromCents(acur) * +z.x.fx!) : amt);
    const nb: BankRow = { ...b, partner: z.x.partner || pid || b.partner, konto: docKonto(type, z.x, K), ref: { type, id: z.x.id, label: String(z.x.number || '') }, settle };
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
    if (noDoc(b, ctx)) continue;
    const inc = +b.amount > 0;
    const type: DocType = inc ? 'invoice' : 'purchase';
    const amt = Math.abs(+b.amount);
    const docs = inc ? invoicesOf(ctx) : ctx.purchases.filter((p) => !p.cash && !p.pend);
    const O = byDate(docs.map((x) => ({ x, o: x.total - (x.paidOther || 0) - (PB[type + x.id] ??= bankPaid(w.rows, type, x.id)) - (alloc[x.id] || 0) })).filter((z) => z.o > 0 && !z.x.pend));
    const pid = b.partner || linePartner(ctx.partners, b, bankName(b, ctx.partners));
    const P = pid ? O.filter((z) => z.x.partner === pid) : [];
    // the payer's partner has no open document at all (a partner the statement created, a name read differently —
    // „АГЕНЦИЈА ЗА ВРАБОТУВАЊЕ НА РМ-ГЛАВН“): the documents decide — every open document is searched by its number
    // and by a unique exact amount, and the payment goes to the document's own partner
    const known = P.length > 0;
    const Kn = bmNums(b.desc).map(bmKey).filter(Boolean) as InvKey[];
    let pick: { x: OpenDoc; o: number }[] | null = null;
    let how: MatchHow = 'num';
    const text = rowText(b);
    // the full document number in the text („CLK-202606-1019“) wins over a partial / weak number match
    const exact = (known ? O.filter((z) => !z.x.partner || z.x.partner === pid) : O).filter((z) => textHasDocNo(text, z.x.number));
    if (exact.length) { pick = exact; how = 'num'; }
    if (!pick && Kn.length) {
      const pool = known ? P : O;
      const hits = pool.filter((z) => Kn.some((k) => bmEq(bmKey(z.x.number), k, known)));
      if (hits.length) { pick = hits; how = 'num'; }
    }
    if (!pick) {
      const pool = (known ? P : O).filter((z) => amountOnlyOk(text, b, z.x));
      const ex = pool.filter((z) => z.o === amt);
      if (ex.length && (known || ex.length === 1)) { pick = [ex[0]!]; how = 'amt'; }
      else if (pool.length > 1 && known) { const ss = bmSubset(pool, amt); if (ss) { pick = ss; how = 'sum'; } }
    }
    if (!pick) continue;
    // a document of another partner found for an unknown / document-less payer: the document's partner
    const owner = known ? pid : (pick.every((z) => z.x.partner === pick![0]!.x.partner) && pick[0]!.x.partner) || pid;
    const r = linkRow(b, pick, type, owner, K);
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
    if (noDoc(b, ctx)) continue;
    const text = rowText(b);
    // a deposit of the daily turnover / a cash withdrawal says so in its description: never an invoice by amount
    const kw = keywordKonto(b, ctx.accounts, K);
    if (kw && !ownTransferBy(b, ctx)) {
      const rule = rules.find((r) => r.match && desc.includes(r.match.toLowerCase()) && ruleSideOk(r.konto, +b.amount));
      commit(w, { ...b, konto: rule ? rule.konto : kw.konto }, rule ? 'rule' : kw.cls);
      continue;
    }
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
        const nb: BankRow = { ...b, ref: { type: c.t, id: c.x.id, label: String(c.x.number ?? '') }, partner: c.x.partner, konto: docKonto(c.t, c.x, K), settle: c.o };
        if (!nb.partner) delete nb.partner;
        commit(w, nb, 'fxnear');
        continue;
      }
    } else if (+b.amount > 0) {
      const cand = invoicesOf(ctx).filter((i) => !i.pend && !used.has(i.id) && open('invoice', i) === amt && amountOnlyOk(text, b, i));
      const i = cand.find((i) => desc.includes(String(i.number).split('/')[0]!) || desc.includes(nm8(i))) || cand[0];
      if (i) hit = { type: 'invoice', doc: i };
    } else if (BANK_FEE.test(desc) && !ctx.purchases.some((p) => !used.has(p.id) && p.number && desc.includes(low(p.number)) && open('purchase', p) === amt)) {
      const fk = rules.find((r) => r.match && desc.includes(r.match.toLowerCase()) && ruleSideOk(r.konto, +b.amount));
      commit(w, { ...b, konto: fk ? fk.konto : K.fee }, 'fee');
      continue;
    } else {
      const cand = ctx.purchases.filter((p) => !p.pend && !used.has(p.id) && open('purchase', p) === amt && amountOnlyOk(text, b, p));
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
      const nb: BankRow = { ...b, ref: { type: hit.type, id: hit.doc.id, label: String(hit.doc.number ?? '') }, partner: hit.doc.partner, konto: docKonto(hit.type, hit.doc, K) };
      if (!nb.partner) delete nb.partner;
      commit(w, nb, hit.type);
      continue;
    }
    const rule = rules.find((r) => r.match && desc.includes(r.match.toLowerCase()) && ruleSideOk(r.konto, +b.amount));
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
  layerNoPartner(w);
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
  const pid = b.partner || linePartner(ctx.partners, b, bankName(b, ctx.partners));
  const O = byDate(docs.filter((x) => !x.pend && (!pid || x.partner === pid)).map((x) => ({ x, o: openAmount(ctx.rows, type, x) })).filter((z) => z.o > 0));
  return { type, pid, O };
}

/**
 * The receivable / payable konto of a partner's open documents for a payment without a document link: when all of
 * them are booked on one konto (e.g. 1200009 for invoices exempt under чл. 24 / чл. 32-а), that konto — so the payment
 * closes the open items where they were posted; else undefined (the customer / supplier default).
 */
export function partnerOpenKonto(ctx: MatchContext, pid: string, amount: number): string | undefined {
  if (!pid || !amount) return undefined;
  const { type, O } = openDocsFor({ id: '', date: '', amount, desc: '', partner: pid }, ctx);
  const ks = new Set(O.map((z) => docKonto(type, z.x, ctx.konta)));
  return ks.size === 1 ? [...ks][0] : undefined;
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

/**
 * Manual link on a foreign-currency account (legacy `bmRunFx` near-amount rule applied to a manual pick): when
 * the denar amount is within 4 % of the picked documents' open total, the documents are closed completely and
 * the difference is an FX difference (`settle` → 7810 / 4810 in `bankEntries`). Otherwise a plain
 * {@link linkPayment}.
 */
export function linkPaymentFx(b: BankRow, pick: { x: OpenDoc; o: number }[], type: DocType, konta?: Partial<BankKonta>): { row: BankRow; refs: DocRefAmt[]; excess: number } | null {
  const amt = Math.abs(+b.amount);
  const open = pick.reduce((s, z) => s + z.o, 0);
  if (!open || Math.abs(open - amt) / open >= 0.04) return linkPayment(b, pick, type, konta);
  const r = linkPayment({ ...b, amount: Math.sign(+b.amount || 1) * open }, pick, type, konta);
  if (!r) return null;
  const row: BankRow = { ...r.row, amount: b.amount, settle: open };
  if (r.refs.length > 1) row.refs = r.refs;
  else delete row.refs;
  return { row, refs: r.refs, excess: 0 };
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

export type SelfBy = 'acct' | 'edb' | 'name';

/**
 * Is the counterparty the firm itself? `acct`: the counterparty account (or an account number in the description) is
 * another of the firm's own bank accounts; `edb`: the firm's ЕДБ is in the line; `name`: the counterparty name is the
 * firm's name, also with a branch suffix („ФУЛЛАМ ДООЕЛ Скопје-КУМАНОВО“, „… СКОПЈЕ - ЦЕНТАР“; legacy `bkOwn` 12564).
 */
export function selfCounterparty(b: BankRow, ctx: Pick<MatchContext, 'firmName' | 'firmEdb' | 'accounts' | 'partners'>): SelfBy | null {
  const others = ctx.accounts.filter((x) => x.id !== acctOf(b) && dig(x.account).length >= 10);
  const ca = dig(b.counterAccount);
  if (ca.length >= 10 && others.some((x) => ca.endsWith(dig(x.account).slice(-10)) || dig(x.account).endsWith(ca.slice(-10)))) return 'acct';
  const d = dig(b.desc);
  if (others.some((x) => d.includes(dig(x.account).slice(-10)))) return 'acct';
  const fe = dig(ctx.firmEdb);
  if (fe.length >= 7) {
    const runs = (String(b.desc || '') + ' ' + String(b.purpose || '') + ' ' + String(b.name || '')).match(/\d{7,}/g) || [];
    if (runs.some((r) => r === fe || (fe.length === 13 && r.endsWith(fe)))) return 'edb';
  }
  const me = bkCore(ctx.firmName);
  if (me.length < 4) return null;
  const nm = bkCore(bankName(b, ctx.partners) || b.desc || '');
  if (!nm) return null;
  if (nm === me || nm.startsWith(me + ' ') || (me.startsWith(nm + ' ') && nm.length >= 6)) return 'name';
  return null;
}

/** Legacy `bkOwn` (12564): transfer between the firm's own accounts (the counterparty is the firm itself). */
export function isOwnTransfer(b: BankRow, ctx: Pick<MatchContext, 'firmName' | 'firmEdb' | 'accounts' | 'partners'>): boolean {
  return selfCounterparty(b, ctx) != null;
}

/**
 * An own-account transfer line: the counterparty is the firm itself — but a line recognised only by the NAME that says
 * it is a deposit of the daily turnover / a cash withdrawal is not (the firm's cashier pays the takings in, or takes
 * cash out, in the firm's name; such a line belongs on `dailyTurnover` / `cashWithdraw`).
 */
export function ownTransferBy(b: BankRow, ctx: Pick<MatchContext, 'firmName' | 'firmEdb' | 'accounts' | 'partners' | 'konta'>): SelfBy | null {
  const by = selfCounterparty(b, ctx);
  if (by === 'name' && keywordKonto(b, ctx.accounts, ctx.konta)) return null;
  // payment code 903 = „Пренос од средства на делот на правно лице и обратно“ — a transfer between the firm's own accounts
  if (!by && String(b.osnov ?? '').trim() === '903' && !isFxAccount(ctx.accounts, b.acct)) return 'name';
  return by;
}

/** Legacy `CONV_RE` / `isConv` (12754, 12757): currency purchase/sale. */
export const CONV_RE = /откуп\s+на\s+(денари|девиз)|откуп\s+на\s+с[-‐]?(редст)?ва\s+од\s+деви|денарска\s+противвредност|откуп\s+девиз|продажба\s+на\s+девиз|купување\s+(на\s+)?девиз|купопродажба\s+(на\s+)?девиз|конверзиј|менувач|otkup\s+(na\s+)?(denar|deviz)|kupoprodaj|kupoprodazb|konverzij|currency\s+exchange|fx\s+(deal|conversion)/i;
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

/** Counter konto of a currency purchase / sale (both sides): the FX transit 1039 „Предони девизни сметки“. */
export const convKonto = (konta?: Partial<BankKonta>): string => ({ ...BANK_KONTA, ...(konta || {}) }).transitFx;

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
  // the bank, the Treasury, a card merchant or an employee is never a customer / supplier
  if (noPartnerLine(b)) return {};
  const nm = bankName(b, ctx.partners);
  if (b.konto) {
    if (!nm || nm.length < 3) { const pa = partnerByAccount(ctx.partners, b.counterAccount); return pa ? { partner: pa } : {}; }
    const pid = linePartner(ctx.partners, b, nm);
    return pid ? { partner: pid } : { newPartner: nm };
  }
  const pid = linePartner(ctx.partners, b, nm);
  return pid ? { partner: pid } : {};
}

export type ImportClass = 'pos' | 'conv' | 'own' | 'turnover' | 'cash' | 'fee' | 'card' | null;

/**
 * Deposit of the daily turnover (уплата на дневен промет / пазар). Only what the description says outright — the
 * statement's own „дневен промет“ total rows never reach here (the parsers drop them).
 */
export const TURNOVER_RE = /дневен\s+(промет|пазар)|днев\.?\s+(промет|пазар)|(уплата|полог|депонирање)\s+(на\s+)?(дневен\s+|дневниот\s+)?(промет|пазар)|dneven\s+(promet|pazar)|(uplata|polog)\s+(na\s+)?(dneven\s+)?(promet|pazar)/i;
/**
 * Cash withdrawn for the cash box (legacy classification prompt 4865: „подигнување готовина, исплата на готово,
 * банкомат → 1020“; the owner: „материјални трошоци“ → 1020).
 */
export const CASH_WD_RE = /подиг(нув|)ање\s+(на\s+)?готовин|исплата\s+(на|во)\s+готов|банкомат|материјални\s+трошоци|podig(nuv)?anje\s+(na\s+)?gotovin|isplata\s+(na|vo)\s+gotov|\batm\b/i;

const rowText = (b: BankRow) => String(b.desc || '') + ' ' + String(b.purpose || '');

/** Daily-turnover deposit (inflow on a denar account) or cash withdrawal (outflow on a denar account) by the description. */
export function keywordKonto(b: BankRow, accounts: BankAccount[], konta?: Partial<BankKonta>): { konto: string; cls: 'turnover' | 'cash' } | null {
  if (isFxAccount(accounts, b.acct) || b.conv) return null;
  const K = { ...BANK_KONTA, ...(konta || {}) };
  const t = rowText(b);
  // payment code 800 = „Уплата во готово на сопствена сметка од дневен пазар“ (НБРСМ шифри на плаќање)
  if (+b.amount > 0 && (TURNOVER_RE.test(t) || String(b.osnov ?? '').trim() === '800')) return { konto: K.dailyTurnover, cls: 'turnover' };
  if (+b.amount < 0 && CASH_WD_RE.test(t)) return { konto: K.cashWithdraw, cls: 'cash' };
  return null;
}

/* ================================================================== counterparties that are never a partner */

/** Macedonian banks (and generic „банка / bank“) as a counterparty name. */
export const BANK_NAME_RE = /(^|[^\p{L}])(нлб|nlb|халк\s*банк\S*|halk\s*bank\S*|стопанска\s+банка|stopanska\s+banka|комерцијална\s+банка|komercijalna\s+banka|шпаркасе|sparkasse|уни\s*банка|uni\s*bank\S*|прокредит|procredit|силк\s*роуд|silk\s*road|ттк\s+банка|ttk\s+bank\S*|централна\s+кооперативна|алта\s+банка|alta\s+bank\S*|капитал\s+банка|банка|banka|bank)(?![\p{L}])/iu;
/** The Treasury („Трезор на РМ“, treasury account 100000000063095) — taxes and contributions, never a partner. */
export const TREASURY_RE = /трезор|trezor|treasury|буџет\s+на\s+(рсм|рм|република)|budzet\s+na\s+(rsm|rm)|министерство\s+за\s+финансии|ministerstvo\s+za\s+finansii|управа\s+за\s+јавни\s+приходи|uprava\s+za\s+javni\s+prihodi|(^|[^\p{L}])(ујп|ujp)(?![\p{L}])/iu;
const TREASURY_ACC = '100000000063095';
/** Card purchase on the firm's payment card: „MBDP:8330:…“, „VISA*6874 -Ramstor …“, „POS купување …“. */
export const CARD_RE = /\bMBDP\s*:\s*\d|\b(VISA|MASTER\s?CARD|MC|MAESTRO)\s*\*\s*\d{3,}|\bPOS\s*(купување|плаќање|kupuvanje|plakanje|purchase)|(плаќање|купување)\s+(со|на)\s+(платежна\s+)?картичк|\bcard\s+purchase\b/i;
/** Bank's own charges: provisions, e-banking, account maintenance, fees. */
export const BANK_CHARGE_RE = /\[autoprov\]|провизи|provizi|електронско\s+банкарство|elektronsko\s+bankarstvo|одржување|odrzuvanje|надоместо?к|nadomesto?k|пакет\s+(на\s+)?услуги|членарина\s+за\s+картичк/i;
/** Salary words: плата / нето / регрес / аконтација на плата … */
const WAGE_RE = /(^|[^\p{L}])(плат[аи]|нето|регрес|аконтациј\S*\s+(на\s+)?плат\S*|plat[aeë]|neto|regres)(?![\p{L}])/iu;
/** Payroll payment reference „910…+ MM-YYYY“ (the salary reference followed by the payroll month). */
const PAYREF_RE = /(^|\D)910\d{8,}\s*\+?\s*(0?[1-9]|1[0-2])\s*[\/\-.]\s*20\d\d(?!\d)/;
/** Company-form words: the counterparty is not a natural person. */
const FIRM_WORD_RE = /(^|[^\p{L}])(доо|дооел|ад|тп|јтд|дпту|дпу|ооо|doo|dooel|ad|tp|ltd|llc|gmbh|на|na|рсм|рм|rsm|република|буџет|budzet|друштво|компанија|company|маркет|market|трезор|trezor|управа|uprava|фонд|fond|општина|opstina|агенција|agencija|центар|centar|министерство|банка|banka|bank|нлб|nlb|халк|halk)(?![\p{L}])/iu;
/** Rent / lease to a natural person — not a salary even with a period. */
const RENT_RE = /закуп|кирија|наем|zakup|kirija|najem|qira/i;

/** The counterparty name as printed (the name field, else the description before the first digit / separator). */
function leadName(b: BankRow): string {
  if (b.name && String(b.name).trim()) return String(b.name).trim();
  return String(b.desc ?? '').split(/[\d,;·*\[:]| - | – /)[0]!.trim();
}

/** A natural person's name: 2–3 words of letters, none of them a company / institution word. */
export function isPersonName(name: unknown): boolean {
  const n = String(name ?? '').replace(/[„“”"'.]/g, ' ').trim();
  if (!n || FIRM_WORD_RE.test(n)) return false;
  const w = n.split(/\s+/);
  return w.length >= 2 && w.length <= 3 && w.every((x) => /^\p{L}{2,}(-\p{L}{2,})?$/u.test(x));
}

export type PayrollPart = 'net' | 'pio' | 'zdr' | 'vrab' | 'dop' | 'tax';

/** Payroll scheme key of a payroll part. */
const PAY_KEY: Record<PayrollPart, keyof PayScheme> = { net: 'pay_net', pio: 'pay_pio', zdr: 'pay_zdr', vrab: 'pay_vrab', dop: 'pay_dop', tax: 'pay_tax' };

/** Konto of a payroll part from the firm's payroll scheme (a switched-off part → `pay_contrib`). */
export function payrollKonto(part: PayrollPart, scheme?: Partial<PayScheme>): string {
  const S = { ...PAY_SCH0, ...Object.fromEntries(Object.entries(scheme ?? {}).filter(([, v]) => v)) } as PayScheme;
  const k = S[PAY_KEY[part]];
  return k && k !== '-' ? k : S.pay_contrib;
}

export type NoPartnerKind = 'fee' | 'card' | 'bank' | 'treasury' | 'wage';

export interface NoPartnerHit {
  kind: NoPartnerKind;
  /** Proposed konto; undefined = leave for the user (but never a partner / document). */
  konto?: string;
  /** Payroll part for `wage` / `treasury`. */
  part?: PayrollPart;
}

/**
 * Statement lines whose counterparty is NEVER a customer / supplier (no partner on 1200/2200, no invoice match):
 * - the bank itself (the bank of the statement's account or any bank): provisions / e-banking / maintenance → `fee`
 *   (4460); other bank lines (loan, interest) → no proposal;
 * - a card purchase on the firm's card (MBDP / VISA* / POS merchant) → `card` (1020);
 * - the Treasury („Трезор на РМ“): payroll contributions / PIT by the hints in the text → the payroll scheme kontos;
 *   anything else → no proposal;
 * - a salary payment (reference „910…+ MM-YYYY“, salary words, or a natural person with a payroll period) → `pay_net`.
 */
export function noPartnerLine(b: BankRow, ctx: Pick<MatchContext, 'konta' | 'payScheme'> = {}): NoPartnerHit | null {
  const K = kOf(ctx);
  const out = +b.amount < 0;
  const name = leadName(b);
  const t = [b.name, b.desc, b.purpose].filter(Boolean).join(' ');
  const treasury = TREASURY_RE.test(name) || TREASURY_RE.test(t) || dig(b.counterAccount) === TREASURY_ACC;
  if (treasury) {
    // VAT, the monthly profit-tax advance („уплата мдб 06/2026“) and interest on late tax: the firm's tax kontos
    if (/(^|[^\p{L}])(ддв|ddv)(?![\p{L}])|данок\s+на\s+додадена|danok\s+na\s+dodadena/iu.test(t)) return { kind: 'treasury', konto: out ? K.ddvPay : K.ddvClaim };
    if (out && /камат|kamat/i.test(t)) return { kind: 'treasury', konto: K.taxInterest };
    if (out && /(^|[^\p{L}])(мдб|mdb)(?![\p{L}])|данок\s+на\s+добивк|danok\s+na\s+dobivk|аконтациј\S*\s+(на\s+)?(данок|ддб)/iu.test(t)) return { kind: 'treasury', konto: K.profitTax };
    const payref = PAYREF_RE.test(t) || PERIOD_RE.test(t) || WAGE_RE.test(t) || /придонес|pridones/i.test(t);
    const part: PayrollPart | null = !payref || !out ? null
      : /0[.,]5\s*%|дополнител|dopolnitel|dodatn|додатн/i.test(t) ? 'dop'
        : /вработ|vrabot/i.test(t) ? 'vrab'
          : /здравств|zdravstv/i.test(t) ? 'zdr'
            : /пензи|penzi|(^|[^\p{L}])(пио|pio)(?![\p{L}])/iu.test(t) ? 'pio'
              : /(данок|danok|пдд|\bpdd\b|personal)/i.test(t) && !/добивк|dobivk|ддв|\bddv\b|имот|imot/i.test(t) ? 'tax'
                : null;
    return part ? { kind: 'treasury', part, konto: payrollKonto(part, ctx.payScheme) } : { kind: 'treasury' };
  }
  const bankCp = BANK_NAME_RE.test(name);
  if (out && CARD_RE.test(t)) return { kind: 'card', konto: K.card };
  if (bankCp || /\[autoprov\]/i.test(t)) {
    if (out && (BANK_CHARGE_RE.test(t) || BANK_FEE.test(t))) return { kind: 'fee', konto: K.fee };
    return { kind: 'bank' };
  }
  if (out && !RENT_RE.test(t)) {
    const period = PERIOD_RE.test(t);
    const person = isPersonName(name);
    if (PAYREF_RE.test(t) || (WAGE_RE.test(t) && (person || period)) || (person && (period || /надоместо?к|nadomesto?k/i.test(t)))) {
      return { kind: 'wage', part: 'net', konto: payrollKonto('net', ctx.payScheme) };
    }
  }
  return null;
}

/**
 * Classify a freshly imported row (legacy `save('bank')` wrappers, outermost first — FIX #5: one
 * explicit pipeline instead of order-dependent persistence hooks):
 * 1. POS card inflow → POS konto + POS partner (13072)
 * 2. currency purchase/sale → the FX transit 1039 on both sides (FIX, owner's rule; legacy 12758: FX bank konto / neutral FX side)
 * 3. own-account transfer (counterparty = the firm itself, `ownTransferBy`) → transit 1039 (FX) / `transit` (10091 when
 *    in the chart, else 1009) (12568), on both sides of the transfer
 * 4. deposit of the daily turnover → `dailyTurnover` (1009), cash withdrawal → `cashWithdraw` (1020) — by the description
 * 5. partner for 12x/22x rows (12421)
 * Steps 1–4 only apply to rows without konto/ref/split. Run {@link pairConversions} after a batch.
 */
export function classifyImported(row: BankRow, ctx: Pick<MatchContext, 'accounts' | 'partners' | 'invoices' | 'purchases' | 'firmName' | 'firmEdb' | 'posPartner' | 'konta'>): { row: BankRow; cls: ImportClass; newPartner?: string; needPosPartner?: boolean; newOwnAccount?: string } {
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
    // both sides of a currency purchase / sale go through the FX transit „Предони девизни сметки“ (1039): денари → 1039,
    // девизи ← 1039 (the owner's rule; legacy booked the denar side straight on the FX bank konto)
    b = { ...b, konto: convKonto(K), conv: true };
    if (isFxAccount(ctx.accounts, b.acct)) b.own = true;
    else delete b.own;
    delete b.partner;
    cls = 'conv';
  }
  // own transfer first (counterparty = the firm itself: own account, ЕДБ or name) — except a turnover deposit / cash
  // withdrawal recognised only by the name (paid in / taken out in the firm's name)
  const self = free(b) ? ownTransferBy(b, ctx) : null;
  let newOwnAccount: string | undefined;
  if (free(b) && self) {
    b = { ...b, konto: isFxAccount(ctx.accounts, b.acct) || /откуп|девиз|конверз|kupoproda|otkup|deviz|convers|exchange/i.test(String(b.desc || '')) ? K.transitFx : K.transit, own: true };
    delete b.partner;
    cls = 'own';
    // the firm itself by name / ЕДБ from an account that is not registered: offer it as an own account
    const ca = dig(row.counterAccount);
    if (self !== 'acct' && ca.length >= 10 && !ctx.accounts.some((x) => dig(x.account).length >= 10 && (ca.endsWith(dig(x.account).slice(-10)) || dig(x.account).endsWith(ca.slice(-10))))) newOwnAccount = String(row.counterAccount);
  }
  const kw = free(b) && !b.own ? keywordKonto(b, ctx.accounts, K) : null;
  if (kw) {
    b = { ...b, konto: kw.konto };
    delete b.partner;
    cls = kw.cls;
  }
  // bank charges / card purchases / salaries / the Treasury are never a partner (`resolvePartner`); their kontos are
  // proposed by the matching / review, not set at import
  let newPartner: string | undefined;
  if (!b.partner && BKPK_RE.test(bankEffKonto(b))) {
    const r = resolvePartner(b, ctx);
    if (r.partner) b = { ...b, partner: r.partner };
    else if (r.newPartner) newPartner = r.newPartner;
  }
  return { row: b, cls, ...(newPartner ? { newPartner } : {}), ...(needPosPartner ? { needPosPartner } : {}), ...(newOwnAccount ? { newOwnAccount } : {}) };
}

/**
 * Legacy `convPair` (12769): an FX-account row parked on the FX transit konto (1039) on the same day as
 * an opposite denar currency purchase/sale (within 5 %) is the FX side of that conversion. FIX (owner's rule): it stays
 * on 1039 (the denar side is booked on 1039 too, so the transit closes; the residue is the FX difference) — legacy made
 * it neutral on the FX bank konto. Returns the rows to update.
 */
export function pairConversions(rows: BankRow[], accounts: BankAccount[], konta?: Partial<BankKonta>): BankRow[] {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  const out: BankRow[] = [];
  for (const x of rows) {
    if (!isFxAccount(accounts, x.acct) || x.conv || x.ref || String(x.konto) !== K.transitFx) continue;
    const sgn = Math.sign(+x.amount);
    const mk = rows.find((y) => !isFxAccount(accounts, y.acct) && y.conv && y.date === x.date && Math.sign(+y.amount) === -sgn && Math.abs(Math.abs(+y.amount) - Math.abs(+x.amount)) <= Math.abs(+x.amount) * 0.05);
    // the FX side stays on the transit (the denar side is booked there too); it is only marked as the conversion
    if (mk) out.push({ ...x, conv: true });
  }
  return out;
}

/** Legacy ACT `feeFix` (12406). FIX #2: bank fees belong on 4460 — rows booked on 2200/4400 without a document. */
export function feeFix(rows: BankRow[], year?: number | string, konta?: Partial<BankKonta>): BankRow[] {
  const K = { ...BANK_KONTA, ...(konta || {}) };
  return rows
    .filter((b) => (year == null || String(b.date).startsWith(String(year))) && +b.amount < 0 && !b.ref && ['2200', '4400'].includes(String(b.konto)) && (BANK_FEE.test(String(b.desc || '')) || noPartnerLine(b)?.kind === 'fee'))
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
 * Legacy `fxSrc` (6498): where the rate shown under the „Курс“ field comes from — „фирма“ (firm currency
 * codebook), „курсна листа dd.mm.yyyy“ (newest office rate on or before `date`) or „стандарден dd.mm.yyyy“.
 */
export function fxRateSource(cur: string, date: string, sources: { firm?: FxRateRow[]; office?: FxRateRow[] } = {}): string {
  const c = String(cur || '').toUpperCase();
  if (!c || c === 'MKD') return '';
  if ((sources.firm || []).some((x) => String(x.cur).toUpperCase() === c && +x.rate)) return 'фирма';
  const d2 = (d: string) => d.slice(0, 10).split('-').reverse().join('.');
  const g = (sources.office || []).filter((x) => String(x.cur).toUpperCase() === c && x.date && x.date <= date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return g ? 'курсна листа ' + d2(g.date!) : 'стандарден ' + d2(FX_DATE0);
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
