/**
 * Outgoing documents (invoice, credit note, proforma, dispatch note, advance invoice) — pure helpers ported from
 * legacy `DT`, `nextNumber`, `invTotal`, `totBox`, `crRest`/`crQty`/`crCheck`/`crGrossApply`, `isSvcInv`
 * (index.html 3201, 3603, 3868, 4071, 4183, 8726–8741). Deliberate fixes are marked `FIX`.
 */
import { r2 } from '../money';
import type { InvoiceItem } from '../posting';
import { advDeduct, calcLines, reverseChargeVat, type AdvanceDeduction, type CalcLinesOptions } from '../vat';

export const DOC_KINDS = ['invoice', 'credit', 'proforma', 'dispatch'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Legacy `DT` (3201) plus the service list (shares the invoice records and numbering). */
export const DT = {
  credit: { t: 'КНИЖНО ОДОБРЕНИЕ', n: 'Одобрение', nova: 'Ново одобрение', list: 'Одобренија', view: 'odobrenija' },
  service: { t: 'ФАКТУРА', n: 'Фактура', nova: 'Нова фактура за услуги', list: 'Фактури за услуги', view: 'uslugi' },
  invoice: { t: 'ФАКТУРА', n: 'Фактура', nova: 'Нова фактура', list: 'Излезни фактури', view: 'izlez' },
  proforma: { t: 'ПРОФАКТУРА', n: 'Профактура', nova: 'Нова профактура', list: 'Профактури', view: 'profakturi' },
  dispatch: { t: 'ИСПРАТНИЦА', n: 'Испратница', nova: 'Нова испратница', list: 'Испратници', view: 'ispratnici' },
} as const;
export type DtKey = keyof typeof DT;

/** Default invoice footer note (legacy `INV_NOTE0`, 3256; firm `invNote` overrides, `''` = none). */
export const INV_NOTE0 = 'Рекламации во однос на фактурата примаме исклучиво во писмена форма, најдоцна во рок од 7 дена по приемот. Доколку фактурата не биде платена во предвидениот рок, за сите промени во девизниот курс ќе бидете дополнително задолжени. Во случај на спор, стварно и месно надлежен ќе биде Основен суд Скопје 2 - Скопје.';

/** Header option lists (legacy `PAYM`, `PARITY`, `PTERMS`, 4073–4075). */
export const PAYM = ['Вирман', 'Готовина', 'Картичка', 'Компензација', 'Цесија', 'Асигнација'] as const;
export const PARITY = ['', 'EXW – франко магацин продавач', 'FCA – франко превозник', 'CPT', 'CIP', 'DAP – испорачано на место', 'DPU', 'DDP – испорачано оцаринето', 'FAS', 'FOB', 'CFR', 'CIF', 'Франко купувач', 'Франко продавач'] as const;
export const PTERMS = ['Авансно', 'Во рок од 8 дена', 'Во рок од 15 дена', 'Во рок од 30 дена', 'Во рок од 60 дена', 'Со испорака', 'По приемот на фактурата', 'Акредитив'] as const;
export const CURRENCIES = ['MKD', 'EUR', 'USD', 'CHF', 'GBP'] as const;

/** `YYYY-MM-DD` + n days (legacy `addDays`). */
export function addDays(d: string, n: number | string): string {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + (Number(n) || 0));
  return x.toISOString().slice(0, 10);
}

const numPart = (s: string) => parseInt(String(s ?? '').replace(/^\D+/, ''), 10) || 0;

/**
 * Next document number of a kind in a year (legacy `nextNumber`, 4071): prefix, zero padding and suffix of the
 * highest number are kept (`007/2026` → `008/2026`); with no documents `001/<year>`.
 *
 * FIX (LEGACY-MAP 3.4 item 17): legacy used `max(highest, count) + 1`, so a year with irregular or imported numbers
 * (e.g. only `5/2026` and two unnumbered drafts) jumped ahead. Only the highest number counts now.
 */
export function nextDocNumber(existing: readonly (string | null | undefined)[], year: number | string): string {
  const L = existing.map((x) => String(x ?? '').trim()).filter(Boolean);
  let best: string | undefined;
  for (const x of L) if (!best || numPart(x) > numPart(best)) best = x;
  const n = (best ? numPart(best) : 0) + 1;
  const m = best ? /^(\D*)(\d+)(.*)$/.exec(best) : null;
  return m ? m[1] + String(n).padStart(m[2]!.length, '0') + m[3] : String(n).padStart(3, '0') + '/' + year;
}

/** Legacy `nn` used by the duplicate checks: lower case, only digits and (Cyrillic/Latin) letters. */
export const normDocNo = (x: unknown): string => String(x ?? '').toLowerCase().replace(/[^0-9a-zа-шѓќљњџѕј]/gi, '');

export interface InvoiceTotalsInput {
  items: readonly InvoiceItem[];
  art32?: boolean;
  advance?: boolean;
  credit?: boolean;
  advances?: readonly AdvanceDeduction[];
}
export interface InvoiceTotals {
  base: number;
  vat: number;
  total: number;
  /** Art. 32-a: VAT 18% the buyer calculates (shown, not charged). */
  transferredVat: number;
  /** Deducted advances incl. VAT. */
  advTotal: number;
  /** Amount to pay (legacy docHTML `pay`). */
  pay: number;
  by: ReturnType<typeof calcLines>['by'];
}

/**
 * Invoice totals as shown in the editor box and on the print (legacy `totBox` 4183 and `docHTML` 4296).
 * FIX (LEGACY-MAP 3.4 item 5): the art. 32-a "transferred VAT" is `reverseChargeVat(base)` in both places — legacy used
 * `r2(base·0.18)` in the editor and the sum of per-line VATs on the print.
 */
export function invoiceTotals(inv: InvoiceTotalsInput, opts: CalcLinesOptions = {}): InvoiceTotals {
  const c = calcLines(inv.items, inv.art32, opts);
  const A = inv.credit || inv.advance ? { total: 0 } : advDeduct(inv.advances, opts);
  const gross = inv.art32 ? c.base : c.total;
  return {
    base: c.base, vat: c.vat, total: c.total, by: c.by,
    transferredVat: inv.art32 && !opts.nonVat ? reverseChargeVat(c.base) : 0,
    advTotal: A.total,
    pay: r2(gross - A.total),
  };
}

/* ------------------------------------------------------------------ service invoices */

/**
 * Service invoice (Услуги list).
 * FIX (LEGACY-MAP 3.4 item 13): legacy `isSvcInv` counted free-text lines as services, so every invoice without
 * linked items appeared in both Излез and Услуги. Now an invoice is a service invoice when it was written in
 * service mode (`svc`) or every line is linked to a service item; the Излез list shows the others.
 */
export function isServiceInvoice(inv: { svc?: boolean | null; items: readonly { itemId?: string | null }[] }, itemType: (id: string) => string | undefined): boolean {
  if (inv.svc) return true;
  return inv.items.length > 0 && inv.items.every((l) => !!l.itemId && itemType(l.itemId) === 'service');
}

/* ------------------------------------------------------------------ credit notes */

export interface CreditRef {
  id: string;
  partnerId: string | null;
  date: string;
  number: string;
  total: number;
  items: readonly { itemId?: string | null; qty: number | string }[];
}
export interface OtherCredit { total: number; kind: string; items: readonly { itemId?: string | null; qty: number | string }[] }

/** Remaining creditable amount of an invoice (legacy `crRest`). */
export const creditRest = (ref: Pick<CreditRef, 'total'>, others: readonly Pick<OtherCredit, 'total'>[]): number =>
  r2(ref.total - others.reduce((a, x) => a + x.total, 0));

/** Sold / already returned / still returnable quantity of an item (legacy `crQty`). */
export function creditQty(ref: CreditRef, itemId: string, others: readonly OtherCredit[]) {
  const q = (l: readonly { itemId?: string | null; qty: number | string }[]) => l.filter((x) => x.itemId === itemId).reduce((a, x) => a + (Number(x.qty) || 0), 0);
  const sold = q(ref.items);
  const back = others.filter((x) => x.kind === 'ret').reduce((a, x) => a + q(x.items), 0);
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  return { sold: r4(sold), back: r4(back), rest: r4(sold - back) };
}

/**
 * Validation of a credit note against its invoice (legacy `crCheck`, 8731). Returns the error message or `null`.
 * Same buyer, not dated before the invoice, not above the remainder, returns not above the sold quantity.
 */
export function checkCredit(
  cr: { partnerId: string | null; date: string; total: number; kind: string; items: readonly { itemId?: string | null; qty: number | string; name?: string }[] },
  ref: CreditRef, others: readonly OtherCredit[], itemType: (id: string) => string | undefined,
): string | null {
  if (ref.partnerId !== cr.partnerId) return 'Купувачот на одобрението мора да биде ист како на фактурата.';
  if (cr.date < ref.date) return `Датумот на одобрението не може да биде пред датумот на фактурата (${ref.date.split('-').reverse().join('.')}).`;
  const rest = creditRest(ref, others);
  if (cr.total > rest + 0.5) return `Одобрението (${cr.total.toFixed(2)}) е поголемо од остатокот на фактурата ${ref.number} (${rest.toFixed(2)}).`;
  if (cr.kind === 'ret') {
    const sum = new Map<string, number>();
    for (const l of cr.items) {
      if (!(Number(l.qty) > 0) || !l.itemId) continue;
      const t = itemType(l.itemId);
      if (t && t !== 'service') sum.set(l.itemId, (sum.get(l.itemId) ?? 0) + Number(l.qty));
    }
    if (!sum.size) return 'Повратница: нема ниту една ставка поврзана со артикл од залиха.';
    for (const [id, q] of sum) {
      const x = creditQty(ref, id, others);
      if (q > x.rest + 1e-9) return `Не може да се врати повеќе отколку што е фактурирано (враќа ${q}, фактурирано ${x.sold}${x.back ? ', веќе вратено ' + x.back : ''}).`;
    }
  }
  return null;
}

/** Spread a gross credit amount over the VAT rates of the invoice (legacy `crGrossApply`, 8741). */
export function creditGrossLines(ref: { number: string; items: readonly InvoiceItem[]; art32?: boolean }, gross: number): InvoiceItem[] {
  const G = r2(gross);
  const c = calcLines(ref.items, ref.art32);
  if (!G || !c.total) return [];
  const L: InvoiceItem[] = c.by.filter((g) => g.base + g.vat).map((g) => {
    const sh = (G * (g.base + g.vat)) / c.total;
    const rate = ref.art32 ? 18 : g.rate;
    return {
      name: 'Одобрение кон фактура ' + (ref.number || '') + (c.by.length > 1 ? ' – ДДВ ' + g.rate + '%' : ''),
      unit: '', qty: 1, price: r2(sh / (1 + (ref.art32 ? 0 : rate) / 100)), disc: 0, rate: g.rate, konto: g.konto,
    };
  });
  for (let i = 0; i < 4 && L.length; i++) {
    const diff = r2(G - calcLines(L, ref.art32).total);
    if (!diff) break;
    const l = L[L.length - 1]!;
    l.price = r2(Number(l.price) + diff / (1 + (ref.art32 ? 0 : Number(l.rate)) / 100));
  }
  return L;
}

/** Allowed VAT rates on a document line (legacy saveInv check). */
export const VALID_LINE_RATES = [0, 5, 10, 18] as const;
