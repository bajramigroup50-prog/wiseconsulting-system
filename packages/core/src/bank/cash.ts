/**
 * Cash register (благајна) helpers — legacy `BLG_CTRY`, `BLG_CUR`, `BLG_MKRATE`, `blgRegs`, `blgNextNo`,
 * `blgDup` (legacy/index.html 6510–6537). Posting is `blgEntries` / `blgCalc` in posting.ts / vat.ts.
 *
 * FIX (LEGACY-MAP 4.4 #4): legacy `BLG_FX0` (a second, disagreeing table of fallback rates, EUR 61.5,
 * USD 57 …) is not ported — the voucher rate always comes from `fxRate` (firm codebook → office rate
 * list → `FX_DEF`).
 */

/** Countries offered on a receipt (legacy `BLG_CTRY`). */
export const CASH_COUNTRIES: Readonly<Record<string, string>> = {
  MK: 'Македонија', AL: 'Албанија', XK: 'Косово', RS: 'Србија', BG: 'Бугарија', GR: 'Грција', ME: 'Црна Гора', BA: 'БиХ', HR: 'Хрватска',
  SI: 'Словенија', HU: 'Унгарија', RO: 'Романија', AT: 'Австрија', DE: 'Германија', IT: 'Италија', FR: 'Франција', NL: 'Холандија',
  BE: 'Белгија', LU: 'Луксембург', CH: 'Швајцарија', CZ: 'Чешка', SK: 'Словачка', PL: 'Полска', DK: 'Данска', SE: 'Шведска',
  ES: 'Шпанија', PT: 'Португалија', TR: 'Турција', GB: 'В. Британија', IE: 'Ирска', LT: 'Литванија', LV: 'Латвија', EE: 'Естонија',
  FI: 'Финска', NO: 'Норвешка', UA: 'Украина', MD: 'Молдавија',
};

/** Currency of a country (legacy `BLG_CUR`). */
export const CASH_COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  EU: 'EUR', AT: 'EUR', DE: 'EUR', IT: 'EUR', FR: 'EUR', NL: 'EUR', BE: 'EUR', LU: 'EUR', GR: 'EUR', SI: 'EUR', HR: 'EUR', SK: 'EUR',
  ES: 'EUR', PT: 'EUR', IE: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', FI: 'EUR', XK: 'EUR', ME: 'EUR', MK: 'MKD', AL: 'ALL', RS: 'RSD',
  BG: 'EUR', HU: 'HUF', RO: 'RON', CH: 'CHF', CZ: 'CZK', PL: 'PLN', DK: 'DKK', SE: 'SEK', TR: 'TRY', GB: 'GBP', BA: 'BAM', NO: 'NOK',
  UA: 'UAH', MD: 'MDL',
};

/** Default Macedonian VAT rate per expense category (legacy `BLG_MKRATE`, fuel 10 %); others 18 %. */
export const CASH_MK_RATE: Readonly<Record<string, number>> = { fuel: 10 };
export const cashDefaultRate = (cat: string | undefined, country: string | undefined): number =>
  (country || 'MK') === 'MK' ? CASH_MK_RATE[cat ?? ''] ?? 18 : 0;

export interface CashRegisterDef { id?: string; name: string; konto: string; cur: string }

/** Legacy `blgRegs` defaults when the firm has none: 1020 MKD, plus 1051 / 1052 EUR when in the chart. */
export function defaultCashRegisters(accountExists: (k: string) => boolean): CashRegisterDef[] {
  const R: CashRegisterDef[] = [{ name: 'Главна благајна', konto: '1020', cur: 'MKD' }];
  if (accountExists('1051')) R.push({ name: 'Девизна благајна – службени патувања', konto: '1051', cur: 'EUR' });
  if (accountExists('1052')) R.push({ name: 'Девизна благајна – транспорт', konto: '1052', cur: 'EUR' });
  return R;
}

/** Legacy `blgNextNo`: У-nnn (in) / И-nnn (out), per register and year — `numbers` are that register's numbers in the year. */
export function cashVoucherNextNo(kind: 'in' | 'out', numbers: readonly (string | null | undefined)[]): string {
  const mx = numbers.reduce<number>((m, n) => Math.max(m, parseInt(String(n || '').replace(/^\D+/, '')) || 0), 0);
  return (kind === 'in' ? 'У-' : 'И-') + String(mx + 1).padStart(3, '0');
}

export interface CashDupKey { id?: string; docNo?: string | null; date: string; amt: number | string }

/** Legacy `blgDup`: same receipt number, date and amount. */
export function cashVoucherDuplicate<T extends CashDupKey>(x: CashDupKey, others: readonly T[]): T | undefined {
  const no = String(x.docNo ?? '').trim();
  if (!no) return undefined;
  return others.find((d) => d.id !== x.id && String(d.docNo ?? '').trim() === no && d.date === x.date && Math.abs((+d.amt || 0) - (+x.amt || 0)) < 0.01);
}
