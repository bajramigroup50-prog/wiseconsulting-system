/**
 * Mandatory elements of an invoice (задолжителни елементи на фактура — ЗДДВ чл. 53 ст. 10: место, датум и број;
 * назив, адреса и ДДВ број на издавачот; назив и адреса на примачот; датум на прометот; количина и вид; износ без
 * ДДВ; стапка; износ на ДДВ; вкупно; овластено лице. Ст. 6: ознака за ослободување / пренесување на обврската;
 * ст. 8: рок за издавање 5 работни дена) and the VAT
 * rate / date consistency checks, as one pure function shared by the save service (warnings), the print view and
 * the e-mail action (blocking) and the compliance dashboard (all invoices of the year).
 *
 * Severity:
 * - `block` — the document is legally not an invoice (or carries VAT it may not carry): it can be saved as a working
 *   copy, but it is not printed as final, e-mailed or sent until fixed;
 * - `warn`  — legally questionable, the accountant decides (e.g. buyer without ЕДБ who may be a natural person).
 */
import { deadlineFrom } from './deadlines';
import { INVOICE_ISSUE_WORKDAYS, VAT_RATE_PERIODS } from './rules';

export type IssueSeverity = 'block' | 'warn';
export interface LegalIssue { code: string; sev: IssueSeverity; text: string; law: string }

export interface InvoiceLegalInput {
  kind: 'invoice' | 'credit' | 'proforma' | 'dispatch' | string;
  number: string | null | undefined;
  date: string | null | undefined;
  /** Date of supply (датум на промет), if different from the issue date. */
  pdate?: string | null;
  art32?: boolean;
  export?: boolean;
  advance?: boolean;
  note?: string | null;
  /** Credit note → the invoice it corrects. */
  ref?: { number: string; date: string } | null;
  firm: { name?: string | null; address?: string | null; city?: string | null; edb?: string | null; vatRegistered: boolean };
  partner: { name?: string | null; address?: string | null; city?: string | null; edb?: string | null; vatRegistered?: boolean | null; foreign?: boolean | null } | null;
  lines: readonly { name?: string | null; qty: number | string; price: number | string; rate: number | string }[];
  today: string;
}

const L53 = 'ЗДДВ чл. 53 ст. 10 (задолжителни елементи на фактурата)';
const L536 = 'ЗДДВ чл. 53 ст. 6 (ознака на фактурата)';
const has = (s: string | null | undefined) => !!String(s ?? '').trim();
/** Macedonian ЕДБ: 13 digits (optionally with the „MK“ prefix of the VAT number). */
export const validEdb = (s: string | null | undefined): boolean => /^(MK)?\d{13}$/i.test(String(s ?? '').replace(/\s/g, ''));

/** Rates allowed on `date` (the rate table with validity, see rules.ts). */
export function vatRatesOn(date: string): readonly number[] {
  const p = [...VAT_RATE_PERIODS].reverse().find((x) => date >= x.from);
  return p ? p.rates : VAT_RATE_PERIODS[0]!.rates;
}

export function invoiceLegalIssues(x: InvoiceLegalInput): LegalIssue[] {
  const out: LegalIssue[] = [];
  const add = (code: string, sev: IssueSeverity, text: string, law = L53) => out.push({ code, sev, text, law });
  const tax = x.kind === 'invoice' || x.kind === 'credit';
  const S: IssueSeverity = tax ? 'block' : 'warn';

  if (!has(x.number)) add('number', S, 'Нема реден број на фактурата.');
  if (!x.date || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) add('date', S, 'Нема датум на издавање.');
  // the seller
  if (!has(x.firm.name)) add('seller_name', S, 'Нема назив на издавачот (фирмата).');
  if (!has(x.firm.address) && !has(x.firm.city)) add('seller_address', S, 'Нема адреса на издавачот.');
  if (!has(x.firm.edb)) add('seller_edb', x.firm.vatRegistered ? S : 'warn', x.firm.vatRegistered ? 'Нема ДДВ број (ЕДБ) на издавачот.' : 'Нема ЕДБ на издавачот.');
  else if (!validEdb(x.firm.edb)) add('seller_edb_bad', 'warn', `ЕДБ на издавачот „${x.firm.edb}“ не е со 13 цифри.`);
  // the buyer
  if (x.kind !== 'proforma' || x.partner) {
    if (!x.partner || !has(x.partner.name)) add('buyer_name', S, 'Нема назив / име на купувачот.');
    else {
      if (!has(x.partner.address) && !has(x.partner.city)) add('buyer_address', x.kind === 'invoice' && x.partner.vatRegistered ? S : 'warn', 'Нема адреса на примачот (задолжителен елемент).');
      const domestic = !x.partner.foreign;
      // чл. 53 ст. 10 т. 3 бара назив и адреса на примачот; ЕДБ на примачот е потребен за книгите и пренесувањето на обврската
      if (domestic && x.partner.vatRegistered && !has(x.partner.edb)) add('buyer_edb', 'warn', 'Купувачот е ДДВ обврзник, а нема ЕДБ – потребен за книгата на излезни фактури и за одбивка на ДДВ кај купувачот.', 'ЗДДВ чл. 52 (евиденција); чл. 53');
      else if (domestic && !x.partner.vatRegistered && !has(x.partner.edb)) add('buyer_edb_np', 'warn', 'Купувачот нема ЕДБ – дозволено само ако е физичко лице или правно лице кое не е ДДВ обврзник.');
      else if (domestic && has(x.partner.edb) && !validEdb(x.partner.edb)) add('buyer_edb_bad', 'warn', `ЕДБ на купувачот „${x.partner.edb}“ не е со 13 цифри.`);
    }
  }
  // lines: kind and quantity of goods / scope of services, base and rate
  const L = x.lines.filter((l) => has(l.name) || Number(l.price) || Number(l.qty));
  if (!L.length) add('lines', S, 'Фактурата нема ставки (вид и количина на добрата / обем на услугите).');
  L.forEach((l, i) => {
    if (!has(l.name)) add('line_name', S, `Ред ${i + 1}: нема опис на доброто / услугата.`);
    if (!Number(l.qty) && x.kind !== 'credit') add('line_qty', S, `Ред ${i + 1}: нема количина.`);
  });
  // VAT
  const rates = [...new Set(L.map((l) => Number(l.rate) || 0))];
  if (!x.firm.vatRegistered && rates.some((r) => r > 0)) {
    add('vat_not_registered', 'block', 'Фирмата не е регистрирана за ДДВ, а фактурата содржи ДДВ. Лице кое не е ДДВ обврзник не смее да искажува ДДВ (ако го искаже, должи да го плати).', 'ЗДДВ – лице што искажало ДДВ на фактура го должи (чл. 53, обврска за плаќање)');
  }
  if (x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) {
    const allowed = vatRatesOn(x.pdate && /^\d{4}-\d{2}-\d{2}$/.test(x.pdate) ? x.pdate : x.date);
    const bad = rates.filter((r) => !allowed.includes(r));
    if (bad.length) add('rate_date', 'warn', `Стапка ${bad.join(', ')}% не важела на датумот на прометот според табелата на стапки (дозволени: ${allowed.join(', ')}%) – проверете.`, 'ЗДДВ чл. 29, 30, 30-а (стапки)');
    // чл. 53 ст. 8: the invoice on the day of supply, at the latest within 5 working days
    if (x.pdate && /^\d{4}-\d{2}-\d{2}$/.test(x.pdate) && x.pdate < x.date && !x.advance && tax) {
      const lim = deadlineFrom(x.pdate, INVOICE_ISSUE_WORKDAYS.value, 'workdays');
      if (x.date > lim) add('late_issue', 'warn', `Фактурата е издадена по рокот од 5 работни дена од прометот (промет ${x.pdate.split('-').reverse().join('.')}, рок ${lim.split('-').reverse().join('.')}).`, INVOICE_ISSUE_WORKDAYS.law);
    }
    if (x.date > x.today) add('future', 'warn', 'Датумот на фактурата е во иднина.');
    if (x.pdate && x.pdate > x.date && !x.advance) add('pdate_after', 'warn', 'Датумот на промет е по датумот на издавање – проверете дали не е авансна фактура.');
  }
  if (x.firm.vatRegistered && tax && !x.export && !x.art32 && rates.includes(0) && !/не е пресметан|чл(ен|\.)\s*\d|ослобод/i.test(String(x.note ?? ''))) {
    add('exempt_ref', 'warn', 'Ставки со 0% без ознаката „данок на додадена вредност не е пресметан“ и одредбата за ослободување (напишете ја во напомената).', L536);
  }
  if (x.art32) {
    if (!x.partner || x.partner.foreign || !x.partner.vatRegistered) add('art32_buyer', 'block', 'Пренесување на даночната обврска (член 32-а) е можно само кон домашен ДДВ обврзник.', 'ЗДДВ чл. 32-а, чл. 53 ст. 6 (ознака „пренесување на даночна обврска“)');
  }
  if (x.export && x.partner && !x.partner.foreign) add('export_domestic', 'warn', 'Извозна фактура (0%) кон домашен купувач – потребна е царинска декларација / доказ за извоз.', 'ЗДДВ – ослободување за извоз со право на одбивка');
  if (x.kind === 'credit' && !x.ref) add('credit_ref', 'block', 'Одобрението (корекција) мора да се повика на фактурата што се коригира (број и датум).', 'ЗДДВ – измена на даночната основа (одобрението се повикува на фактурата)');
  return out;
}

export const blockingIssues = (L: readonly LegalIssue[]) => L.filter((i) => i.sev === 'block');
