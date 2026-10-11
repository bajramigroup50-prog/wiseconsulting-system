/**
 * Legal parameters the compliance checks use, each with its source (verified against the consolidated texts listed in
 * docs/legal/COMPLIANCE.md, state 11.10.2026). Values marked `confirm` are the program's reading and are listed under
 * „за потврда“ in that document — change them here only together with it.
 */

export interface LegalParam<T> { value: T; law: string; confirm?: boolean }

/**
 * VAT rates by validity (ЗДДВ чл. 29 – 18%, чл. 30 – 5%, чл. 30-а – 10% угостителство / храна што не е основна).
 * The first entry is the fallback for older dates. The start date of the 10% rate is `confirm` — the check that uses
 * it only warns.
 */
export const VAT_RATE_PERIODS: readonly { from: string; rates: readonly number[]; law: string; confirm?: boolean }[] = [
  { from: '1900-01-01', rates: [18, 5, 0], law: 'ЗДДВ чл. 29 (18%), чл. 30 (5%)' },
  { from: '2019-01-01', rates: [18, 10, 5, 0], law: 'ЗДДВ чл. 30-а (10%)', confirm: true },
];

/** VAT registration threshold (ЗДДВ чл. 51) and the quarterly-filer ceiling (чл. 39). Annual turnover, denars. */
export const VAT_REGISTRATION_THRESHOLD: LegalParam<number> = { value: 2_000_000, law: 'ЗДДВ чл. 51 – задолжителна регистрација ако прометот во претходната година надминал (или се очекува да надмине) 2.000.000 ден.' };
export const VAT_MONTHLY_THRESHOLD: LegalParam<number> = { value: 25_000_000, law: 'ЗДДВ чл. 39 – даночен период е месец; тримесечје само ако прометот во претходната година не надминал 25.000.000 ден.' };
/** Days after the end of the period by which ДДВ-04 is filed (even a nil return) and the VAT paid. */
export const VAT_FILING_DAYS: LegalParam<number> = { value: 25, law: 'ЗДДВ чл. 41 ст. 1 и 3 (пријава, и кога е нула), чл. 43 ст. 2 (плаќање) – во рок од 25 дена по истекот на периодот' };
/** Invoice issued on the day of supply, at the latest within 5 working days (ЗДДВ чл. 53 ст. 8). */
export const INVOICE_ISSUE_WORKDAYS: LegalParam<number> = { value: 5, law: 'ЗДДВ чл. 53 ст. 8 – фактура на денот на прометот, најдоцна во рок од 5 работни дена' };

/** Cash payments of legal entities (Закон за платежни услуги и платни системи). Amounts in denars. */
export const CASH_LIMIT_SINGLE: LegalParam<number> = { value: 6_000, law: 'Закон за платежни услуги и платни системи – готовински плаќања на правни лица до 6.000 ден. по плаќање', confirm: true };
export const CASH_LIMIT_MONTH: LegalParam<number> = { value: 60_000, law: 'Закон за платежни услуги и платни системи – најмногу 60.000 ден. месечно во готово', confirm: true };
/** Cash for goods / services above 1.000 € is prohibited since 01.01.2025 (ЗСППФТ чл. 58, глоба чл. 204). */
export const CASH_LIMIT_EUR: LegalParam<number> = { value: 1_000, law: 'Закон за спречување перење пари и финансирање тероризам (Сл. весник 151/22), чл. 58 – забрана за готовинско плаќање над 1.000 € (од 01.01.2025)' };

/** Payroll: the payroll engine raises every wage to the statutory minimum (26.046 нето / 38.507 бруто од март 2026). */
export const MIN_WAGE_LAW = 'Закон за минимална плата (износ од март 2026: 26.046 ден. нето / 38.507 ден. бруто, Сл. весник 63/26)';

/** Profit tax: monthly advance within 15 days after each month (ЗДД чл. 40); return with the annual account (чл. 39). */
export const CIT_ADVANCE_DAY: LegalParam<number> = { value: 15, law: 'Закон за данокот на добивка чл. 40 – аконтација во рок од 15 дена по истекот на месецот' };
/** МПИН for the previous month by the 10th (ЗПЗСО чл. 18). */
export const MPIN_DAY: LegalParam<number> = { value: 10, law: 'Закон за придонеси од задолжително социјално осигурување чл. 18 – МПИН до 10-ти во тековниот за претходниот месец' };
/** Annual account (electronically) by 15 March (ЗТД; ЦРМ). */
export const ANNUAL_ACCOUNT_DAY = '03-15';
