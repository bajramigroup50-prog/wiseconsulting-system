/**
 * Payment orders — ПП30 (налог за пренос), ПП50 (јавни приходи), ПП10 (уплатница).
 * Ported from legacy `PP_T`, `PP_NACIN`, `PP_SIF`, `PP_TAX`, `ppBankName`, `ppNew`, `ppTaxNew`,
 * `PP_LAY` and the warnings of `ppRender` (legacy/index.html 15750–15803).
 *
 * FIX: legacy only checked that accounts had 15 digits; the control digits (NBRM MOD 97-10) and IBANs
 * are validated now (`mkAccountValid`, `ibanValid`), so a mistyped account is caught before printing.
 */
import { BANKS_MK, ibanValid, mkAccountValid, ppAccTxt } from './payment-order';
import { mkBankName } from './mk-banks';
import { isoOf, isoOfBank, newPayments, PURPOSE_COMMON, type BankIsoRules } from './purpose-codes';
import { fixYuscii } from '../text/yuscii';

export type PpKind = 'pp30' | 'pp50' | 'pp10';

/** Titles of the forms used until 8 Nov 2026. */
export const PP_T_OLD: Record<PpKind, string> = { pp30: 'ПП30 – Налог за пренос', pp50: 'ПП50 – Налог за јавни приходи', pp10: 'ПП10 – Уплатница' };
/** The new orders from 9 Nov 2026 (НБРМ / ISO 20022): ПП30 → КТД, ПП50 → КТБ, ПП10 → ВГ. */
export const PP_T: Record<PpKind, string> = { pp30: 'КТД – Кредитен трансфер во денари', pp50: 'КТБ – Кредитен трансфер кон буџетските корисници', pp10: 'ВГ – Внесување готовина' };
/** Short form name: КТД / КТБ / ВГ (ПП30 / ПП50 / ПП10 before 9 Nov 2026). */
export const ppShort = (k: PpKind, date?: string | null): string => (date && !newPayments(date) ? { pp30: 'ПП30', pp50: 'ПП50', pp10: 'ПП10' } : { pp30: 'КТД', pp50: 'КТБ', pp10: 'ВГ' })[k];
/** Title for an order dated `date` (old form names before 9 Nov 2026). */
export const ppTitle = (k: PpKind, date?: string | null): string => (date && !newPayments(date) ? PP_T_OLD : PP_T)[k];
export const PP_NACIN: readonly (readonly [string, string])[] = [['1', '1 – МИПС (итно)'], ['2', '2 – Клиринг (КИБС)'], ['3', '3 – Во иста банка']];
/** Purpose codes offered on the order (ISO 20022 from 9 Nov 2026; the old numbers are in the labels). */
export const PP_SIF: readonly (readonly [string, string])[] = PURPOSE_COMMON;
/** [key, name, payment account (XXX = municipality), revenue code & programme, reference kind] — check with УЈП. */
export const PP_TAX: readonly (readonly [string, string, string, string, '' | 'period' | 'month' | 'year'])[] = [
  ['ddv', 'ДДВ (промет во земјата)', '840-XXX-02687', '714116 00', 'period'],
  ['dda', 'Данок на добивка – месечна аконтација', '840-XXX-01076', '711212 00', 'month'],
  ['ddg', 'Данок на добивка – годишен (доплата)', '840-XXX-01060', '711216 00', 'year'],
  ['dim', 'Данок на имот – правни лица', '840-XXX-02512', '713113 00', ''],
];
/** Treasury account of the Budget (ПП50 recipient). */
export const PP_BUDGET_ACC = '100000000063095';

export interface PaymentOrder {
  kind: PpKind;
  date: string;
  valDate?: string;
  nacin?: string;
  code?: string;
  payer?: string;
  payerAcc?: string;
  payerBank?: string;
  payerTax?: string;
  recip?: string;
  recipAcc?: string;
  recipBank?: string;
  purpose?: string;
  /** Amount in denars (2 decimals). */
  amount?: number | null;
  refDebit?: string;
  refCredit?: string;
  uplSm?: string;
  prihod?: string;
  place?: string;
  taxKey?: string;
  /** Print accounts as IBAN (default: from 2026-11-01). */
  iban?: boolean | null;
  /** The office's per-bank purpose-code choices (set by the screen that prints, not stored on the order). */
  bankIso?: BankIsoRules | null;
  /** The purchase invoices this order pays (batch / picker). */
  refIds?: string[];
}

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Legacy `ppBankName`: bank of an account (or MK IBAN) by its 3-digit code (`MK_BANK_CODES`). */
export function ppBankName(acc: unknown): string {
  const named = mkBankName(acc);
  if (named) return named;
  const c = dig(acc).slice(0, 3);
  const B = BANKS_MK[c];
  return B ? B.n + ' АД Скопје' : '';
}

export interface PpFirm { name?: string | null; address?: string | null; city?: string | null; account?: string | null; bankName?: string | null; edb?: string | null }

/** Legacy `ppNew`: a new order pre-filled with the firm as payer. */
export function ppNew(kind: PpKind, date: string, firm: PpFirm, o: Partial<PaymentOrder> = {}): PaymentOrder {
  const acc = dig(firm.account);
  const n: PaymentOrder = {
    kind, date, valDate: date, nacin: kind === 'pp50' ? '1' : '2', code: kind === 'pp50' ? '' : newPayments(date) ? 'OTHR' : '930',
    payer: fixYuscii([firm.name, [firm.address, firm.city].filter(Boolean).join(', ')].filter(Boolean).join('\n')),
    payerAcc: acc, payerBank: firm.bankName || ppBankName(acc), payerTax: firm.edb || '', place: fixYuscii(firm.city || ''),
    purpose: '', amount: null, recip: '', recipAcc: '', recipBank: '', refDebit: '', refCredit: '', uplSm: '', prihod: '', ...o,
  };
  if (n.recipAcc && !n.recipBank) n.recipBank = ppBankName(n.recipAcc);
  if (kind === 'pp50') { n.recip = n.recip || 'Буџет на Република Северна Македонија'; n.recipAcc = PP_BUDGET_ACC; n.recipBank = 'Народна банка на РСМ'; }
  if (kind === 'pp10') { n.payerAcc = ''; n.payerBank = ''; }
  return n;
}

const ddmmyyyy = (d: Date) => String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0') + d.getUTCFullYear();

/**
 * Legacy `ppTaxNew`: ПП50 for a tax from `PP_TAX`. `today` drives the reference period (previous month /
 * previous year); `muni` is the municipality code replacing XXX; `vat` = the VAT period label and
 * amount for `ddv` (computed by the VAT module, Phase 5).
 */
export function ppTaxNew(key: string, today: string, firm: PpFirm, o: { muni?: string; akont?: number | null; vat?: { label: string; ref: string; amount: number | null } } = {}): PaymentOrder {
  const T = PP_TAX.find((x) => x[0] === key) ?? PP_TAX[0]!;
  const d = new Date(today + 'T00:00:00Z');
  const pm = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const ld = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  let ref = '';
  let amount: number | null = null;
  let purpose = T[1];
  if (T[4] === 'month') {
    ref = ddmmyyyy(pm) + '-' + ddmmyyyy(ld);
    purpose = 'Аконтација данок на добивка за ' + String(pm.getUTCMonth() + 1).padStart(2, '0') + '/' + pm.getUTCFullYear();
    amount = o.akont || null;
  }
  if (T[4] === 'year') { const y = d.getUTCFullYear() - 1; ref = '0101' + y + '-3112' + y; purpose = 'Данок на добивка за ' + y + ' година'; }
  if (T[4] === 'period' && o.vat) { purpose = 'ДДВ за ' + o.vat.label; ref = o.vat.ref; amount = o.vat.amount; }
  return ppNew('pp50', today, firm, { purpose, amount, uplSm: T[2].replace('XXX', o.muni || 'XXX'), prihod: T[3], refDebit: ref, taxKey: T[0] });
}

/** An account field is valid: 15-digit MK account with correct control digits, or a valid IBAN. */
export const ppAccountOk = (acc: unknown): boolean => {
  const s = String(acc ?? '').replace(/\s+/g, '');
  if (/^[A-Z]{2}/i.test(s)) return ibanValid(s) && (!/^MK/i.test(s) || mkAccountValid(s));
  return mkAccountValid(s);
};

/** Warnings shown before printing (legacy `ppRender` + FIX: control-digit / IBAN validation). */
export function ppWarnings(n: PaymentOrder): string[] {
  const W: string[] = [];
  if (n.kind !== 'pp10') {
    if (dig(n.payerAcc).length !== 15 && !/^[A-Z]{2}/i.test(String(n.payerAcc ?? '').trim())) W.push('Сметката на плаќачот мора да има 15 цифри или IBAN MK07… (внесете ја кај податоците на фирмата).');
    else if (!ppAccountOk(n.payerAcc)) W.push('Сметката на налогодавачот има погрешни контролни цифри.');
  }
  if (dig(n.recipAcc).length !== 15 && !/^[A-Z]{2}/i.test(String(n.recipAcc ?? '').trim())) W.push('Сметката на примачот мора да има 15 цифри или IBAN MK07….');
  else if (!ppAccountOk(n.recipAcc)) W.push('Сметката на примачот има погрешни контролни цифри (проверете ја).');
  if (!(Number(n.amount) > 0)) W.push('Внесете износ.');
  if (n.kind === 'pp50' && /XXX/.test(n.uplSm || '')) W.push('Уплатната сметка: заменете XXX со шифрата на општината на седиштето (пр. Центар 182, Тетово 169).');
  if (n.kind === 'pp50') W.push('Уплатната сметка, приходната шифра и повикувањето – проверете ги на ujp.gov.mk → Уплатни сметки (се менуваат).');
  if (newPayments(n.date)) {
    const d = ppDesc(n);
    if (d.length > 140) W.push(`Описот на плаќањето има ${d.length} знаци – дозволени се најмногу 140 (повик на број + цел на дознака).`);
    if (n.code && /^\d+$/.test(n.code.trim())) W.push(isoOf(n.code) ? `Шифрата ${n.code} од 9.11.2026 е ${isoOf(n.code)} (се печати автоматски).` : `Шифрата ${n.code} нема нова ISO шифра – изберете од листата (пр. OTHR).`);
  }
  return W;
}

/** Errors that block saving (stricter than warnings: wrong control digits). */
export function ppErrors(n: PaymentOrder): string[] {
  const E: string[] = [];
  if (n.kind !== 'pp10' && n.payerAcc && !ppAccountOk(n.payerAcc)) E.push('Сметката на налогодавачот не е валидна.');
  if (n.recipAcc && !ppAccountOk(n.recipAcc)) E.push('Сметката на примачот не е валидна.');
  if (n.amount != null && !(Number(n.amount) >= 0)) E.push('Неважечки износ.');
  return E;
}

/** Field layout of the printed forms (mm on a 210×99 slip): [field, label, x, y, w, h, multiline, type]. */
export type PpField = readonly [keyof PaymentOrder | 'sign' | 'desc', string, number, number, number, number, 0 | 1, ('acc' | 'amt' | 'date')?];
export const PP_LAY: Record<PpKind, { title: string; f: readonly PpField[] }> = {
  pp30: { title: 'НАЛОГ ЗА ПРЕНОС', f: [
    ['payer', 'НАЗИВ И СЕДИШТЕ НА НАЛОГОДАВАЧ', 5, 13, 98, 11, 1], ['payerBank', 'БАНКА НА НАЛОГОДАВАЧ', 5, 27, 98, 6, 0], ['payerAcc', 'ТРАНСАКЦИСКА СМЕТКА НА НАЛОГОДАВАЧ', 5, 36, 98, 6, 0, 'acc'],
    ['purpose', 'ЦЕЛ НА ДОЗНАКАТА', 5, 45, 98, 9, 1], ['code', 'ШИФРА', 5, 58, 16, 6, 0], ['nacin', 'НАЧИН', 23, 58, 10, 6, 0], ['amount', 'МКД  ИЗНОС', 35, 58, 68, 6, 0, 'amt'],
    ['recip', 'НАЗИВ И СЕДИШТЕ НА ПРИМАЧ', 107, 13, 98, 11, 1], ['recipBank', 'БАНКА НА ПРИМАЧ', 107, 27, 98, 6, 0], ['recipAcc', 'ТРАНСАКЦИСКА СМЕТКА НА ПРИМАЧ', 107, 36, 98, 6, 0, 'acc'],
    ['refDebit', 'ПОВИКУВАЊЕ НА БРОЈ – (ЗАДОЛЖУВАЊЕ)', 107, 45, 98, 6, 0], ['refCredit', 'ПОВИКУВАЊЕ НА БРОЈ – (ОДОБРУВАЊЕ)', 107, 54, 98, 6, 0],
    ['place', 'МЕСТО НА ПОДНЕСУВАЊЕ', 5, 72, 40, 6, 0], ['date', 'ДАТУМ НА ПОДНЕСУВАЊЕ', 48, 72, 30, 6, 0, 'date'], ['valDate', 'ДАТУМ НА ВАЛУТА', 81, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС', 140, 70, 65, 14, 0],
  ] },
  pp50: { title: 'НАЛОГ ЗА ЈАВНИ ПРИХОДИ', f: [
    ['payer', 'НАЗИВ И СЕДИШТЕ НА НАЛОГОДАВАЧ', 5, 13, 98, 11, 1], ['payerBank', 'БАНКА НА НАЛОГОДАВАЧ', 5, 27, 98, 6, 0], ['payerTax', 'ДАНОЧЕН БРОЈ или (ЕМБГ)', 5, 36, 98, 6, 0],
    ['purpose', 'ЦЕЛ НА ДОЗНАКА', 5, 45, 98, 9, 1], ['nacin', 'НАЧИН', 5, 58, 12, 6, 0], ['amount', 'МКД  ИЗНОС', 20, 58, 83, 6, 0, 'amt'],
    ['recip', 'НАЗИВ И СЕДИШТЕ НА ПРИМАЧ', 107, 13, 98, 8, 1], ['recipBank', 'БАНКА НА ПРИМАЧ', 107, 24, 98, 5, 0], ['recipAcc', 'ТРАНСАКЦИСКА СМЕТКА', 107, 32, 98, 5, 0, 'acc'],
    ['uplSm', 'УПЛАТНА СМЕТКА / СМЕТКА НА БУЏЕТСКИ КОРИСНИК', 107, 41, 98, 6, 0], ['prihod', 'ПРИХОДНА ШИФРА И ПРОГРАМА', 107, 50, 98, 6, 0], ['refDebit', 'ПОВИКУВАЊЕ НА БРОЈ – (ЗАДОЛЖУВАЊЕ)', 107, 59, 98, 6, 0],
    ['place', 'МЕСТО НА УПЛАТА', 5, 72, 40, 6, 0], ['date', 'ДАТУМ НА УПЛАТА', 48, 72, 30, 6, 0, 'date'], ['valDate', 'ДАТУМ НА ВАЛУТА', 81, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС', 140, 70, 65, 14, 0],
  ] },
  pp10: { title: 'УПЛАТНИЦА', f: [
    ['payer', 'УПЛАТУВАЧ (име, презиме и адреса)', 5, 13, 98, 11, 1], ['purpose', 'ЦЕЛ НА УПЛАТАТА', 5, 28, 98, 10, 1], ['code', 'ШИФРА', 5, 42, 16, 6, 0], ['amount', 'МКД  ИЗНОС', 23, 42, 80, 6, 0, 'amt'],
    ['recip', 'ПРИМАЧ', 107, 13, 98, 11, 1], ['recipAcc', 'СМЕТКА НА ПРИМАЧ', 107, 28, 98, 6, 0, 'acc'], ['recipBank', 'БАНКА НА ПРИМАЧ', 107, 37, 98, 6, 0], ['refCredit', 'ПОВИКУВАЊЕ НА БРОЈ – (ОДОБРУВАЊЕ)', 107, 46, 98, 6, 0],
    ['place', 'МЕСТО', 5, 72, 40, 6, 0], ['date', 'ДАТУМ', 48, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС НА УПЛАТУВАЧОТ', 140, 70, 65, 14, 0],
  ] },
};

/**
 * The new forms (НБРМ, 9 Nov 2026): „МК07“ + account, and „Повик на број одобрување / задолжување“ and „Цел на
 * дознака“ merged into one „Опис на плаќањето“ field (max 140 characters, in the order the banks prescribe).
 */
export const PP_LAY_NEW: Record<PpKind, { title: string; f: readonly PpField[] }> = {
  pp30: { title: 'КРЕДИТЕН ТРАНСФЕР ВО ДЕНАРИ – КТД', f: [
    ['payer', 'ПЛАЌАЧ (НАЗИВ И СЕДИШТЕ)', 5, 13, 98, 11, 1], ['payerBank', 'ДАВАТЕЛ НА ПЛАТЕЖНИ УСЛУГИ НА ПЛАЌАЧОТ', 5, 27, 98, 6, 0], ['payerAcc', 'ПЛАТЕЖНА СМЕТКА НА ПЛАЌАЧОТ', 5, 36, 98, 6, 0, 'acc'],
    ['desc', 'ОПИС НА ПЛАЌАЊЕТО (ИНФОРМАЦИЈА ОД ПЛАЌАЧОТ ЗА ПРИМАЧОТ)', 5, 45, 98, 9, 1], ['code', 'ШИФРА', 5, 58, 16, 6, 0], ['nacin', 'НАЧИН', 23, 58, 10, 6, 0], ['amount', 'МКД  ИЗНОС', 35, 58, 68, 6, 0, 'amt'],
    ['recip', 'ПРИМАЧ (НАЗИВ И СЕДИШТЕ)', 107, 13, 98, 11, 1], ['recipBank', 'ДАВАТЕЛ НА ПЛАТЕЖНИ УСЛУГИ НА ПРИМАЧОТ', 107, 27, 98, 6, 0], ['recipAcc', 'ПЛАТЕЖНА СМЕТКА НА ПРИМАЧОТ', 107, 36, 98, 6, 0, 'acc'],
    ['place', 'МЕСТО НА ПОДНЕСУВАЊЕ', 5, 72, 40, 6, 0], ['date', 'ДАТУМ НА ПОДНЕСУВАЊЕ', 48, 72, 30, 6, 0, 'date'], ['valDate', 'ДАТУМ НА ВАЛУТА', 81, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС', 140, 70, 65, 14, 0],
  ] },
  pp50: { title: 'КРЕДИТЕН ТРАНСФЕР КОН БУЏЕТСКИТЕ КОРИСНИЦИ – КТБ', f: [
    ['payer', 'ПЛАЌАЧ (НАЗИВ И СЕДИШТЕ)', 5, 13, 98, 11, 1], ['payerBank', 'ДАВАТЕЛ НА ПЛАТЕЖНИ УСЛУГИ НА ПЛАЌАЧОТ', 5, 27, 98, 6, 0], ['payerTax', 'ДАНОЧЕН БРОЈ или (ЕМБГ)', 5, 36, 98, 6, 0],
    ['desc', 'ОПИС НА ПЛАЌАЊЕТО (ИНФОРМАЦИЈА ОД ПЛАЌАЧОТ ЗА ПРИМАЧОТ)', 5, 45, 98, 9, 1], ['nacin', 'НАЧИН', 5, 58, 12, 6, 0], ['amount', 'МКД  ИЗНОС', 20, 58, 83, 6, 0, 'amt'],
    ['recip', 'ПРИМАЧ (НАЗИВ И СЕДИШТЕ)', 107, 13, 98, 8, 1], ['recipBank', 'ДАВАТЕЛ НА ПЛАТЕЖНИ УСЛУГИ НА ПРИМАЧОТ', 107, 24, 98, 5, 0], ['recipAcc', 'ПЛАТЕЖНА СМЕТКА НА ПРИМАЧОТ', 107, 32, 98, 5, 0, 'acc'],
    ['uplSm', 'УПЛАТНА СМЕТКА / СМЕТКА НА БУЏЕТСКИ КОРИСНИК', 107, 41, 98, 6, 0], ['prihod', 'ПРИХОДНА ШИФРА И ПРОГРАМА', 107, 50, 98, 6, 0], ['code', 'ШИФРА (не е задолжителна)', 107, 59, 40, 6, 0],
    ['place', 'МЕСТО НА ПОДНЕСУВАЊЕ', 5, 72, 40, 6, 0], ['date', 'ДАТУМ НА ПОДНЕСУВАЊЕ', 48, 72, 30, 6, 0, 'date'], ['valDate', 'ДАТУМ НА ВАЛУТА', 81, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС', 140, 70, 65, 14, 0],
  ] },
  pp10: { title: 'ВНЕСУВАЊЕ ГОТОВИНА – ВГ', f: [
    ['payer', 'ВНЕСУВАЧ (име, презиме и адреса)', 5, 13, 98, 11, 1], ['desc', 'ОПИС НА ВНЕСУВАЊЕТО ГОТОВИНА', 5, 28, 98, 10, 1], ['code', 'ШИФРА', 5, 42, 16, 6, 0], ['amount', 'МКД  ИЗНОС', 23, 42, 80, 6, 0, 'amt'],
    ['recip', 'ПРИМАЧ', 107, 13, 98, 11, 1], ['recipAcc', 'ПЛАТЕЖНА СМЕТКА НА ПРИМАЧОТ', 107, 28, 98, 6, 0, 'acc'], ['recipBank', 'ДАВАТЕЛ НА ПЛАТЕЖНИ УСЛУГИ НА ПРИМАЧОТ', 107, 37, 98, 6, 0],
    ['place', 'МЕСТО', 5, 72, 40, 6, 0], ['date', 'ДАТУМ НА ПОДНЕСУВАЊЕ', 48, 72, 30, 6, 0, 'date'], ['sign', 'ПОТПИС НА ВНЕСУВАЧОТ', 140, 70, 65, 14, 0],
  ] },
};

/** Form layout for an order dated `date` (the old ПП layout before 9 Nov 2026). */
export const ppLayout = (k: PpKind, date?: string | null) => (date && !newPayments(date) ? PP_LAY : PP_LAY_NEW)[k];

/**
 * „Опис на плаќањето“ of the new forms, in the banks' order: КТД – повик одобрување, повик задолжување, цел;
 * КТБ – повик задолжување, цел; ВГ – повик одобрување, цел. Parts are separated by „ / “.
 */
export function ppDesc(n: PaymentOrder): string {
  const p = n.kind === 'pp30' ? [n.refCredit, n.refDebit, n.purpose] : n.kind === 'pp50' ? [n.refDebit, n.purpose] : [n.refCredit, n.purpose];
  return p.map((x) => fixYuscii(String(x ?? '')).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
}

/** Legacy `ppAmt`: `1.234,56`. */
export const ppAmt = (v: unknown): string => {
  if (v === '' || v == null) return '';
  const n = Number(v) || 0;
  const [i, d] = Math.abs(n).toFixed(2).split('.') as [string, string];
  return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};

/** Text of one printed field (legacy `ppSlip` `val`). */
export function ppFieldText(n: PaymentOrder, k: PpField[0], t?: 'acc' | 'amt' | 'date'): string {
  if (k === 'sign') return '';
  if (k === 'desc') return ppDesc(n);
  // from 9 Nov 2026 the purpose code is the 4-letter ISO code (old numbers saved on orders print converted)
  if (k === 'code' && newPayments(n.date)) return isoOfBank(n.code, n.payerAcc, n.bankIso) || String(n.code ?? '');
  const v = n[k];
  if (t === 'acc') return ppAccTxt(v, n.date, n.iban ?? undefined);
  if (t === 'amt') return ppAmt(v);
  if (t === 'date') return v ? String(v).split('-').reverse().join('.') : '';
  // orders saved before the YUSCII repair print with the letters fixed („ДЕЛ^ЕВ“ → „ДЕЛЧЕВ“)
  return v == null ? '' : fixYuscii(String(v));
}
