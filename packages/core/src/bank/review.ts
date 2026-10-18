/**
 * UX Phase 3 (docs/ux-rindertim.md P2/P28, P3/P29): ONE pass that proposes a booking for every unbooked statement
 * line, and the confidence of each proposal.
 *
 * The pass (pure, nothing is written):
 *  1. `ref` — the payment reference („Повикување на број“, `bref`) or the purpose names an open document;
 *  2. the existing matching `autoMatch` (POS, VAT, learned payment-code rules, FX invoices, invoice number / exact
 *     amount / subset sum, fees, payroll, description rules);
 *  3. `fifo` — a payment of a KNOWN partner that matched nothing exactly is spread over the partner's open documents,
 *     oldest first, the last one partially (an excess stays an advance on the partner).
 * Allocations are capped at the open amounts (`allocatePayment`), and every proposal sees the allocations of the
 * proposals before it, so accepting all of them never pays a document twice.
 *
 * The program PREPARES and a person CONFIRMS: {@link reviewConfidence} sorts a proposal into „сигурно“ / „веројатно“ /
 * „рачно“; only „сигурно“ may ever be confirmed without looking at it, and only when the owner switched that step on
 * (`autoSteps`, all OFF by default).
 */
import {
  amountOnlyOk, autoMatch, BANK_FEE, isConversion, isPeriodToken, noPartnerLine, bankName, bmEq, bmKey, bmNums, BKPK_RE, fifoPick, isFxAccount, isVatPayment, keywordKonto, linkPayment, linePartner, matchPartner,
  openAmount, openDocsFor, ownTransferBy, type BankRow, type DocRefAmt, type DocType, type InvKey, type MatchContext, type MatchHow,
} from '../bank-match';

export type ReviewHow = MatchHow | 'ref' | 'fifo';

export interface ReviewChange {
  id: string;
  how: ReviewHow;
  /** The booked row (konto, partner, document link). */
  row: BankRow;
  refs?: DocRefAmt[];
  /** Payment part not allocated to a document (cents) — an advance on the partner. */
  excess?: number;
  newPartner?: string;
  /** The partner named on the statement (or already on the line) is the partner of the proposal. */
  partnerOk: boolean;
}

/** Line that the pass may (re)book: unbooked, or on a customer / supplier konto without a document. */
const candidate = (r: BankRow) => !r.ref && !(r.split && r.split.length) && !r.pos && !r.own && !r.conv && !!+r.amount && (!r.konto || BKPK_RE.test(r.konto));

/** Document numbers in the payment reference and the purpose (the description is read by `autoMatch` itself). */
export function refNumbers(b: Pick<BankRow, 'bref' | 'purpose'>): InvKey[] {
  const raw = [...bmNums(b.purpose), ...bmNums(b.bref)];
  // a bare reference („2026-0045“, „45/26“, „MK 0045 26“): its digit groups as one number
  const br = String(b.bref ?? '').replace(/^\s*(MK|HR|SI)\s*\d{2}\s*/i, '').trim();
  if (/\d/.test(br) && !raw.length && !isPeriodToken(br) && !/^910\d{8,}/.test(br)) raw.push(br.replace(/\s+/g, '/'));
  const out: InvKey[] = [];
  for (const x of raw) {
    const k = bmKey(x);
    if (k && k.n > 0 && !out.some((o) => o.raw === k.raw)) out.push(k);
  }
  return out;
}

const openOf = (rows: BankRow[], ctx: MatchContext, b: BankRow, pid: string) => openDocsFor({ ...b, partner: pid || undefined }, { ...ctx, rows });

/** A line whose text says it is not a document payment (own transfer, turnover / cash, fee, VAT). */
function notDocPayment(b: BankRow, ctx: MatchContext): boolean {
  return !!ownTransferBy(b, ctx) || !!keywordKonto(b, ctx.accounts, ctx.konta) || (+b.amount < 0 && BANK_FEE.test(String(b.desc ?? ''))) || isVatPayment(b)
    || !!noPartnerLine(b, ctx) || isConversion(b);
}

/**
 * The one pass over the context rows. `ids` = the lines to propose for (default: every candidate of the year);
 * the other rows only count for the open amounts. Returns the proposals by line id.
 */
export function reviewMatch(ctx: MatchContext, ids?: ReadonlySet<string>): Map<string, ReviewChange> {
  const inYear = (d: string) => ctx.year == null || String(d).startsWith(String(ctx.year));
  const want = (r: BankRow) => candidate(r) && inYear(r.date) && (!ids || ids.has(r.id));
  const rows = ctx.rows.slice();
  const out = new Map<string, ReviewChange>();
  const orig = new Map(ctx.rows.map((r) => [r.id, r]));
  const namePid = (r: BankRow) => r.partner || linePartner(ctx.partners, r, bankName(r, ctx.partners));
  const ok = (id: string, partner?: string) => { const o = orig.get(id); const p = o ? namePid(o) : ''; return !!p && p === partner; };
  const put = (i: number, c: Omit<ReviewChange, 'partnerOk'>) => {
    rows[i] = c.row;
    out.set(c.id, { ...c, partnerOk: ok(c.id, c.row.partner) });
  };
  const byDate = rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : 0));

  // 1) reference / purpose → document (MKD accounts; FX invoices are closed by `autoMatch` with the FX difference)
  for (const { r, i } of byDate) {
    if (!want(r) || isFxAccount(ctx.accounts, r.acct) || notDocPayment(r, ctx)) continue;
    const K = refNumbers(r);
    if (!K.length) continue;
    const type: DocType = +r.amount > 0 ? 'invoice' : 'purchase';
    const pid = namePid(r);
    const P = pid ? openOf(rows, ctx, r, pid).O : [];
    // without the partner's open documents: any document with exactly that number (open amounts only for the hits)
    const pool = P.length ? P : (() => {
      const D = (type === 'invoice' ? ctx.invoices.filter((i) => !i.credit) : ctx.purchases.filter((p) => !p.cash)).filter((d) => !d.pend && K.some((k) => bmEq(bmKey(d.number), k, false)));
      return D.map((x) => ({ x, o: openAmount(rows, type, x) })).filter((z) => z.o > 0).sort((a, b) => (a.x.date < b.x.date ? -1 : a.x.date > b.x.date ? 1 : 0));
    })();
    const hits = pool.filter((z) => K.some((k) => bmEq(bmKey(z.x.number), k, !!P.length)));
    if (!hits.length) continue;
    const l = linkPayment(rows[i]!, hits, type, ctx.konta);
    if (!l) continue;
    put(i, { id: r.id, how: 'ref', row: l.row, refs: l.refs, ...(l.excess ? { excess: l.excess } : {}) });
  }

  // 2) the existing matching on the rows with the references already linked
  const m = autoMatch({ ...ctx, rows });
  for (const c of m.changes) {
    if (out.get(c.id)?.how === 'ref') continue;
    const i = rows.findIndex((x) => x.id === c.id);
    if (i < 0 || !want(orig.get(c.id)!)) continue;
    const refs = c.refs ?? (c.row.ref ? [{ ...c.row.ref, amt: c.row.settle ?? Math.abs(+c.row.amount) }] : undefined);
    put(i, { id: c.id, how: c.how, row: c.row, ...(refs ? { refs } : {}), ...(c.excess ? { excess: c.excess } : {}), ...(c.newPartner ? { newPartner: c.newPartner } : {}) });
  }
  // rows after matching (the documents linked in step 2 are paid for step 3)
  for (const [id, c] of out) { const i = rows.findIndex((x) => x.id === id); if (i >= 0) rows[i] = c.row; }

  // 3) FIFO over the partner's open documents for a known partner without an exact match
  for (const { r: r0, i } of byDate) {
    const r = rows[i]!;
    if (!want(r0) || r.ref || isFxAccount(ctx.accounts, r.acct) || notDocPayment(r0, ctx)) continue;
    const prev = out.get(r.id);
    if (prev && prev.row.konto && !BKPK_RE.test(prev.row.konto)) continue; // a rule / fee / payroll konto wins
    const pid = r.partner || namePid(r0);
    if (!pid) continue;
    const O = openOf(rows, ctx, r, pid);
    if (!O.O.length) continue;
    const pick = fifoPick(r, O.O);
    // the text names another document (e.g. an already paid „CLK-202606-1019“): no FIFO onto different invoices
    const text = String(r.desc ?? '') + ' ' + String(r.purpose ?? '');
    if (pick.some((z) => !amountOnlyOk(text, r, z.x))) continue;
    const l = linkPayment({ ...r, partner: pid }, pick, O.type, ctx.konta);
    if (!l) continue;
    put(i, { id: r.id, how: 'fifo', row: l.row, refs: l.refs, ...(l.excess ? { excess: l.excess } : {}) });
  }
  return out;
}

/* ---------------- confidence ---------------- */

export type ReviewConf = 'sure' | 'likely' | 'manual';
export const REVIEW_CONFS: readonly ReviewConf[] = ['sure', 'likely', 'manual'];
export const REVIEW_CONF_LBL: Record<ReviewConf, string> = { sure: 'сигурно', likely: 'веројатно', manual: 'рачно' };

/** Always „сигурно“ (a learned rule, a payment code, a recognised own transfer / POS / VAT / fee / payroll / exact subset). */
const SURE = new Set(['osnov', 'rule', 'own', 'pos', 'vat', 'payroll', 'fee', 'conv', 'sum', 'tech']);
/** „сигурно“ only when the partner named on the statement is the document's partner. */
const SURE_IF_PARTNER = new Set(['ref', 'num', 'amt', 'invoice', 'purchase']);

export interface ConfInput {
  how: string;
  konto: string;
  /** The konto is not in the chart. */
  missing?: boolean;
  /** A partner would have to be created. */
  newPartner?: string | null;
  partnerOk?: boolean;
  /** Unallocated part of a document payment (cents). */
  excess?: number;
  /** The customer / supplier konto has no partner yet. */
  needsPartner?: boolean;
}

/**
 * Confidence of a proposal. „рачно“: no konto, a konto missing from the chart, or a partner konto without a partner.
 * A new partner, an advance (unallocated excess) or a FIFO / near-amount / text-only proposal is at most „веројатно“.
 */
export function reviewConfidence(x: ConfInput): ReviewConf {
  if (!x.konto || x.missing || !x.how || x.needsPartner) return 'manual';
  if (x.newPartner) return 'likely';
  if (x.excess && x.excess > 0) return 'likely';
  if (SURE.has(x.how)) return 'sure';
  if (SURE_IF_PARTNER.has(x.how)) return x.partnerOk ? 'sure' : 'likely';
  return 'likely';
}

/* ---------------- the owner's „автоматски“ switches ---------------- */

export interface AutoSteps {
  /** After an import: post the „сигурно“ lines of the review. */
  book: boolean;
  /** After an import: accept the „сигурно“ payment ↔ invoice links. */
  link: boolean;
  /** After a change of the schemes / bank kontos / chart: re-post in the background (open periods only). */
  repost: boolean;
}

export const AUTO_STEP_LBL: Record<keyof AutoSteps, string> = {
  book: 'по увоз на извод: прокнижи ги „сигурните“ ставки',
  link: 'по увоз на извод: поврзи ги „сигурните“ плаќања со фактурите',
  repost: 'по промена на шеми / конта / контен план: прекнижи во позадина (само отворени периоди)',
};

/** The firm's switches (`firms.settings.autoSteps`); everything OFF unless explicitly `true`. */
export function autoSteps(settings: unknown): AutoSteps {
  const a = ((settings ?? {}) as { autoSteps?: Partial<Record<keyof AutoSteps, unknown>> }).autoSteps ?? {};
  return { book: a.book === true, link: a.link === true, repost: a.repost === true };
}

/** Why a proposal (Macedonian, shown next to it). */
export function reviewWhy(c: Pick<ReviewChange, 'how' | 'refs' | 'excess' | 'row'>, fmt: (cents: number) => string): string {
  const docs = (c.refs ?? []).map((r) => `${r.label || '—'}${c.refs!.length > 1 || c.excess ? ` (${fmt(r.amt)})` : ''}`).join(', ');
  const inv = +c.row.amount > 0 ? 'фактура' : 'влезна фактура';
  const adv = c.excess ? `; вишок ${fmt(c.excess)} останува аванс` : '';
  switch (c.how) {
    case 'ref': return `повикување на број / цел на дознака → ${inv} ${docs}${adv}`;
    case 'num': return `број на фактура во описот → ${inv} ${docs}${adv}`;
    case 'amt': case 'invoice': case 'purchase': return `ист износ кај комитентот → ${inv} ${docs}`;
    case 'sum': return `збир на отворени фактури на комитентот → ${docs}`;
    case 'fx': case 'fxnear': return `девизна ${inv} ${docs} (курсна разлика)`;
    case 'fifo': {
      const all = (c.refs ?? []).map((r) => `${r.label || '—'} (${fmt(r.amt)})`).join(', ');
      return `FIFO: најстарите отворени ${inv === 'фактура' ? 'фактури' : 'влезни фактури'} на комитентот → ${all}${adv}`;
    }
    default: return '';
  }
}

