/**
 * Purchase / sales invoice from the text layer of a PDF, without AI (e-invoices and PDFs printed by accounting
 * programs have a text layer). Reads the header data (number, date, due date, ЕДБ of supplier and buyer) and the VAT
 * recapitulation („ДДВ 18% … основица … ДДВ“) or, when there is none, the total with its rate. The result has the
 * shape of the AI read (`PUR_PROMPT` / `ublToScan`), so the same drafts are built; the user checks them as always.
 * Lines are not read (too many layouts) — the draft is booked by VAT group, like a cost invoice.
 */
import type { ScanInvoice } from '../sales/scan';
import { AmbiguousAmountsError, ambExamples, reconcileFmt, type NumFmt } from '../numfmt';
import { parseAccount, supplierAccountIn } from '../bank/mk-banks';
import { dateIn, docFmt, lineText, numsIn, numTokens, type PdfLine } from './pdf-lines';

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
    if (!found || (!found[0] && !found[1])) continue;
    if (groups.some((g) => g.rate === rate && near(g.base, found![0]))) continue;
    groups.push({ rate, base: found[0], vat: found[1], kind: 'other' });
  }
  const totT = after(text, /(вкупно за плаќање|износ за плаќање|за наплата|вкупен износ|вкупно со ддв|total due|grand total|вкупно)/i);
  const total = numsIn(totT, fmt).filter((n) => n > 0).pop() ?? 0;
  const recap = groups.length > 0;
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
      groups, lines: [], total: total && near(total, sum) ? total : sum,
    },
    // reconciles: a recapitulation (VAT = base × rate) whose sum is the printed total
    ok: recap && total > 0 && near(total, sum),
  };
}
