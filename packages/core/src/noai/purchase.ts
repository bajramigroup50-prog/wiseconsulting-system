/**
 * Purchase / sales invoice from the text layer of a PDF, without AI (e-invoices and PDFs printed by accounting
 * programs have a text layer). Reads the header data (number, date, due date, ЕДБ of supplier and buyer) and the VAT
 * recapitulation („ДДВ 18% … основица … ДДВ“) or, when there is none, the total with its rate. The result has the
 * shape of the AI read (`PUR_PROMPT` / `ublToScan`), so the same drafts are built; the user checks them as always.
 * Lines are not read (too many layouts) — the draft is booked by VAT group, like a cost invoice.
 */
import { docTypeFromText, mergeAttachedInvoices, scanInvoices, type ScanInvoice } from '../sales/scan';
import { AmbiguousAmountsError, ambExamples, reconcileFmt, type NumFmt } from '../numfmt';
import { parseAccount, supplierAccountIn } from '../bank/mk-banks';
import { dateIn, docFmt, lineText, numsIn, numTokens, type PdfLine } from './pdf-lines';
import { normDocNo } from '../sales/docs';

const RATES = [18, 10, 5, 0];
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.002);

function after(text: readonly string[], re: RegExp): string {
  for (const t of text) { const m = re.exec(t); if (m) return t.slice(m.index + m[0].length); }
  return '';
}

/** ЕДБ numbers in the text in reading order (MK4030… or 13 digits starting with 4 / 5). */
export function edbsIn(all: string): string[] {
  const out: string[] = [];
  for (const m of all.matchAll(/(?:MK|МК)?\s?([45]\d{12})(?!\d)/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** A value that looks like an invoice number: one digit, or a letter / digit … digit, no spaces (whole token). */
const NO = String.raw`(\d|[A-ZЀ-Я0-9][A-ZЀ-Я0-9/.\-]{0,24}\d)(?![A-ZЀ-Я0-9/\-]|\.\d)`;

/**
 * Values printed on an invoice that are never its number: a bank account (15 digits with valid mod-97 control
 * digits, any spelling), an IBAN, an ЕДБ / ЕМБГ (13 digits, with or without MK), the ЕМБС printed on the document,
 * a date.
 */
export function notInvoiceNo(v: string, all = ''): boolean {
  const s = v.replace(/[\s.]/g, '').toUpperCase();
  if (parseAccount(v)) return true;
  if (/^[A-ZА-Я]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return true;
  if (/^(?:MK|МК)?\d{13}$/.test(s)) return true;
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(v)) return true;
  for (const m of all.matchAll(/ЕМБС\s*[:.]?\s*(\d{6,8})(?!\d)/gi)) if (s === m[1]) return true;
  // 15 digits printed as an account („Жиро сметка: …“) even when its control digits do not check out
  if (/^\d{15}$/.test(s)) for (const m of all.matchAll(/(?:сметка|сметки|жиро|iban|account)[^\n\d]{0,25}([\d][\d\s-]{13,20}\d)/giu)) if (m[1]!.replace(/\D/g, '') === s) return true;
  return false;
}

/**
 * The invoice number. FIX (an invoice printed by WISE read as its number the firm's „Жиро сметка: 300000000777001“,
 * matched by the old „сметка … <value>“ pattern before the „Број 0042/2026“ cell): candidates by confidence, each
 * checked with `notInvoiceNo` —
 *  1. labelled „Фактура бр.“ / „Фактура број“ / „Број на фактура“ / „Invoice no.“ (the value may be on the next line);
 *  2. a „Број“ / „Бр.“ label opening a line or a cell (the WISE print: „ФАКТУРА“, then „Број | 0042/2026“);
 *  3. a number after the word „фактура“ / „invoice“ on the same line;
 *  4. „Повикување на број“ (WISE prints the invoice number there).
 * „сметка“ alone is not a label any more (жиро / трансакциска сметка); „сметка-фактура бр.“ / „сметка бр.“ still are.
 */
export function invoiceNoIn(text: readonly string[]): string {
  const all = text.join('\n');
  const tries: RegExp[] = [
    new RegExp(String.raw`(?:фактура|ф-ра|invoice|faktura|сметка)\s*(?:бр(?:ој)?\.?|број|no\.?|nr\.?|№|#)\s*[:.]?\s*${NO}`, 'giu'),
    new RegExp(String.raw`(?:број\s+на\s+(?:фактура|сметка-фактура|документ)|invoice\s+(?:number|no\.?))\s*[:.]?\s*${NO}`, 'giu'),
    new RegExp(String.raw`(?:^|\n|  )(?:бр(?:ој)?\.?|број|no\.?|nr\.?|№)[ \t]*[:.]?[ \t]*${NO}`, 'giu'),
    new RegExp(String.raw`(?:фактура|invoice|faktura)[^\n\d]{0,25}?[ \t:.]${NO}`, 'giu'),
    new RegExp(String.raw`повикување\s+на\s+број\s*[:.]?\s*${NO}`, 'giu'),
  ];
  for (const re of tries) for (const m of all.matchAll(re)) if (!notInvoiceNo(m[1]!, all)) return m[1]!;
  return '';
}

/**
 * FIX (number format, `numfmt.ts`): the invoice is read with both readings of ambiguous amounts („1.000“); when they
 * differ, the document's own evidence decides („1.180,00“ elsewhere), else the reading whose VAT recapitulation
 * reconciles with the total (base × rate = VAT, Σ = total); none / both → AmbiguousAmountsError (never guessed).
 */
export function invoiceFromPdf(L: readonly PdfLine[], o: { ownEdb?: string | null; kind?: 'purchase' | 'sale' } = {}): ScanInvoice | null {
  const inv = invoiceFromPdf0(L, o);
  // a pro-forma / offer by its title (the first lines): read, but never booked (`docType`)
  const t = inv ? docTypeFromText(L.slice(0, 15).map(lineText).join(' / ')) : '';
  return inv && t ? { ...inv, docType: t } : inv;
}

function invoiceFromPdf0(L: readonly PdfLine[], o: { ownEdb?: string | null; kind?: 'purchase' | 'sale' }): ScanInvoice | null {
  const A = readInvoice(L, o, 'mk'), B = readInvoice(L, o, 'dot');
  if (JSON.stringify(A?.inv) === JSON.stringify(B?.inv)) return A?.inv ?? null;
  const text = L.map(lineText);
  const f = docFmt(text);
  const pick = f === 'mk' || f === 'dot' ? f : reconcileFmt((x) => !!(x === 'mk' ? A : B)?.ok);
  if (!pick) throw new AmbiguousAmountsError('Износите во фактурата', ambExamples(text.flatMap(numTokens)));
  return (pick === 'mk' ? A : B)?.inv ?? null;
}

function readInvoice(L: readonly PdfLine[], o: { ownEdb?: string | null; kind?: 'purchase' | 'sale' }, fmt: NumFmt): { inv: ScanInvoice; ok: boolean } | null {
  const text = L.map(lineText);
  const all = text.join('\n');
  if (!/фактур|invoice|сметка|faktur/i.test(all)) return null;
  const date = dateIn(after(text, /датум на (фактура|издавање)|дата на фактура|invoice date|датум\s*:/i)) || dateIn(all);
  const due = dateIn(after(text, /(валута|рок на плаќање|доспева|due date|датум на доспевање)/i));
  const own = String(o.ownEdb ?? '').replace(/\D/g, '');
  const edbs = edbsIn(all).filter((e) => !own || !own.endsWith(e.slice(-7)));
  // VAT recapitulation: a line naming a rate with at least two amounts (base, VAT)
  const groups: { rate: number; base: number; vat: number; kind: string }[] = [];
  const bad: typeof groups = [];
  for (const t of text) {
    const m = /(?:ддв|данок|vat|стапка)?[^\d]{0,12}(18|10|5|0)\s*%/i.exec(t);
    if (!m) continue;
    const rate = +m[1]!;
    // FIX: at 0 % the VAT amount is 0 (it was dropped with the rate, so the 0 % group was lost); a 0 % line with only
    // the base („ДДВ 0% 70,00“) is the base with no VAT
    const ns = numsIn(t.slice(m.index + m[0].length), fmt).filter((n) => rate === 0 || n !== rate);
    if (rate === 0 && ns.length === 1 && ns[0]! > 0) ns.push(0);
    if (ns.length < 2) continue;
    // base, vat[, total]: pick the pair with vat ≈ base × rate
    let found: [number, number] | null = null;
    for (let i = 0; i < ns.length && !found; i++) for (let j = i + 1; j < ns.length && !found; j++) if (near(r2(ns[i]! * rate / 100), ns[j]!)) found = [ns[i]!, ns[j]!];
    // a labelled VAT line („ДДВ 10% 300,00 33,00“) whose VAT is not base × rate: kept as printed (below), never
    // replaced by a split of the total that would hide the error
    if (!found && ns.length === 2 && ns[0]! > ns[1]! && /ддв|данок|vat|стапка/i.test(m[0])) bad.push({ rate, base: ns[0]!, vat: ns[1]!, kind: 'other' });
    if (!found || (!found[0] && !found[1])) continue;
    if (groups.some((g) => g.rate === rate && near(g.base, found![0]))) continue;
    groups.push({ rate, base: found[0], vat: found[1], kind: 'other' });
  }
  const totT = after(text, /(вкупно за плаќање|износ за плаќање|за наплата|вкупен износ|вкупно со ддв|total due|grand total|вкупно)/i);
  const total = numsIn(totT, fmt).filter((n) => n > 0).pop() ?? 0;
  // the amount printed under a „to pay“ label (not a plain „Вкупно“, which is also printed for the base)
  const strong = numsIn(after(text, CLOSE_RE), fmt).filter((n) => n > 0).pop() ?? 0;
  const recap = groups.length > 0 || bad.length > 0;
  // only VAT lines that do not reconcile: the draft shows them as printed and its check reports the difference
  if (!groups.length && bad.length) groups.push(...bad);
  if (!groups.length && total > 0) {
    // no recapitulation: the total with the only rate printed on the document
    const rs = RATES.filter((r) => new RegExp(`(^|\\D)${r}\\s*%`).test(all));
    const rate = rs.length === 1 ? rs[0]! : 18;
    const base = r2(total / (1 + rate / 100));
    groups.push({ rate, base, vat: r2(total - base), kind: 'other' });
  }
  if (!groups.length) return null;
  const sum = r2(groups.reduce((s, g) => s + g.base + g.vat, 0));
  return {
    inv: {
      number: invoiceNoIn(text), date, ...(due ? { dueDate: due } : {}),
      ...(o.kind === 'sale' ? { buyerEdb: edbs[0] ?? '' } : { supplierEdb: edbs[0] ?? '', ...(supplierAccountIn(all) ? { supplierBankAccount: supplierAccountIn(all) } : {}) }),
      // FIX (one document per invoice): a printed „за плаќање“ total that does not agree with the recapitulation is
      // kept, so the check of the draft reports it („износите не се совпаѓаат“) instead of the sum hiding it
      groups, lines: [], total: total && near(total, sum) ? total : recap && strong && !near(strong, sum) ? strong : sum,
    },
    // reconciles: a recapitulation (VAT = base × rate) whose sum is the printed total
    ok: recap && total > 0 && near(total, sum),
  };
}

/* ------------------------------------------------------------------ several invoices in one PDF */

/** A label that closes an invoice: the amount to pay. */
const CLOSE_RE = /(вкупно\s+за\s+плаќање|износ\s+за\s+плаќање|за\s+наплата|за\s+плаќање|вкупно\s+со\s+ддв|total\s+due|grand\s+total|amount\s+due)/i;
/** An amount with decimals (not a date like „15.10.2026“). */
const MONEY = /(?<![\d.,])\d{1,3}(?:[.,']\d{3})*[.,]\d{2}(?![\d.,])|(?<![\d.,])\d+[.,]\d{2}(?![\d.,])/;
/** A cell that OPENS with an invoice-number label: „ФАКТУРА бр. 101/2026“, „Фактура број: F-77“, „Број на фактура: 5“. */
const HEAD_NO = [
  new RegExp(String.raw`^(?:(?:влезна|даночна|сметка[- ])\s*)?(?:фактура|ф-ра|invoice|faktura)\s*(?:бр(?:ој)?\.?|број|no\.?|nr\.?|№|#)\s*[:.]?\s*${NO}`, 'iu'),
  new RegExp(String.raw`^(?:број\s+на\s+(?:фактура|сметка-фактура)|invoice\s+(?:number|no\.?))\s*[:.]?\s*${NO}`, 'iu'),
];
/** A cell that is only the title („ФАКТУРА“, „Даночна фактура“, „INVOICE“); its number is in a „Број“ cell below. */
const TITLE = /^(?:(?:влезна|даночна|сметка[- ])\s*)?(?:фактура|invoice|faktura)$/iu;
/** „Број | 0009/2026“ under a title. */
const BROJ = new RegExp(String.raw`(?:^|  )(?:бр(?:ој)?\.?|број|no\.?|nr\.?|№)[ \t]*[:.]?[ \t]*${NO}`, 'iu');
/** A line that names a tax number (the seller's letterhead or the buyer block). */
const EDB_LINE = /ЕДБ|даночен|дан\.\s*бр|(?:MK|МК)\s?[45]\d{12}|VAT|tax/i;
/** Lines that close a printed invoice (signatures, payment note) — never part of the next one's letterhead. */
const FOOTER = /сметка|потпис|печат|м\.\s?п\.|примил|фактурирал|издал/i;

/**
 * The invoice number of a header at line `i`: '' for a title without a number, null when the line is no header.
 * Only a cell that STARTS with the label counts (a reference „по фактура бр. 11“ inside a text is no header).
 */
function headerNo(text: readonly string[], L: readonly PdfLine[], i: number): string | null {
  for (const c of L[i]!.cells) {
    const s = c.s.trim();
    for (const re of HEAD_NO) { const m = re.exec(s); if (m && !notInvoiceNo(m[1]!)) return m[1]!; }
    if (TITLE.test(s)) {
      for (let j = i + 1; j < Math.min(text.length, i + 4) && L[j]!.page === L[i]!.page; j++) {
        const m = BROJ.exec(text[j]!);
        if (m && !notInvoiceNo(m[1]!)) return m[1]!;
      }
      return '';
    }
  }
  return null;
}

/**
 * The PDF's lines cut into invoices (the rule of the bank import: every document is registered separately). A new
 * invoice starts at:
 *  - a header with ANOTHER invoice number („ФАКТУРА бр.“ / „Фактура број“ / „Број на фактура“ / a title with a „Број“
 *    cell below) — after the current invoice was closed by its total, or near the top of a page;
 *  - a new seller ЕДБ block after the current invoice was closed by its total („Вкупно за плаќање“).
 * The cut is at the top of the page when the new invoice starts on a new page (its letterhead is above the title),
 * else right above its letterhead (the lines after the previous total without amounts / dates / signatures). A
 * multi-page invoice (no total yet, or the same number repeated in the page header) stays one. The firm's own ЕДБ
 * (the buyer) is never a new seller.
 */
export function splitPdfInvoices(L: readonly PdfLine[], o: { ownEdb?: string | null } = {}): PdfLine[][] {
  if (L.length < 2) return L.length ? [[...L]] : [];
  const text = L.map(lineText);
  const own = String(o.ownEdb ?? '').replace(/\D/g, '');
  const isOwn = (e: string) => own.length >= 7 && own.endsWith(e.slice(-7));
  const cuts: number[] = [0];
  let cur: string | null = null, closed = false, lastMoney = -1, pageStart = 0;
  let seen = new Set<string>();
  for (let i = 0; i < L.length; i++) {
    const t = text[i]!;
    if (i === 0 || L[i]!.page !== L[i - 1]!.page) pageStart = i;
    const h = headerNo(text, L, i);
    const nn = h ? normDocNo(h) : '';
    const edbs = EDB_LINE.test(t) ? edbsIn(t).filter((e) => !isOwn(e)) : [];
    const start = cuts[cuts.length - 1]!;
    const newNo = !!nn && cur != null && nn !== cur && (closed || i - pageStart < 10);
    const newSeller = closed && edbs.some((e) => !seen.has(e));
    if (i > start && (newNo || newSeller)) {
      // where the new invoice starts: its page, or right above its letterhead after the previous one's last amount
      let cut = i;
      if (lastMoney < pageStart) cut = pageStart;
      else while (cut - 1 > lastMoney && i - (cut - 1) <= 6 && !MONEY.test(text[cut - 1]!) && !dateIn(text[cut - 1]!) && !FOOTER.test(text[cut - 1]!)) cut--;
      cut = Math.max(cut, start + 1);
      cuts.push(cut);
      cur = null; closed = false; seen = new Set();
      for (let j = cut; j < i; j++) if (EDB_LINE.test(text[j]!)) for (const e of edbsIn(text[j]!)) if (!isOwn(e)) seen.add(e);
    }
    if (nn && cur == null) cur = nn;
    for (const e of edbs) seen.add(e);
    if (MONEY.test(t)) { lastMoney = i; if (CLOSE_RE.test(t)) closed = true; }
  }
  return cuts.map((c, k) => L.slice(c, cuts[k + 1] ?? L.length)).filter((x) => x.length);
}

/** „2-3“ / „4“: the pages of a part. */
const pagesOf = (P: readonly PdfLine[]): string => {
  const a = Math.min(...P.map((l) => l.page)), b = Math.max(...P.map((l) => l.page));
  return a === b ? String(a) : `${a}-${b}`;
};

/**
 * Every invoice of the PDF: one when it holds one (exactly {@link invoiceFromPdf}), else one per part of
 * {@link splitPdfInvoices}, each read and checked ON ITS OWN — its own supplier, number, date, VAT groups and total
 * (never merged, never a number range, never summed) and its pages (`pages`: „2-3“). A part with an invoice header
 * whose amounts are not read is kept with no groups (its draft says „нема износ“), never dropped silently.
 */
export function invoicesFromPdf(L: readonly PdfLine[], o: { ownEdb?: string | null; kind?: 'purchase' | 'sale' } = {}): ScanInvoice[] {
  const P = splitPdfInvoices(L, o);
  if (P.length <= 1) { const one = invoiceFromPdf(L, o); return one ? [one] : []; }
  const own = String(o.ownEdb ?? '').replace(/\D/g, '');
  const out: ScanInvoice[] = [];
  for (const part of P) {
    const inv = invoiceFromPdf(part, o);
    if (inv) { out.push({ ...inv, pages: pagesOf(part) }); continue; }
    const text = part.map(lineText);
    const no = invoiceNoIn(text);
    if (!no) continue;
    const all = text.join('\n');
    const e = edbsIn(all).filter((x) => !own || !own.endsWith(x.slice(-7)));
    out.push({ number: no, date: dateIn(all), ...(o.kind === 'sale' ? { buyerEdb: e[0] ?? '' } : { supplierEdb: e[0] ?? '' }), groups: [], lines: [], total: 0, pages: pagesOf(part) });
  }
  // a part with no amounts right after an invoice (its specification / annex page) or the same number again: its pages
  return out.length > 1 ? scanInvoices(mergeAttachedInvoices({ invoices: out })) : out;
}
