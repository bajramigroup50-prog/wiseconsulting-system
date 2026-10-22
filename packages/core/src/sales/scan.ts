/**
 * Post-processing of AI-read (or UBL-imported) invoices into editable drafts — legacy `fixLines`, `fixRates`,
 * `purConsistent`, `fixSaleQty`, `matchItem`, `draftFromScan`, `outFindPartner`, `outDraft`, `batchDup`, `ownerCheck`
 * (index.html 4643–4705, 5354, 8392–8401, 11252, 12876–12896). Pure: the caller passes partners and items.
 */
import { r2 } from '../money';
import { calcLines } from '../vat';
import { normDocNo } from './docs';
import { accountKey } from '../bank/mk-banks';
import { draftMatchOf, findPartnerMatch, type DraftPartnerMatch, type MatchablePartnerRow } from '../partners/match';

export interface ScanLine { code?: string; barcode?: string; name?: string; unit?: string; qty?: number | string; price?: number | string; discount?: number | string; amount?: number | string; rate?: number | string }
export interface ScanGroup { rate?: number | string; base?: number | string; vat?: number | string; kind?: string }
/** One invoice as returned by `PUR_PROMPT` / `SALE_PROMPT` / `ublToScan`. */
export interface ScanInvoice {
  supplierName?: string; supplierEdb?: string; buyerName?: string; buyerEdb?: string; buyerAddress?: string; buyerCity?: string;
  number?: string; date?: string; dueDate?: string; art32?: boolean;
  /** The seller's bank account printed on the invoice („жиро / трансакциска сметка“, IBAN). */
  supplierBankAccount?: string;
  groups?: ScanGroup[]; lines?: ScanLine[]; total?: number | string;
  /** UBL CreditNote (amounts negative). */
  credit?: boolean;
  currency?: string;
  /** Pages of the source file this invoice is printed on („1“, „2-3“) when the file holds several invoices. */
  pages?: string;
  /**
   * VAT legal note printed on the invoice, as read („Пренесување на даночната обврска согласно член 32-а од ЗДДВ“,
   * „Ослободено од ДДВ согласно член 24 од ЗДДВ“…); '' / missing = none (see {@link vatNoteOf}).
   */
  vatNote?: string;
  /**
   * Previous unpaid debt printed on a utility bill („долг од претходно“, „неплатен износ“, „салдо“) — never booked;
   * `total` is this invoice's own amount ({@link prevDebtFix}).
   */
  prevDebt?: number | string;
  /** What the document is by its title (`invoice` when not given): a pro-forma, offer, … is never booked. */
  docType?: string;
}
/** A prompt result: one invoice, or several (`{invoices:[…]}`). */
export type ScanResult = ScanInvoice & { invoices?: ScanInvoice[] };


const n = (v: unknown) => Number(v) || 0;
const isoDate = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) ? s : '');

/** Split a result into its invoices (legacy: `r.invoices` with more than one entry → batch). */
export const scanInvoices = (r: ScanResult | null | undefined): ScanInvoice[] =>
  !r ? [] : Array.isArray(r.invoices) && r.invoices.length ? r.invoices : [r];

/** Legacy `fixLines` (4688): repair qty/price read with the wrong decimal scale using the printed amount. */
export function fixLines(lines: readonly ScanLine[] | undefined): ScanLine[] {
  const near = (x: number, y: number) => y > 0 && Math.abs(x - y) / y <= 0.02;
  return (lines ?? []).map((l0) => {
    const l = { ...l0 };
    let q = n(l.qty), pr = n(l.price);
    const am = n(l.amount), disc = n(l.discount);
    const eff = (x: number) => x * (1 - disc / 100);
    if (am > 0) {
      if (q > 0 && pr > 0 && !near(q * pr, am) && !near(q * eff(pr), am)) {
        const cq = [q / 1000, q / 100, q / 10, q * 1000].find((c) => near(c * pr, am) || near(c * eff(pr), am));
        const cp = [pr / 1000, pr / 100, pr * 100, pr * 1000].find((c) => near(q * c, am));
        if (cq) q = cq;
        else if (cp) pr = cp;
        else {
          const q2 = am / pr;
          if (q2 > 0 && Math.abs(q2 - Math.round(q2 * 1000) / 1000) < 0.001) q = Math.round(q2 * 1000) / 1000;
          else pr = Math.round((am / q) * 10000) / 10000;
        }
      } else if (q > 0 && !pr) pr = Math.round((am / q) * 10000) / 10000;
      else if (!q && pr > 0) q = Math.round((am / pr) * 1000) / 1000;
    }
    l.qty = q;
    l.price = pr;
    return l;
  });
}

const lineAmt = (l: ScanLine) => n(l.amount) || n(l.qty) * n(l.price) * (1 - n(l.discount) / 100);

/** Legacy `fixRates` (4674): move lines between VAT rates until the per-rate sums match the recapitulation. */
export function fixRates<T extends ScanInvoice>(r: T): T {
  const G = (r.groups ?? []).filter((g) => n(g.base));
  if (G.length < 2 || !(r.lines ?? []).length) return r;
  const L = r.lines!;
  for (let k = 0; k < 5; k++) {
    const d = G.map((g) => ({ g, x: L.filter((l) => n(l.rate || 18) === n(g.rate)).reduce((a, l) => a + lineAmt(l), 0) - n(g.base) }));
    const hi = d.find((z) => z.x > Math.max(2, n(z.g.base) * 0.005)), lo = d.find((z) => z.x < -Math.max(2, n(z.g.base) * 0.005));
    if (!hi || !lo) break;
    const need = Math.min(hi.x, -lo.x);
    const c = L.filter((l) => n(l.rate || 18) === n(hi.g.rate));
    let ln = c.find((l) => Math.abs(lineAmt(l) - need) <= Math.max(1, need * 0.01));
    if (!ln) {
      outer: for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
        if (Math.abs(lineAmt(c[i]!) + lineAmt(c[j]!) - need) <= Math.max(1, need * 0.01)) { c[i]!.rate = n(lo.g.rate); ln = c[j]; break outer; }
      }
    }
    if (!ln) break;
    ln.rate = n(lo.g.rate);
  }
  return r;
}

/** Legacy `purConsistent` (4669): lines, recapitulation and total agree (used to decide on a second, deeper read). */
export function scanConsistent(r0: ScanInvoice | null | undefined, strict = false): boolean {
  if (!r0) return false;
  // a utility bill whose total includes the printed previous debt is checked on its own amount ({@link prevDebtFix})
  const r = prevDebtFix(r0).inv;
  const L = fixLines(r.lines);
  const G = (r.groups ?? []).filter((g) => n(g.base));
  const gb = G.reduce((a, g) => a + n(g.base), 0), gv = G.reduce((a, g) => a + n(g.vat), 0);
  if (!G.length && !L.length) return false;
  const tot = Math.abs(n(r.total));
  if (tot && G.length && Math.abs(Math.abs(gb + (r.art32 ? 0 : gv)) - tot) > Math.max(2, tot * 0.005)) return false;
  if (L.length && G.length) {
    const lb = L.reduce((a, l) => a + lineAmt(l), 0);
    if (Math.abs(lb - gb) > Math.max(2, Math.abs(gb) * 0.01)) return false;
    if (strict) for (const g of G) {
      const lr = L.filter((l) => n(l.rate || 18) === n(g.rate)).reduce((a, l) => a + (n(l.amount) || n(l.qty) * n(l.price)), 0);
      if (Math.abs(lr - n(g.base)) > Math.max(2, Math.abs(n(g.base)) * 0.01)) return false;
    }
  }
  for (const g of G) if (!r.art32 && n(g.rate) && Math.abs((n(g.base) * n(g.rate)) / 100 - n(g.vat)) > Math.max(1, Math.abs((n(g.base) * n(g.rate)) / 100) * 0.01)) return false;
  return true;
}
export const scanResultConsistent = (r: ScanResult | null | undefined) => !!r && scanInvoices(r).every((x) => scanConsistent(x));

/** Legacy `fixSaleQty` (8392): quantity taken from the VAT-rate column. */
export function fixSaleQty<T extends ScanInvoice>(r: T): T {
  const L = r.lines ?? [];
  const G = (r.groups ?? []).filter((g) => n(g.base));
  if (!L.length) return r;
  for (const l of L) {
    const q = n(l.qty), p = n(l.price), a = n(l.amount);
    if (a > 0 && p > 0 && q > 0 && Math.abs(q * p - a) > Math.max(0.5, a * 0.01)) {
      const q2 = a / p;
      if (Math.abs(q2 - Math.round(q2)) < 0.01) l.qty = Math.round(q2);
      else if (Math.abs(q2 - Math.round(q2 * 1000) / 1000) < 0.002) l.qty = Math.round(q2 * 1000) / 1000;
    }
  }
  for (const g of G) {
    const LL = L.filter((l) => n(l.rate || 18) === n(g.rate));
    const A = (l: ScanLine) => n(l.qty) * n(l.price);
    const sum = LL.reduce((x, l) => x + A(l), 0);
    if (Math.abs(sum - n(g.base)) <= Math.max(1, n(g.base) * 0.005)) continue;
    const sus = LL.filter((l) => [5, 10, 18].includes(n(l.qty)) && (n(l.qty) === n(l.rate) || n(l.qty) === n(g.rate)));
    if (sus.length === 1) {
      const l = sus[0]!;
      const need = n(g.base) - (sum - A(l));
      const q = need / (n(l.price) || 1);
      if (q > 0 && Math.abs(q - Math.round(q * 1000) / 1000) < 0.01) {
        l.qty = Math.abs(q - Math.round(q)) < 0.02 ? Math.round(q) : Math.round(q * 1000) / 1000;
        l.amount = Math.round(need * 100) / 100;
      }
    }
  }
  return r;
}

/* ------------------------------------------------------------------ VAT notes (чл. 32-а / ослободување) */

/** Printed legal note of a domestic reverse-charge invoice (ЗДДВ чл. 32-а). */
export const ART32_NOTE = 'Пренесување на даночната обврска – ДДВ пресметува примателот согласно член 32-а од ЗДДВ';
/** Legal basis written on a read outgoing invoice without VAT and without a printed note (the firm's rule „0 % = чл. 24“). */
export const NO_VAT_DED_NOTE = 'Ослободено од ДДВ со право на одбивка согласно член 24 од ЗДДВ';
/**
 * The firm's rule for a read outgoing invoice without VAT and without a printed note (`firms.settings.scanNoVat`):
 * `ded` (default) = ЗДДВ чл. 24 with the right to deduct → customer konto 1200009, ДДВ-04 field 08, as the journal
 * import books 1200009; `check` = never guessed, the draft waits for „провери“.
 */
export const scanNoVatRule = (settings: unknown): 'ded' | 'check' =>
  ((settings ?? {}) as { scanNoVat?: unknown }).scanNoVat === 'check' ? 'check' : 'ded';
/** Check message of a read invoice without VAT and without a note (rule `check`): not guessed as exempt or as art. 32-a. */
export const NO_VAT_NOTE_MSG = 'провери: нема ДДВ – чл. 32-а или ослободување?';

/** „член 32-а“, „чл. 32 а“, „32-а ЗДДВ“, „пренесување на даночната обврска“, „ДДВ пресметува примателот“, „reverse charge“. */
const ART32_RE = new RegExp([
  String.raw`чл(?:ен)?\.?\s*32\s*[-–]?\s*[аa](?![\p{L}\d])`,
  String.raw`32\s*[-–]\s*[аa]\s*(?:од\s+)?(?:ЗДДВ|закон)`,
  String.raw`пренесување\s+на\s+(?:даночната|даночна)\s+обврска`,
  String.raw`(?:ДДВ|данокот)\s+(?:го\s+)?пресметува\s+(?:и\s+(?:го\s+)?плаќа\s+)?примателот`,
  String.raw`reverse[\s-]+charge`,
].join('|'), 'iu');
/** Exemption notes (ЗДДВ чл. 23 / 24 / 30): „ослободено од ДДВ“, „без / со право на одбивка“, „член 24 од ЗДДВ“… */
const EXEMPT_RE = new RegExp([
  String.raw`ослободен[оаи]?\s+од\s+(?:плаќање\s+(?:на\s+)?)?(?:ДДВ|данок)`,
  String.raw`(?:без|со)\s+право\s+на\s+одбив(?:ка|ање|ок)`,
  String.raw`чл(?:ен)?\.?\s*(?:23|24|30)(?![\p{L}\d])[^\n]{0,30}(?:ЗДДВ|закон(?:от)?\s+за\s+(?:данокот\s+на\s+)?додадена)`,
  String.raw`ТИРЗ|слободн[аи]\s+(?:економск[аи]\s+)?зон`,
  String.raw`не\s+се\s+пресметува\s+ДДВ|ДДВ\s+не\s+се\s+пресметува|ДДВ\s+не\s+е\s+пресметан`,
  String.raw`VAT\s+exempt`,
].join('|'), 'iu');

/**
 * Kind of an exemption note (ЗДДВ as stored in law_articles; ЗА ПРОВЕРКА by the owner):
 * `noded` = чл. 23 „Даночни ослободувања во земјата без право на одбивка на претходниот данок“ → ДДВ-04 field 09;
 * `ded` = чл. 24 „… со право на одбивка на претходниот данок“ (извоз, ТИРЗ / слободна зона, international
 * agreements…) → field 08; null = unclear (the draft is not „спремна“). An explicit „без / со право на одбивка“ wins.
 */
export function exemptKindOf(text: string): 'ded' | 'noded' | null {
  const no = /без\s+право\s+на\s+одбив/iu.test(text);
  const yes = /(?:^|[^\p{L}])со\s+право\s+на\s+одбив/iu.test(text);
  if (no !== yes) return no ? 'noded' : 'ded';
  if (no && yes) return null;
  const a23 = /чл(?:ен)?\.?\s*23(?![\p{L}\d])/iu.test(text);
  // чл. 24, export, ТИРЗ / free or development zones, international agreements, a special law of public interest
  // („ДДВ не е пресметан согласно член 15 од Законот за утврдување на јавен интерес … Коридор 8 и 10Д“)
  const a24 = /чл(?:ен)?\.?\s*24(?![\p{L}\d])|извоз|ТИРЗ|слободн[аи]\s+(?:економск[аи]\s+)?зон|развојн[аи]\s+зон|индустриск[аи]\s+(?:развојн[аи]\s+)?зон|меѓународн[аи]\s+(?:договор|спогодб)|јавен\s+интерес|стратешки\s+партнер|коридор/iu.test(text);
  return a24 === a23 ? null : a24 ? 'ded' : 'noded';
}

/**
 * The VAT note of an invoice text (the AI's `vatNote`, or the whole text of a PDF): `art32` for a domestic reverse
 * charge (чл. 32-а), `exempt` for an exemption with the printed sentence as its legal basis and its kind
 * (`exempt`, {@link exemptKindOf}; null = unclear); null when there is none. The reverse charge wins when both are printed.
 */
export function vatNoteOf(text: unknown): { kind: 'art32' | 'exempt'; note: string; exempt?: 'ded' | 'noded' | null } | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  if (ART32_RE.test(t)) return { kind: 'art32', note: ART32_NOTE };
  const m = EXEMPT_RE.exec(t);
  if (!m) return null;
  // the line / sentence around the match is the legal basis printed on the invoice
  const before = t.slice(0, m.index);
  // a sentence ends at a period followed by a capital letter („чл. 23“ is no sentence end)
  const SE = /\.\s+(?=[\p{Lu}])/gu;
  const lastSE = [...before.matchAll(SE)].pop();
  const a = Math.max(before.lastIndexOf('\n'), lastSE ? lastSE.index! : -1);
  const rest = t.slice(m.index + m[0].length);
  const nextSE = /\.\s+(?=[\p{Lu}])/u.exec(rest);
  const e0 = [rest.indexOf('\n'), nextSE ? nextSE.index : -1].filter((x) => x >= 0);
  const end = m.index + m[0].length + (e0.length ? Math.min(...e0) : rest.length);
  const note = t.slice(a + 1, end).replace(/\s+/g, ' ').replace(/^[\s*•–-]+/, '').replace(/[\s.;,]+$/, '').trim().slice(0, 300);
  return { kind: 'exempt', note: note || m[0], exempt: exemptKindOf(t) };
}

/* ------------------------------------------------------------------ matching */

export interface MatchItem {
  id: string; name: string; code?: string | null; type?: string | null; unit?: string | null; rate?: number | null;
  barcodes?: readonly string[]; aliases?: readonly string[];
  /** Supplier item codes: partner id → code (legacy `supCodes`; key '' = unknown supplier). */
  supCodes?: Readonly<Record<string, string>>;
}
export type MatchPartner = MatchablePartnerRow;

/** Legacy `matchItem` (4643 → 11252): barcode → supplier code → any supplier code → name/alias → contained name. */
export function matchItem(items: readonly MatchItem[], name?: string, code?: string, barcode?: string, partnerId?: string | null): MatchItem | null {
  const nm = String(name ?? '').toLowerCase().trim();
  const bc = String(barcode ?? '').replace(/\D/g, '');
  const cd = String(code ?? '').trim();
  if (bc.length >= 8) { const x = items.find((i) => (i.barcodes ?? []).includes(bc)); if (x) return x; }
  if (cd && partnerId) { const x = items.find((i) => i.supCodes?.[partnerId] === cd); if (x) return x; }
  if (cd) { const x = items.find((i) => Object.values(i.supCodes ?? {}).includes(cd)); if (x) return x; }
  if (!nm) return null;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const ex = items.find((i) => norm(i.name) === nm || (i.aliases ?? []).some((a) => norm(a) === nm));
  if (ex) return ex;
  if (nm.length < 5) return null;
  return items.find((i) => i.name.length >= 5 && (nm.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(nm))) ?? null;
}

const edbDigits = (e: unknown) => String(e ?? '').replace(/\D/g, '');
/**
 * Partner of a read document: ЕДБ / ЕМБС / bank account, learned name, same or clearly similar name
 * (`@wise/core/partners/match`). FIX: legacy compared the last 7 digits of the ЕДБ, so a 7-digit ЕМБС never matched.
 */
export function matchPartner(partners: readonly MatchPartner[], name?: string, edb?: string, bankAccount?: string): MatchPartner | null {
  return findPartnerMatch(partners, { name, id: edb, bankAccount }).partner;
}

/* ------------------------------------------------------------------ owner check */

/**
 * "The document belongs to another firm" guard (legacy `ownerCheck`, 12880).
 * FIX (LEGACY-MAP 3.4 item 9): legacy ran it whenever the prompt text contained "buyerEdb", so every scanned *sales*
 * invoice was checked as if our firm were the buyer, and multi-invoice results skipped it. Now it is explicit per
 * document kind and runs on every invoice of a result: a purchase must name our firm as the buyer (when a buyer ЕДБ
 * was read); a sales invoice must not.
 */
export function ownerCheck(kind: 'purchase' | 'sale', r: ScanInvoice, ownEdb: string | null | undefined): string | null {
  const own = edbDigits(ownEdb), buyer = edbDigits(r.buyerEdb);
  if (own.length < 7 || buyer.length < 7) return null;
  const same = buyer.slice(-7) === own.slice(-7);
  if (kind === 'purchase' && !same) return `Купувачот на документот (ЕДБ ${buyer}) не е оваа фирма – можеби документот е за друга фирма.`;
  if (kind === 'sale' && same) return 'Купувачот на документот е оваа фирма – ова е влезна, не излезна фактура.';
  return null;
}

/**
 * A document uploaded as a purchase that this firm itself issued (the seller's ЕДБ is ours on every invoice): the
 * firm's own sales invoices sent to „Влезни“ by mistake – read as sales, never as purchases from itself.
 */
export function issuedByOwnFirm(r: ScanResult | null | undefined, ownEdb: string | null | undefined): boolean {
  const own = edbDigits(ownEdb);
  const L = scanInvoices(r);
  return own.length >= 7 && L.length > 0 && L.every((x) => { const s = edbDigits(x.supplierEdb); return s.length >= 7 && s.slice(-7) === own.slice(-7); });
}

/** The other way round: a document uploaded as a sale whose buyer is this firm on every invoice – a purchase. */
export function boughtByOwnFirm(r: ScanResult | null | undefined, ownEdb: string | null | undefined): boolean {
  const own = edbDigits(ownEdb);
  const L = scanInvoices(r);
  return own.length >= 7 && L.length > 0 && L.every((x) => { const b = edbDigits(x.buyerEdb), s = edbDigits(x.supplierEdb); return b.length >= 7 && b.slice(-7) === own.slice(-7) && s.length >= 7 && s.slice(-7) !== own.slice(-7); });
}

/* ------------------------------------------------------------------ duplicates */

export interface DupCandidate { id?: string; partnerId?: string | null; partnerEdb?: string | null; number?: string | null; total: number; date?: string | null }

/**
 * One duplicate rule for invoices and purchases: same partner (id or ЕДБ) + same normalized number + same amount (±1).
 * FIX (LEGACY-MAP 3.4 item 10): legacy had three different rules (`purDups` number+date and auto-delete of the
 * "older" one, `batchDup` number && (partner || total), `savePur` number && (partner || total || date)).
 * The sha256 of an attached file is checked separately (`files.sha256`).
 * Also a duplicate (the rule of the bank import, one document = one registration): the same supplier (id or ЕДБ) +
 * number + document DATE (`date` of both given), whatever the amount — an invoice read again with a different total
 * is still the same invoice.
 */
export function findDuplicate<T extends DupCandidate>(c: DupCandidate, existing: readonly T[]): T | null {
  const nn = normDocNo(c.number);
  if (!nn) return null;
  const ce = edbDigits(c.partnerEdb);
  return existing.find((x) => {
    if (x.id && c.id && x.id === c.id) return false;
    if (normDocNo(x.number) !== nn) return false;
    const sameTotal = Math.abs(x.total - c.total) <= 1;
    const sameDate = !!c.date && !!x.date && c.date === x.date;
    if (!sameTotal && !sameDate) return false;
    if (c.partnerId && x.partnerId) return c.partnerId === x.partnerId;
    const xe = edbDigits(x.partnerEdb);
    if (ce.length >= 7 && xe.length >= 7) return ce.slice(-7) === xe.slice(-7);
    // no supplier to compare: only number + amount
    return sameTotal;
  }) ?? null;
}

/* ------------------------------------------------------------------ drafts */

export interface ScanPurchaseLine {
  itemId: string; name: string; code: string; barcode: string; qty: number; price: number; amount: number;
  unit?: string; rate?: number; isNew?: boolean; type?: 'goods' | 'material'; sp?: number | '';
}
export interface ScanPurchaseDraft {
  number: string; date: string; docDate: string; due: string; partnerId: string; supplierName: string; supplierEdb: string;
  art32: boolean; ptype: 'stock' | 'cost'; cash: boolean; warehouseId: string | null;
  groups: { konto: string; rate: number; base: number; vat: number }[];
  stock: ScanPurchaseLine[];
  /** VAT period of the document date was closed → booked on `date` (legacy `autoShift`). */
  shifted: boolean;
  credit: boolean;
  /** The supplier's bank account read from the invoice (valid MK account / IBAN, else ''). */
  bankAcc?: string;
  /** Pages of the source file with this invoice („2-3“) when the file holds several invoices. */
  pages?: string;
  /** How the supplier was recognised (candidates when uncertain). */
  match?: DraftPartnerMatch;
  /** Previous debt printed on the bill and left out of the total (not booked). */
  prevDebt?: number;
}
/** The expense kontos of a supplier's most recent saved purchase: per VAT rate, and its main konto (largest base). */
export interface SupplierKontoMemory { byRate: Record<string, string>; main: string }

/** {@link SupplierKontoMemory} from the VAT groups of one saved purchase. */
export function supplierKontoMemory(groups: readonly { account: string; rate: number | string; base: number | string }[]): SupplierKontoMemory | null {
  const G = groups.filter((g) => g.account);
  if (!G.length) return null;
  const byRate: Record<string, string> = {};
  const big: Record<string, number> = {};
  for (const g of G) {
    const k = String(n(g.rate));
    if (!(k in big) || Math.abs(n(g.base)) > big[k]!) { big[k] = Math.abs(n(g.base)); byRate[k] = g.account; }
  }
  const main = [...G].sort((a, b) => Math.abs(n(b.base)) - Math.abs(n(a.base)))[0]!.account;
  return { byRate, main };
}

/** Electricity cost konto from the chart: 4030 when named „Електрична енергија“, else 4020 when so named, else ''. */
export function energyKontoFromChart(chart: readonly { code: string; name: string }[]): string {
  const el = (c: string) => chart.some((a) => a.code === c && /електрична\s+енергија/i.test(a.name));
  return el('4030') ? '4030' : el('4020') ? '4020' : '';
}

/**
 * A utility bill (EVN, Телеком, water…) prints the previous unpaid debt and „вкупно за плаќање“ = debt + this month's
 * charge. Only this invoice's own amount may be booked: when the total read differs from Σ groups (+ VAT) by exactly the
 * printed previous debt (`prevDebt`), the total becomes Σ groups and `debt` is returned for the draft's note.
 */
export function prevDebtFix(r: ScanInvoice): { inv: ScanInvoice; debt: number } {
  const debt = Math.abs(n(r.prevDebt));
  const G = (r.groups ?? []).filter((g) => n(g.base) || n(g.vat));
  if (!debt || !G.length) return { inv: r, debt: 0 };
  const sum = r2(G.reduce((a, g) => a + n(g.base) + (r.art32 ? 0 : n(g.vat)), 0));
  const tot = n(r.total);
  const tol = Math.max(1, Math.abs(sum) * 0.002);
  if (Math.abs(tot - sum - debt) <= tol) return { inv: { ...r, total: sum }, debt };
  return { inv: r, debt: 0 };
}

export interface PurchaseDraftOptions {
  partners: readonly MatchPartner[];
  items: readonly MatchItem[];
  /**
   * Kontos per AI group kind: goods → stock, material → material, energy (electricity) → `energy` (scheme key
   * `costEnergy`, else 4030 / 4020 „Електрична енергија“ from the chart, else the purchase default), else `other`.
   */
  accounts: { goods: string; material: string; other: string; energy?: string };
  /**
   * The matched supplier's kontos from its most recent saved purchase: proposed per VAT rate (same rate first, else its
   * main konto) for every group that is not goods / material. The stock / material / default kontos are never taken
   * from it (the default is no choice — the kind rule decides then).
   */
  supplierKontos?: (partnerId: string) => SupplierKontoMemory | null | undefined;
  today: string;
  /** Batch options (legacy `scanCash`, `scanWh`, `scanCost`). */
  cash?: boolean; warehouseId?: string | null; costOnly?: boolean;
  defMargin?: number; mgRound?: number;
  /** VAT period of a date already closed (legacy `ddvClosed`). */
  vatClosed?: (date: string) => boolean;
}

/**
 * Purchase draft from a scan (legacy `draftFromScan`, 4695).
 * FIX (LEGACY-MAP 3.4 item 3): the kind → konto map no longer hard-codes 4100 (rail transport) for services, 4010
 * (office material) for energy, 4400 (per diems) for "other" and 0130 for assets: goods → stock konto, material →
 * material konto, everything else → the purchase default konto of the scheme (to be refined by the user).
 * FIX (item 17): legacy built the object with `docDate` twice.
 */
export function purchaseDraftFromScan(r0: ScanInvoice, o: PurchaseDraftOptions): ScanPurchaseDraft {
  // a received invoice with the reverse-charge note (чл. 32-а) is art. 32-a even when the read missed the flag
  const art32 = !!r0.art32 || vatNoteOf(r0.vatNote)?.kind === 'art32';
  let r: ScanInvoice = fixSaleQty({ ...r0, art32, lines: (r0.lines ?? []).map((l) => ({ ...l })) });
  r = { ...r, lines: fixLines(r.lines) };
  const pm = findPartnerMatch(o.partners, { name: r.supplierName, id: r.supplierEdb, bankAccount: r.supplierBankAccount });
  const p = pm.partner;
  const goodsInv = (r.groups ?? []).some((g) => g.kind === 'goods' || g.kind === 'material') || !!o.warehouseId;
  const onlyMat = (r.groups ?? []).some((g) => g.kind === 'material') && !(r.groups ?? []).some((g) => g.kind === 'goods');
  const mg = o.defMargin || 25, rd = o.mgRound || 1;
  const st: ScanPurchaseLine[] = [];
  for (const l of r.lines ?? []) {
    const it = matchItem(o.items, l.name, l.code, l.barcode, p?.id);
    if (it && it.type === 'service') continue;
    if (it) { st.push({ itemId: it.id, name: String(l.name ?? ''), code: String(l.code ?? ''), barcode: String(l.barcode ?? ''), qty: n(l.qty), price: n(l.price), amount: n(l.amount) }); continue; }
    if (!(goodsInv && n(l.qty))) continue;
    const rt = n(l.rate) || 18;
    st.push({
      itemId: '', name: String(l.name ?? ''), code: String(l.code ?? ''), barcode: String(l.barcode ?? ''), amount: n(l.amount), unit: l.unit || 'ком',
      rate: rt, qty: n(l.qty), price: n(l.price), isNew: true, type: onlyMat ? 'material' : 'goods',
      sp: n(l.price) ? r2(Math.round((n(l.price) * (1 + mg / 100) * (1 + rt / 100)) / rd) * rd) : '',
    });
  }
  const mem = p?.id ? o.supplierKontos?.(p.id) ?? null : null;
  const generic = new Set([o.accounts.goods, o.accounts.material, o.accounts.other].filter(Boolean));
  const kmap = (k: string | undefined, rate: number) => {
    if (k === 'goods') return o.accounts.goods;
    if (k === 'material') return o.accounts.material;
    const m = mem ? mem.byRate[String(rate)] || mem.main : '';
    if (m && !generic.has(m)) return m;
    if (k === 'energy' && o.accounts.energy && o.accounts.energy !== '-') return o.accounts.energy;
    return o.accounts.other;
  };
  let G = (r.groups ?? []).filter((g) => n(g.base) || n(g.vat));
  if (!G.length && (r.lines ?? []).length) {
    const by = new Map<number, number>();
    for (const l of r.lines!) { const rt = n(l.rate) || 18; by.set(rt, (by.get(rt) ?? 0) + n(l.qty) * n(l.price)); }
    G = [...by].filter(([, b]) => b).map(([rt, b]) => ({ rate: rt, base: r2(b), vat: r.art32 ? 0 : r2((b * rt) / 100), kind: 'goods' }));
  }
  if (!G.length && n(r.total)) G = [{ rate: 18, base: r2(n(r.total) / 1.18), vat: r.art32 ? 0 : r2(n(r.total) - n(r.total) / 1.18), kind: 'other' }];
  const groups = (G.length ? G : [{ rate: 18, base: 0, vat: 0 }]).map((g) => ({
    // art. 32-a: the recipient's VAT is at the rate of the supply (18 when the read gave 0)
    rate: r.art32 ? n(g.rate) || 18 : n(g.rate), base: n(g.base), vat: r.art32 ? 0 : n(g.vat) || r2((n(g.base) * n(g.rate)) / 100), konto: kmap(g.kind, r.art32 ? n(g.rate) || 18 : n(g.rate)),
  }));
  const dd = isoDate(r.date);
  const shifted = !!dd && !!o.vatClosed?.(dd);
  const stock = o.costOnly ? [] : st;
  return {
    number: String(r.number ?? '').trim(), docDate: dd, due: isoDate(r.dueDate), date: !dd || shifted ? o.today : dd, shifted,
    partnerId: p?.id ?? '', supplierName: String(r.supplierName ?? ''), supplierEdb: String(r.supplierEdb ?? ''),
    art32: !!r.art32, cash: !!o.cash, warehouseId: o.warehouseId ?? null,
    ptype: o.costOnly ? 'cost' : stock.length || goodsInv ? 'stock' : 'cost',
    groups, stock, credit: !!r.credit, bankAcc: accountKey(r.supplierBankAccount),
    ...(r.pages ? { pages: String(r.pages) } : {}), match: draftMatchOf(pm),
  };
}

export interface ScanSaleDraft {
  number: string; date: string; due: string; partnerId: string; art32: boolean;
  buyer: { name: string; edb: string; address: string; city: string };
  items: { itemId: string; name: string; unit: string; qty: number; price: number; disc: number; rate: number; konto: string }[];
  total: number;
  /** Pages of the source file with this invoice („2-3“) when the file holds several invoices. */
  pages?: string;
  /** Legal basis of an exempt invoice (rate 0) as printed („Ослободено од ДДВ согласно член 24…“) → `data.vatNote`. */
  vatNote?: string;
  /** Kind of the exemption (`data.vatExempt`): 'ded' (чл. 24) → ДДВ-04 field 08, 'noded' (чл. 23) → field 09. */
  vatExempt?: 'ded' | 'noded';
  /** No VAT and no (clear) note: art. 32-a or the kind of exemption is not guessed — the draft is not „спремна“. */
  vatCheck?: boolean;
  /** How the buyer was recognised (candidates when uncertain; `created` = added automatically). */
  match?: DraftPartnerMatch;
}

/**
 * Sales-invoice draft from a scan (legacy `outDraft`, 8396).
 * FIX (LEGACY-MAP 3.4 item 16): art. 32-a lines get rate 18 (legacy 0 here, 18 in the editor — masked by `calcLines`);
 * the revenue konto comes from the scheme (`revDefault`) instead of the literal '7400'.
 */
export function saleDraftFromScan(r0: ScanInvoice, o: { partners: readonly MatchPartner[]; items: readonly MatchItem[]; revKonto: string; today: string; nextNumber: string; noVat?: 'ded' | 'check' }): ScanSaleDraft {
  // ЗДДВ notes: „член 32-а“ / „пренесување на даночната обврска“ → art. 32-a (rate 18, no VAT charged);
  // „ослободено од ДДВ“ (чл. 23 / 24) → rate 0 with the printed legal basis and its kind
  const vn = vatNoteOf(r0.vatNote);
  const art32 = !!r0.art32 || vn?.kind === 'art32';
  const exempt = !art32 && vn?.kind === 'exempt';
  let r: ScanInvoice = fixSaleQty({ ...r0, art32, lines: (r0.lines ?? []).map((l) => ({ ...l })) });
  r = { ...r, lines: fixLines(r.lines) };
  const pm = findPartnerMatch(o.partners, { name: r.buyerName, id: r.buyerEdb });
  const p = pm.partner;
  // the document shows no VAT at all: a recapitulation with bases and no VAT, or every line read at 0 %
  const G0 = (r.groups ?? []).filter((g) => n(g.base));
  const L0 = (r.lines ?? []).filter((l) => l.name || n(l.amount));
  const zeroRate = (v: unknown) => v != null && v !== '' && !n(v);
  const noVat = !art32 && ((G0.length > 0 && G0.every((g) => !n(g.vat))) || (!G0.length && L0.length > 0 && L0.every((l) => zeroRate(l.rate))));
  let items = (r.lines ?? []).filter((l) => l.name || n(l.amount)).map((l) => {
    const it = matchItem(o.items, l.name, l.code, l.barcode, null);
    let q = n(l.qty) || 1;
    if (Math.abs(q - Math.round(q)) < 0.01) q = Math.round(q);
    const am = n(l.amount), pp = n(l.price);
    const pr = pp && (!am || Math.abs(r2(q * pp) - am) <= 0.011) ? pp : am && q ? Math.round((am / q) * 100) / 100 : pp;
    return { itemId: it?.id ?? '', name: it ? it.name : String(l.name ?? ''), unit: l.unit || it?.unit || 'ком', qty: q, price: pr, disc: 0, rate: r.art32 ? 18 : exempt || noVat ? 0 : n(l.rate) || (l.rate === 0 ? 0 : 18), konto: o.revKonto };
  });
  if (!items.length) items = (r.groups ?? []).filter((g) => n(g.base)).map((g) => ({ itemId: '', name: 'Според фактура ' + (r.number ?? ''), unit: '', qty: 1, price: n(g.base), disc: 0, rate: r.art32 ? 18 : exempt || noVat ? 0 : n(g.rate), konto: o.revKonto }));
  const total = n(r.total);
  // prices read with VAT (the total is the base of the lines) — never on a document that shows no VAT
  if (total && items.length && !noVat && !exempt) {
    const c = calcLines(items, r.art32);
    if (Math.abs(c.total - total) > Math.max(2, total * 0.005) && Math.abs(c.base - total) <= Math.max(2, total * 0.005)) {
      for (const l of items) l.price = Math.round((l.price / (1 + l.rate / 100)) * 10000) / 10000;
    }
  }
  const dd = isoDate(r.date) || o.today;
  return {
    number: String(r.number ?? '').trim() || o.nextNumber, date: dd, due: isoDate(r.dueDate), partnerId: p?.id ?? '', art32: !!r.art32,
    buyer: { name: String(r.buyerName ?? ''), edb: String(r.buyerEdb ?? '').replace(/[^\dA-Za-z]/g, ''), address: String(r.buyerAddress ?? ''), city: String(r.buyerCity ?? '') },
    items, total, ...(r.pages ? { pages: String(r.pages) } : {}), match: draftMatchOf(pm),
    ...(exempt ? { vatNote: vn!.note, ...(vn!.exempt ? { vatExempt: vn!.exempt } : {}) } : {}),
    // no VAT and no note: the firm's rule — чл. 24 with the right to deduct (default), or „провери“ (`check`)
    ...(noVat && !exempt && items.length && (o.noVat ?? 'check') === 'ded' ? { vatNote: NO_VAT_DED_NOTE, vatExempt: 'ded' as const } : {}),
    // an exemption note whose kind (с / без право на одбивка) is unclear, or no VAT and no note under `check`: not guessed
    ...((noVat && !exempt && items.length && (o.noVat ?? 'check') !== 'ded') || (exempt && !vn!.exempt) ? { vatCheck: true } : {}),
  };
}

/** Batch status of a read purchase (legacy `batchCheck`, 5355): `ok` | `check` | `dup` with the reason. */
export function batchStatus(d: ScanPurchaseDraft, raw: ScanInvoice | null, dup: { date?: string | null } | null, owner: string | null): { status: 'ok' | 'check' | 'dup'; msg: string } {
  if (dup) return { status: 'dup', msg: 'веќе е заведена' + (dup.date ? ' (' + dup.date.split('-').reverse().join('.') + ')' : '') };
  const why: string[] = [];
  if (!d.partnerId && !d.supplierName) why.push('нема добавувач');
  if (!d.partnerId && d.match?.candidates.length) why.push('изберете го добавувачот (слични комитенти)');
  if (!d.number) why.push('нема број');
  if (!d.groups.some((g) => g.base)) why.push('нема износ');
  if (raw && !scanConsistent(raw)) why.push('износите не се совпаѓаат со рекапитулацијата');
  if (owner) why.push(owner);
  if (d.credit) why.push('одобрение (CreditNote) – проверете');
  return why.length ? { status: 'check', msg: why.join(', ') } : { status: 'ok', msg: '' };
}

/** Purchase total from groups (legacy `purTotal`). */
export const purchaseTotal = (p: { art32?: boolean; groups: readonly { base: number | string; vat: number | string }[] }) =>
  r2(p.groups.reduce((s, g) => s + n(g.base) + (p.art32 ? 0 : n(g.vat)), 0));

/** „3“ / „3-4“ / „1,4“ / „1-2, 5“ → [3] / [3, 4] / [1, 4] / [1, 2, 5] (1-based, sorted); [] when not readable. */
export function scanPageList(p: string | null | undefined): number[] {
  const out = new Set<number>();
  for (const part of String(p ?? '').split(/[,;]/)) {
    const m = /^\s*(\d{1,3})\s*(?:[-–]\s*(\d{1,3}))?\s*$/.exec(part);
    if (!m) continue;
    const a = +m[1]!, b = m[2] ? +m[2] : a;
    for (let k = a; k <= b && k - a < 200; k++) out.add(k);
  }
  return [...out].sort((x, y) => x - y);
}

/** [3, 4] → „3-4“, [1, 2, 5] → „1-2,5“ (read back by `scanPageList` / `pageList`). */
export function scanPagesText(P: readonly number[]): string {
  const S = [...new Set(P)].sort((x, y) => x - y);
  const out: string[] = [];
  for (let i = 0; i < S.length;) {
    let j = i;
    while (j + 1 < S.length && S[j + 1] === S[j]! + 1) j++;
    out.push(i === j ? String(S[i]) : `${S[i]}-${S[j]}`);
    i = j + 1;
  }
  return out.join(',');
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const partyOf = (x: ScanInvoice) => ({ id: digits(x.supplierEdb) || digits(x.buyerEdb), name: String(x.supplierName || x.buyerName || '').trim().toLowerCase() });
/** Both sides name a party and they differ (ЕДБ first, else the name). */
const otherParty = (a: ScanInvoice, b: ScanInvoice) => {
  const p = partyOf(a), q = partyOf(b);
  if (p.id && q.id) return p.id !== q.id;
  if (p.name && q.name) return p.name !== q.name;
  return false;
};
const hasAmounts = (x: ScanInvoice) => n(x.total) !== 0 || (x.groups ?? []).some((g) => n(g.base) || n(g.vat));
const MERGE_FIELDS = ['vatNote', 'supplierName', 'supplierEdb', 'buyerName', 'buyerEdb', 'buyerAddress', 'buyerCity', 'number', 'date', 'dueDate', 'supplierBankAccount', 'currency'] as const;

/**
 * Attached pages are never an invoice of their own (the user's rule: an EVN bill's second page — „спецификација на
 * потрошувачка“ — or a „прилог“, „страна 2 од 2“, a delivery note is part of the invoice before it). Deterministic
 * post-processing of a multi-invoice read (AI `invoices[]` or the free text reader), in page order:
 *
 *   1. the SAME invoice again — same number (normalized) and no other supplier — on the pages right after (or
 *      overlapping) the previous one: merged into it (its pages appended, missing fields taken from it);
 *   2. an „invoice“ with no total and no VAT, with no number or the previous one's number and no other supplier, on the
 *      pages right after the previous one (or when the read gave no pages): its pages appended to the previous one.
 *
 * Not merged: a repeated number on pages further away (a copy printed later: flagged as a duplicate by the drafts) and a
 * page with another invoice number (an invoice whose amounts were not read: a draft „нема износ“, never lost).
 * A read with one invoice is returned unchanged.
 */
export function mergeAttachedInvoices(r: ScanResult): ScanResult {
  if (!Array.isArray(r.invoices) || r.invoices.length < 2) return r;
  const out: ScanInvoice[] = [];
  for (const x of r.invoices) {
    const prev = out[out.length - 1];
    if (!prev) { out.push(x); continue; }
    const P = scanPageList(prev.pages), X = scanPageList(x.pages);
    const known = P.length > 0 && X.length > 0;
    const next = known && X[0]! <= P[P.length - 1]! + 1 && X[0]! >= P[0]!;
    const no = normDocNo(x.number), pno = normDocNo(prev.number);
    const same = !!no && no === pno && !otherParty(prev, x);
    const attached = !hasAmounts(x) && (!no || no === pno) && !otherParty(prev, x) && (next || !known);
    if (!(same && next) && !attached) { out.push(x); continue; }
    const m: ScanInvoice = { ...prev };
    for (const k of MERGE_FIELDS) if (!m[k] && x[k]) (m as Record<string, unknown>)[k] = x[k];
    if (!hasAmounts(prev) && hasAmounts(x)) { m.groups = x.groups; m.total = x.total; }
    // lines of an attached specification (consumption, no VAT) never join the invoice's own lines
    if (!(prev.lines ?? []).length && (x.lines ?? []).length && (hasAmounts(x) || !hasAmounts(prev))) m.lines = x.lines;
    if (P.length || X.length) m.pages = scanPagesText([...P, ...X]);
    out[out.length - 1] = m;
  }
  if (out.length === r.invoices.length) return r;
  return out.length === 1 ? { ...out[0]! } : { ...r, invoices: out };
}

/** Document types of a read (`docType`): only `invoice` is booked. */
export const SCAN_DOC_TYPES = ['invoice', 'proforma', 'offer', 'delivery_note', 'statement', 'other'] as const;
export type ScanDocType = (typeof SCAN_DOC_TYPES)[number];

/**
 * The document type from its title (the first lines of a text read): „Профактура“ / „Про-фактура“ / „Предрачун“ /
 * „Proforma“ / „Pro forma“ → proforma, „Понуда“ / „Offer“ → offer; '' = not decided (an invoice as before).
 */
export function docTypeFromText(head: string): ScanDocType | '' {
  // only a title: a line that STARTS with the word (an invoice „по профактура бр. 5“ / „по понуда“ stays an invoice)
  for (const t0 of head.split(/\n| \/ /)) {
    const t = t0.trim();
    if (/^(про\s*-?\s*фактура|предрачун|pro\s*-?\s*forma)/i.test(t)) return 'proforma';
    if (/^(понуда|offer|ponuda)(?![\p{L}])/iu.test(t)) return 'offer';
  }
  return '';
}

/** „профактура – не се книжи“: why a read document is not booked ('' = an invoice). */
export function notInvoiceMsg(x: Pick<ScanInvoice, 'docType'> & Partial<Pick<ScanInvoice, 'groups' | 'total'>>): string {
  const t = String(x.docType ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!t || t === 'invoice') return '';
  // „Фактура-испратница“ / a delivery note with a VAT recapitulation and an amount is an invoice (the AI reads the
  // title „ИСПРАТНИЦА“): never put aside
  if (t === 'delivery_note' && Number(x.total) > 0 && (x.groups ?? []).some((g) => Number(g.vat) > 0)) return '';
  if (t === 'proforma' || t === 'pro_forma') return 'профактура – не се книжи';
  if (t === 'offer') return 'понуда – не се книжи';
  if (t === 'delivery_note') return 'испратница – не се книжи';
  if (t === 'statement') return 'извод / изјава – не се книжи';
  return 'не е фактура – не се книжи';
}

/**
 * Content signature of an invoice for „the same lines and amounts“ (a pro-forma and its invoice, two photos of one
 * document): supplier + total + the lines; '' when it has fewer than 3 lines (a monthly bill of the same amount is not
 * the same document).
 */
export function scanContentSig(x: ScanInvoice): string {
  const L = (x.lines ?? []).filter((l) => n(l.amount) || n(l.qty));
  if (L.length < 3) return '';
  const sup = String(x.supplierEdb ?? '').replace(/\D/g, '') || String(x.supplierName ?? '').trim().toLowerCase();
  const tot = r2(n(x.total) || (x.groups ?? []).reduce((a, g) => a + n(g.base) + n(g.vat), 0));
  const ls = L.map((l) => [String(l.name ?? '').trim().toLowerCase().replace(/\s+/g, ' '), r2(n(l.qty)), r2(n(l.amount))].join('~')).sort();
  return [sup, tot, ...ls].join('|');
}
