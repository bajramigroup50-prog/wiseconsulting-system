/**
 * Cash-register receipts read with `BLG_PROMPT` → voucher drafts (legacy `blgScanFiles` 6539: `rcNum`, `rcRate`,
 * `rcDoc` 6528–6538, the per-receipt mapping in the worker loop).
 *
 * Not ported: the Tesseract OCR fallback (`rcFromText` on `S._lastOcr`) — the model reads the image directly.
 */
import { CASH_COUNTRY_CURRENCY, CASH_MK_RATE } from '../bank/cash';
import { CASH_EXPENSE_CATEGORIES } from '../data/posting';

/** Legacy `rcNum`: a number from a receipt, whatever the locale (1.234,56 / 1,234.56 / 1234,5 …). */
export function rcNum(v: unknown): number {
  if (typeof v === 'number') return v;
  let t = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > ld) t = t.replace(/\./g, '').replace(',', '.');
  else if (ld > lc && lc >= 0) t = t.replace(/,/g, '');
  else if (lc >= 0 && ld < 0) t = /,\d{3}$/.test(t) && !/,\d{1,2}$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

/**
 * Legacy `rcRate`: VAT rate of a receipt. Foreign receipts keep the printed rate (not deductible anyway); Macedonian
 * ones take the rate implied by total / VAT when it is close to 18 / 10 / 5, else the printed one, else the category
 * default (fuel 10 %, others 18 %).
 */
export function rcRate(total: number, vat: number, given: number | '', cat: string, ctry: string): number {
  if (ctry !== 'MK') return +given || 0;
  total = +total || 0;
  vat = +vat || 0;
  if (total > 0 && vat > 0 && vat < total) {
    const r = (vat / (total - vat)) * 100;
    const c = [18, 10, 5].sort((a, b) => Math.abs(a - r) - Math.abs(b - r))[0]!;
    if (Math.abs(c - r) < 1.5) return c;
  }
  if ([18, 10, 5, 0].includes(+given) && given !== '') return +given;
  return CASH_MK_RATE[cat] ?? 18;
}

/** Legacy `rcDoc`: the receipt number without words like „ФИСКАЛЕН БРОЈ“, „Beleg-Nr.“. */
export const rcDoc = (s: unknown): string =>
  String(s || '').replace(/^(ФИСКАЛ\S*\s*(СМЕТКА|БРОЈ|БР\.?)?|СМЕТКА|БРОЈ|БР\.?|Beleg-?Nr\.?|Bon\s*fiscal|Nr\.?|No\.?|Račun\s*br\.?)\s*[:#.]?\s*/i, '').trim();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Legacy `parseDate` for receipt dates: d.m.yyyy, d/m/yyyy, d-m-yyyy (European order), ISO. */
export function receiptDate(v: unknown): string {
  const t = String(v ?? '').trim();
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  const i = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return i ? i[0] : '';
}

/** One receipt as returned by `BLG_PROMPT`. */
export interface ReadReceipt {
  country?: string; currency?: string; date?: string; docNo?: string; merchant?: string; vatId?: string;
  total?: number | string; vatRate?: number | string | null; vatAmount?: number | string; category?: string; payment?: string; liters?: number | string | null;
}

/** A cash voucher (исплатница) prefilled from a receipt — the fields of the voucher editor. */
export interface ReceiptDraft {
  date: string; country: string; cur: string; docNo: string; merchant: string; vatId: string;
  /** Amount in the receipt currency ('' = not read). */
  amt: number | '';
  /** Exchange rate (1 for MKD, '' when unknown). */
  fx: number | '';
  rate: number;
  /** Macedonian VAT printed on an MKD receipt ('' = compute from the rate). */
  vat: number | '';
  cat: string; konto: string; pay: string; liters: number | '';
}

/** The receipts of a `BLG_PROMPT` reply (`{receipts:[…]}`, an array, or one object). */
export function readReceipts(r: unknown): ReadReceipt[] {
  if (!r || typeof r !== 'object') return [];
  const o = r as { receipts?: unknown };
  const L = Array.isArray(o.receipts) ? o.receipts : Array.isArray(r) ? r : [r];
  return L.filter((x): x is ReadReceipt => !!x && typeof x === 'object');
}

/**
 * `BLG_PROMPT` reply → one voucher draft per receipt (legacy `blgScanFiles` → `blgNew('out', …)`).
 * `kontoFor` is the expense konto of a category (`cashExpenseAccount` against the firm chart), `fxFor` the rate of a
 * currency on a date (`fxRate`).
 */
export function receiptDrafts(r: unknown, o: { today: string; kontoFor: (cat: string, abroad: boolean) => string; fxFor: (cur: string, date: string) => number }): ReceiptDraft[] {
  return readReceipts(r).map((q) => {
    const ctry = String(q.country || '').toUpperCase().slice(0, 2) || 'MK';
    const cur = String(q.currency || CASH_COUNTRY_CURRENCY[ctry] || 'EUR').toUpperCase();
    const date = ISO.test(String(q.date || '')) ? String(q.date) : receiptDate(q.date) || o.today;
    const cat = CASH_EXPENSE_CATEGORIES[q.category ?? ''] ? q.category! : 'other';
    const total = rcNum(q.total);
    const vatAmount = rcNum(q.vatAmount);
    const fx = cur === 'MKD' ? 1 : o.fxFor(cur, date) || '';
    return {
      date, country: ctry, cur, docNo: rcDoc(q.docNo), merchant: String(q.merchant || '').trim(), vatId: String(q.vatId || '').trim(),
      amt: total || '', fx,
      rate: rcRate(total, vatAmount, q.vatRate === '' || q.vatRate == null ? '' : rcNum(q.vatRate), cat, ctry),
      vat: ctry === 'MK' && cur === 'MKD' && vatAmount ? vatAmount : '',
      cat, konto: o.kontoFor(cat, ctry !== 'MK'), pay: String(q.payment || ''), liters: +(q.liters ?? 0) || '',
    };
  });
}

/** Legacy `blgBSave` check: a draft needs an amount, a rate for foreign currency and a konto. */
export const receiptDraftProblem = (d: Pick<ReceiptDraft, 'amt' | 'cur' | 'fx' | 'konto' | 'date'>, accountExists: (k: string) => boolean): string | null =>
  !(+d.amt > 0) ? 'нема износ' : !d.date ? 'нема датум' : d.cur !== 'MKD' && !(+d.fx > 0) ? 'нема курс' : !d.konto || !accountExists(d.konto) ? 'конто не постои' : null;
