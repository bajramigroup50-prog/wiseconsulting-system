/**
 * Purchase / sales invoice from the text layer of a PDF, without AI (e-invoices and PDFs printed by accounting
 * programs have a text layer). Reads the header data (number, date, due date, ЕДБ of supplier and buyer) and the VAT
 * recapitulation („ДДВ 18% … основица … ДДВ“) or, when there is none, the total with its rate. The result has the
 * shape of the AI read (`PUR_PROMPT` / `ublToScan`), so the same drafts are built; the user checks them as always.
 * Lines are not read (too many layouts) — the draft is booked by VAT group, like a cost invoice.
 */
import type { ScanInvoice } from '../sales/scan';
import { dateIn, lineText, numsIn, type PdfLine } from './pdf-lines';

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

export function invoiceFromPdf(L: readonly PdfLine[], o: { ownEdb?: string | null; kind?: 'purchase' | 'sale' } = {}): ScanInvoice | null {
  const text = L.map(lineText);
  const all = text.join('\n');
  if (!/фактур|invoice|сметка|faktur/i.test(all)) return null;
  const numM = /(?:фактура|invoice|сметка|faktura)[^\n\d]{0,25}?(?:бр(?:ој)?\.?|број|no\.?|nr\.?|#)?\s*[:.]?\s*([A-ZА-Ш0-9][A-ZА-Ш0-9/.\-]{0,24}\d)/i.exec(all);
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
    const ns = numsIn(t.slice(m.index + m[0].length)).filter((n) => n !== rate);
    if (ns.length < 2) continue;
    // base, vat[, total]: pick the pair with vat ≈ base × rate
    let found: [number, number] | null = null;
    for (let i = 0; i < ns.length && !found; i++) for (let j = i + 1; j < ns.length && !found; j++) if (near(r2(ns[i]! * rate / 100), ns[j]!)) found = [ns[i]!, ns[j]!];
    if (!found || (!found[0] && !found[1])) continue;
    if (groups.some((g) => g.rate === rate && near(g.base, found![0]))) continue;
    groups.push({ rate, base: found[0], vat: found[1], kind: 'other' });
  }
  const totT = after(text, /(вкупно за плаќање|износ за плаќање|за наплата|вкупен износ|вкупно со ддв|total due|grand total|вкупно)/i);
  const total = numsIn(totT).filter((n) => n > 0).pop() ?? 0;
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
    number: numM?.[1] ?? '', date, ...(due ? { dueDate: due } : {}),
    ...(o.kind === 'sale' ? { buyerEdb: edbs[0] ?? '' } : { supplierEdb: edbs[0] ?? '' }),
    groups, lines: [], total: total && near(total, sum) ? total : sum,
  };
}
