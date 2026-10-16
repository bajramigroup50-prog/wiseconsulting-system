/**
 * Two steps of the outgoing-document editor: „Заглавие“ (the header), then „Ставки“ (the lines). After „Понатаму →
 * Ставки“ the header folds into one summary line (✎ opens it again) and the lines open right under it — the page
 * does not have to be scrolled to the bottom. Pure helpers so the rules are unit-tested.
 */
import { looksLegalEntity } from '@wise/core/compliance/invoice-rules';
import type { EdInvoice, EdLine, EdPurchase } from './model';

const dmy = (x: string | null | undefined) => (x ? x.slice(0, 10).split('-').reverse().join('.') : '');

/** Required header fields still missing („Понатаму“ is blocked until they are filled). */
export function headerMissing(d: Pick<EdInvoice, 'partnerId' | 'date'>): string[] {
  const m: string[] = [];
  if (!d.partnerId) m.push('комитент');
  if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) m.push('датум');
  return m;
}
export const headerMissingText = (m: readonly string[]) => (m.length ? `Пред ставките внесете ${m.join(' и ')}.` : '');

const ABBR: Record<string, string> = { invoice: 'Ф-ра', credit: 'Одобрение', proforma: 'Профактура', dispatch: 'Испратница' };

/** The folded header: „Ф-ра 0042/2026 · 16.10.2026 · КОМИТЕНТ ДООЕЛ · валута 15 дена“. */
export function headerSummary(d: EdInvoice, partnerName: string, o: { number?: string; prodInv?: boolean } = {}): string {
  const num = o.number ?? d.number;
  const parts = [`${ABBR[d.kind] ?? 'Документ'} ${num.trim() || (d.kind === 'invoice' ? '(број при книжење)' : '—')}`, dmy(d.date), partnerName || 'без комитент'];
  if (d.kind !== 'dispatch') {
    const days = String(d.data.days ?? '').trim();
    if (d.kind === 'proforma') { if (d.due) parts.push('важи до ' + dmy(d.due)); }
    else if (days) parts.push(`валута ${days} дена`);
    else if (d.due) parts.push('валута ' + dmy(d.due));
  }
  if (d.currency && d.currency !== 'MKD') parts.push(`${d.currency} (курс ${d.fx})`);
  if (o.prodInv) parts.push('🏭 од производство');
  if (d.art32) parts.push('член 32-а');
  if (d.advance) parts.push('авансна');
  if (d.export) parts.push('извозна');
  if (d.data.nalogNo) parts.push('налог ' + d.data.nalogNo);
  return parts.join(' · ');
}

/** A line nothing was typed in (an empty row of the grid; main products of a production invoice excluded). */
export const emptyLine = (l: EdLine) => !l.prod && !l.itemId && !l.name.trim() && !Number(l.price);

/** First empty grid row at or after `from` (-1 = none, a new row is added). */
export const firstEmptyRow = (L: readonly EdLine[], from = 0) => L.findIndex((l, i) => i >= from && emptyLine(l));

export const EDB_HINT = 'За правно лице ДДВ обврзник е потребен ЕДБ на купувачот (чл. 53 ЗДДВ)';

/**
 * Soft hint of the editor (never on the print, never blocking): the buyer looks like a legal entity (ДООЕЛ, ДОО,
 * АД, ТП …), the document carries VAT and the buyer's ЕДБ or address is missing. Returns what is missing.
 */
export function buyerHint(partner: { name: string; edb?: string | null; address?: string | null; city?: string | null } | null | undefined, hasVat: boolean): string[] {
  if (!partner || !hasVat || !looksLegalEntity(partner.name)) return [];
  const m: string[] = [];
  if (!String(partner.edb ?? '').trim()) m.push('ЕДБ');
  if (!String(partner.address ?? '').trim() && !String(partner.city ?? '').trim()) m.push('адреса');
  return m;
}

/* ---------- incoming invoices (purchase editor): the same two steps ---------- */

/** Required header fields of a purchase: the supplier (from the list or a new one by name) and the date of receipt. */
export function purchaseHeaderMissing(d: Pick<EdPurchase, 'partnerId' | 'supplierName' | 'date'>): string[] {
  const m: string[] = [];
  if (!d.partnerId && !d.supplierName.trim()) m.push('добавувач');
  if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) m.push('датум на прием');
  return m;
}

/** The folded purchase header: „Влезна ф-ра 123/26 · прием 16.10.2026 · ДОБАВУВАЧ ДОО · валута 30 дена“. */
export function purchaseSummary(d: EdPurchase, supplierName: string): string {
  const parts = [`${d.imp ? 'Увозна ф-ра' : 'Влезна ф-ра'} ${d.number.trim() || '(без број)'}`, 'прием ' + dmy(d.date)];
  if (d.docDate && d.docDate !== d.date) parts.push('документ ' + dmy(d.docDate));
  parts.push(supplierName || d.supplierName.trim() || 'без добавувач');
  const days = String(d.data.days ?? '').trim();
  if (days) parts.push(`валута ${days} дена`);
  else if (d.due) parts.push('валута ' + dmy(d.due));
  if (d.imp && d.currency !== 'MKD') parts.push(`${d.currency} (курс ${d.fx || '—'})`);
  if (!d.imp) parts.push(d.cash ? 'готовина' : 'жиро сметка');
  if (d.calcNo) parts.push('калк. ' + d.calcNo);
  if (d.art32) parts.push('член 32-а');
  if (d.noDed) parts.push('без одбивање ДДВ');
  return parts.join(' · ');
}
