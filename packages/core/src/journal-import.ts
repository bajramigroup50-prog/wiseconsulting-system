/**
 * Journal import („Налог за книжење“ from Excel / CSV / the old program's „Финансов налог“ PDF) — the pure part.
 *
 * The owner keeps the books of January–September in the old program and continues in WISE: the journals of the old
 * program come in exactly, so the trial balance of September is the old program's. This module turns the mapped
 * rows of the importer (`IMP_T.journal` fields, numbers / dates already parsed by the screen) into journal lines and
 * groups them into nalozi; the database part (`@wise/db` `journal-import.ts`) matches partners and kontos, checks
 * periods and duplicates, shows the preview and posts.
 *
 * - Columns: date, nalog type and number, konto, debit / credit OR one amount with a side column (Д / П, or the sign),
 *   partner code / ЕДБ / name, document, description, currency amount.
 * - Text goes through `fixYuscii` (the old program's „Ш~ип“ / „ДЕЛ^ЕВ“); a konto „1200-001“ gives the analytic suffix
 *   as the partner code, a partner „1029 МАЈАНЦЕ“ its code.
 * - Empty date / type / number cells take the value of the row above (the old program prints them once per nalog).
 * - Grouping: by type + number (else type + date); one WISE journal per date when every date of the nalog balances,
 *   else per month, else one journal on the last date of the nalog (with a warning).
 * - The number is kept as the old program printed it, `type/number` („06/9“) like WISE's own „6/1-3“; a bare number
 *   gets the prefix „У“ so it can never be a WISE counter number (1021, 1022…), the opening „0“ or the closing „999“.
 * All sums are in integer cents.
 */
import { fixYusciiAll } from './text/yuscii';
import { calcLines } from './vat';
import { NO_VAT_NOTE_MSG, vatNoteOf } from './sales/scan';
import { CUSTOMER_EXEMPT_KONTO } from './posting';
import { kontoParse, partnerSplit } from './tb-rows';
import { ACCOUNT_CODE_RE, needsPartner } from './ledger';
import { IMP_T, impAuto, impDate, impNum, impNumFormats, type DecMode } from './retail/import';

/** One mapped row of the file (field key → value), `r` = row number in the file (1-based). */
export type JiIn = Readonly<Record<string, string | number | null | undefined>>;

export interface JiRow {
  /** row number in the file */
  r: number;
  date: string; type: string; no: string; k: string;
  /** cents */
  d: number; p: number;
  pcode: string; pedb: string; pname: string; doc: string; desc: string; cur: string; curAmt: number | null;
  /** konto name of the file (shown, not imported) */
  kname?: string;
  /** „Поч. сос.“ flag of the row: it belongs to the opening balance */
  ob?: boolean;
}
export interface JiBad { r: number; msg: string }

const TOTAL_RE = /(^|[\s(.:])(се\s+вкупно|вкупно|тотал|збир|сума|total|saldo|салдо|vkupno|ukupno|zbir)(?=$|[\s:.)\d])/i;
const cents = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const txt = (v: unknown): string => fixYusciiAll(String(v ?? '').trim()).replace(/\s+/g, ' ');
/** Side cell → 'd' | 'p' | '' (Д / П, D / P, должи / побарува, debit / credit, 1 / 2). */
export function jiSide(v: unknown): 'd' | 'p' | '' {
  const s = txt(v).toLowerCase().replace(/[.\s]/g, '');
  if (!s) return '';
  if (/^(д|d|dr|дол|должи|dolzi|dolži|debit|deb|duguje|dug|1)/.test(s)) return 'd';
  if (/^(п|p|cr|поб|побарува|pobaruva|credit|kredit|kred|potražuje|potrazuje|pot|2)/.test(s)) return 'p';
  return '';
}

/**
 * Mapped rows → journal lines. Rows without an amount, empty rows and total rows („Вкупно“, „Салдо“) are left out
 * (`skipped`); a row with an amount but without a konto or a date, or with a side that is not recognised, is `bad`
 * (it is listed and blocks the import — nothing is imported with a missing konto).
 */
export function jiRows(input: readonly JiIn[], def: { type?: string; no?: string } = {}): { rows: JiRow[]; bad: JiBad[]; skipped: number } {
  const rows: JiRow[] = [], bad: JiBad[] = [];
  let skipped = 0;
  let last = { date: '', type: '', no: '' };
  input.forEach((x, i) => {
    const r = typeof x.r === 'number' ? x.r : i + 2;
    const g = (k: string) => txt(x[k]);
    const kRaw = x.k;
    const kp = kontoParse(typeof kRaw === 'number' ? kRaw : g('k'));
    let d = cents(x.d), p = cents(x.p);
    if (!d && !p && x.amt != null && x.amt !== '') {
      const a = cents(x.amt);
      const side = jiSide(x.side);
      if (g('side') && !side) { bad.push({ r, msg: `страната „${g('side')}“ не е Д или П` }); return; }
      if (side === 'd') d = a; else if (side === 'p') p = a;
      else if (a >= 0) d = a; else p = -a; // no side column: the sign (+ должи, − побарува)
    }
    const texts = ['k', 'desc', 'pname', 'partner', 'doc', 'no', 'type'].map(g).filter(Boolean);
    if (!d && !p) { skipped++; return; }
    if (!kp.k && texts.some((t) => TOTAL_RE.test(t))) { skipped++; return; }
    // the totals row at the end of the old program's export: amounts only, no konto, date or text
    if (!kp.k && !g('date') && !texts.length) { skipped++; return; }
    // the old program prints the date / type / number once per nalog
    const date = /^\d{4}-\d{2}-\d{2}$/.test(g('date')) ? g('date') : g('date') ? '' : last.date;
    let type = g('type') || (g('no') ? '' : last.type);
    let no = g('no') || last.no;
    // a file without nalog numbers is one nalog: the number / type typed in the preview (default from the file name)
    if (!no && !type) { type = (def.type ?? '').trim(); no = (def.no ?? '').trim(); }
    if (!kp.k || !ACCOUNT_CODE_RE.test(kp.k)) { bad.push({ r, msg: g('k') ? `неважечко конто „${g('k')}“` : 'нема конто' }); return; }
    if (!date) { bad.push({ r, msg: g('date') ? `неважечки датум „${g('date')}“` : 'нема датум' }); return; }
    last = { date, type, no };
    let pcode = g('pcode'), pname = g('partner') || g('pname');
    if (pname && !pcode) { const ps = partnerSplit(pname); if (ps.code) { pcode = ps.code; pname = ps.name; } }
    if (!pcode && kp.sub) pcode = kp.sub;
    const cd = cents(x.curD), cp = cents(x.curP);
    const ca = cd || cp ? (cd || cp) : x.curAmt == null || x.curAmt === '' ? null : cents(x.curAmt);
    rows.push({ r, date, type, no, k: kp.k, d, p, pcode, pedb: g('pedb').replace(/\D/g, ''), pname, doc: g('doc'), desc: g('desc'), kname: g('kname'), ob: !!g('ob') && /^(да|da|д|d|yes|y|1|x|true|po)/i.test(g('ob')), cur: g('cur').toUpperCase().slice(0, 3), curAmt: ca });
  });
  return { rows, bad, skipped };
}

/**
 * The old program's opening balance: on 1 January with the source / type „ПОЧЕТНА СОСТОЈБА“ (or the nalog number 0).
 * It is not a journal of the year — it goes to WISE's „Почетна состојба“ (nalog 0) or is left out when that exists.
 */
export const jiIsOpening = (r: Pick<JiRow, 'date' | 'type' | 'no' | 'ob'>): boolean =>
  !!r.ob || r.date.endsWith('-01-01') && (/почетн\S*\s+состојб|pocetn\S*\s+sostojb|^0+$/i.test(r.type) || /^0+$/.test(r.no));

/**
 * The nalog's WISE number: `type/number` as the old program had it, or the bare number. „0“ / „999“ (WISE's opening
 * and closing) get „У“; a number WISE already uses in the year gets „У“ too (`journal-import.ts` in `@wise/db`) — the
 * WISE counter (1021, 1022 …) skips every number already used, so it never takes an imported one later.
 */
export function jiNumber(type: string, no: string): string | null {
  if (!type && !no) return null;
  const n = type && no ? `${type}/${no}` : no || type;
  return /^0+$|^999$/.test(n) ? 'У' + n : n;
}

/**
 * Default nalog type / number from the file name when the file has no nalog column: „1-1-3“ = nalog 1 for the
 * months 1–3 (WISE's „1/1-3“), „NALOG1“ → 1, „06-9“ → type 06, number 9.
 */
export function jiNameDefault(file: string): { type: string; no: string } {
  const b = file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  // „PLATA 7“: the payroll nalog of month 7 → WISE's payroll code (12, „ПЛАТА“, per month: 12/7-7)
  const pm = /(?:PLAT[AI]|ПЛАТ[АИ])\s*[-_ ]?\s*(\d{1,2})(?!\d)/i.exec(b);
  if (pm && +pm[1]! >= 1 && +pm[1]! <= 12) return { type: '12', no: `${+pm[1]!}-${+pm[1]!}` };
  // „NALOG DDV 1-3“: the VAT nalog of months 1–3 → WISE's VAT nalog code (4, „ДДВ ПРИЈАВА“)
  let m = /(?:DDV|ДДВ)\s*[-_ ]?\s*(\d{1,2})\s*[-_ ]\s*(\d{1,2})(?!\d)/i.exec(b);
  if (m && +m[1]! >= 1 && +m[2]! <= 12 && +m[1]! <= +m[2]!) return { type: '4', no: `${+m[1]!}-${+m[2]!}` };
  m = /(\d+)\s*[-_ ]\s*(\d{1,2})\s*[-_ ]\s*(\d{1,2})(?!\d)/.exec(b);
  if (m && +m[2]! >= 1 && +m[3]! <= 12 && +m[2]! <= +m[3]!) return { type: m[1]!, no: `${+m[2]!}-${+m[3]!}` };
  m = /(\d+)\s*[-_/]\s*(\d+)/.exec(b);
  if (m) return { type: m[1]!, no: m[2]! };
  m = /(\d+)(?!.*\d)/.exec(b);
  return { type: '', no: m ? String(+m[1]!) : '' };
}

/** A label of the nalog for messages („06/9“, „налог од 15.01.2026“). */
export const jiLabel = (type: string, no: string, date: string): string =>
  no ? (type ? `${type}/${no}` : no) : `${type ? type + ' ' : ''}од ${date.split('-').reverse().join('.')}`;

export interface JiJournal {
  /** nalog key (type + number, else type + date) */
  key: string; label: string; type: string; no: string; number: string | null;
  date: string; rows: JiRow[];
  /** cents */
  D: number; P: number;
  /** duplicate key: type | number | date | total in cents (the same nalog imported twice) */
  dup: string;
  warn?: string;
  /** the opening balance (posted as „Почетна состојба“, not as a journal of the year) */
  opening?: boolean;
}
export interface JiUnbalanced { label: string; D: number; P: number; rows: number[] }

const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const sumD = (R: readonly JiRow[]) => R.reduce((s, x) => s + x.d, 0);
const sumP = (R: readonly JiRow[]) => R.reduce((s, x) => s + x.p, 0);
const split = <T>(R: readonly JiRow[], f: (x: JiRow) => T): Map<T, JiRow[]> => {
  const M = new Map<T, JiRow[]>();
  for (const x of R) { const k = f(x); M.set(k, [...(M.get(k) ?? []), x]); }
  return M;
};

/** Rows → WISE journals (see the module comment); an unbalanced nalog is returned in `unbalanced`, not as journals. */
export function jiGroup(rows: readonly JiRow[]): { journals: JiJournal[]; unbalanced: JiUnbalanced[] } {
  const N = split(rows, (x) => (x.no ? `${x.type}|${x.no}` : `${x.type}|@${x.date}`));
  const journals: JiJournal[] = [], unbalanced: JiUnbalanced[] = [];
  for (const [key, R] of N) {
    const { type, no } = R[0]!;
    const label = jiLabel(type, no, R[0]!.date);
    const D = sumD(R), P = sumP(R);
    if (D !== P) { unbalanced.push({ label, D, P, rows: R.map((x) => x.r) }); continue; }
    const mk = (part: JiRow[], date: string, warn?: string): JiJournal => {
      const d = sumD(part);
      return { key, label, type, no, number: jiNumber(type, no), date, rows: part, D: d, P: sumP(part), dup: `${type}|${no}|${date}|${d}`, ...(warn ? { warn } : {}) };
    };
    const ok = (M: Map<string, JiRow[]>) => [...M.values()].every((x) => sumD(x) === sumP(x));
    const byDay = split(R, (x) => x.date);
    if (ok(byDay)) { for (const [d, part] of [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1))) journals.push(mk(part, d)); continue; }
    const byMonth = split(R, (x) => x.date.slice(0, 7));
    const lastOf = (part: JiRow[]) => part.reduce((m, x) => (x.date > m ? x.date : m), '');
    if (ok(byMonth)) {
      for (const part of byMonth.values()) {
        const d = lastOf(part);
        journals.push(mk(part, d, byDay.size > 1 ? `налогот ${label} не е во рамнотежа по денови – книжен со датум ${d.split('-').reverse().join('.')}` : undefined));
      }
      continue;
    }
    const d = lastOf(R);
    journals.push(mk(R, d, `налогот ${label} не е во рамнотежа по месеци – целиот е книжен со датум ${d.split('-').reverse().join('.')}`));
  }
  journals.sort((a, b) => byDate(a, b) || a.key.localeCompare(b.key, 'mk', { numeric: true }));
  return { journals, unbalanced };
}

export interface JiMonth { m: string; nalogs: number; journals: number; lines: number; D: number; P: number }

/** Per month: nalozi (distinct type + number), WISE journals, lines, Σ debit / Σ credit (cents). */
export function jiMonths(J: readonly JiJournal[]): JiMonth[] {
  const M = new Map<string, JiMonth & { keys: Set<string> }>();
  for (const j of J) {
    const m = j.date.slice(0, 7);
    const x = M.get(m) ?? { m, nalogs: 0, journals: 0, lines: 0, D: 0, P: 0, keys: new Set<string>() };
    x.keys.add(j.key); x.journals++; x.lines += j.rows.length; x.D += j.D; x.P += j.P;
    M.set(m, x);
  }
  return [...M.values()].sort((a, b) => (a.m < b.m ? -1 : 1)).map(({ keys, ...x }) => ({ ...x, nalogs: keys.size }));
}

/** Konto of 1–3 digits with longer kontos under it in the chart: a synthetic, the journal needs the analytic. */
export function jiSynthetic(k: string, chart: ReadonlySet<string> | readonly string[]): boolean {
  if (k.length > 3) return false;
  for (const c of chart) if (c.length > k.length && c.startsWith(k)) return true;
  return false;
}

export { needsPartner };

/** The downloadable template: the importer's headings and a small example (bank statement + an invoice). */
export function jiTemplate(): (string | number)[][] {
  const H = IMP_T.journal.f.map((f) => f[1].replace('*', ''));
  const row = (o: Record<string, string | number>) => IMP_T.journal.f.map(([k]) => o[k] ?? '');
  return [
    H,
    row({ date: '15.01.2026', type: '06', no: '1', k: '1000', d: 11800, doc: 'Извод 1', desc: 'Наплата од купувач' }),
    row({ date: '15.01.2026', type: '06', no: '1', k: '1200', p: 11800, pcode: '1029', pedb: '4030000000000', partner: 'Купувач ДООЕЛ', doc: 'Ф-1/2026', desc: 'Наплата' }),
    row({ date: '10.01.2026', type: '40', no: '1', k: '1200', d: 11800, pcode: '1029', pedb: '4030000000000', partner: 'Купувач ДООЕЛ', doc: 'Ф-1/2026', desc: 'Фактура 1' }),
    row({ date: '10.01.2026', type: '40', no: '1', k: '7400', p: 10000, doc: 'Ф-1/2026', desc: 'Фактура 1' }),
    row({ date: '10.01.2026', type: '40', no: '1', k: '2300', p: 1800, doc: 'Ф-1/2026', desc: 'ДДВ 18 %' }),
  ];
}

/* ------------------------------------------------------------------ outgoing invoices („Увези како излезни фактури“) */

export interface JiInvoice {
  /** the printed number (the document / „Содржина“ of the lines) */
  no: string; date: string; rows: JiRow[];
  /** the receivable line (120x debit, with the partner) */
  ar: JiRow;
  /** revenue lines: konto, base and VAT rate (from the VAT konto 2300<rate>) — cents */
  lines: { account: string; base: number; rate: number; vat?: number }[];
  base: number; vat: number; total: number;
  /**
   * the old program rounded the VAT (to whole denars): WISE's own VAT `calc` and the file's `file` (cents); the
   * difference is booked on the first line of the rate as its VAT (`vat`, saved as `invoice_lines.vat_fix`)
   */
  vatRound?: { rate: number; calc: number; file: number };
  /**
   * An invoice without VAT: its exemption kind and legal basis (`invoices.data.vatExempt` / `vatNote`). In the old program
   * a receivable on 1200009 marks a sale exempt with the right to deduct (ЗДДВ чл. 24, field 08).
   */
  vatExempt?: 'ded' | 'noded';
  vatNote?: string;
}

/** Legal basis given to an invoice imported from a 1200009 receivable (old program: чл. 24 exempt sales). */
export const JI_EXEMPT_NOTE = 'Ослободено од ДДВ со право на одбивка согласно член 24 од ЗДДВ';
export interface JiInvoiceRefused { no: string; rows: number[]; why: string }

/** The legal VAT rates (ЗДДВ чл. 29 / 30). */
const JI_RATES = [18, 10, 5];
/** VAT rate of an output-VAT konto: 230018 → 18, 230010 → 10, 23005 → 5 (else null). */
export const jiVatRate = (k: string): number | null => {
  const m = /^2300(18|10|5)$/.exec(k);
  return m ? Number(m[1]) : null;
};
/** The document of a line: the document column, else the description („Содржина“ = the invoice number). */
export const jiDocOf = (r: Pick<JiRow, 'doc' | 'desc'>): string => r.doc || r.desc;

/**
 * Invoice groups of a sales nalog: the lines with the same document number. A group is a clean invoice when it has one
 * receivable debit on 120x, revenue credits on class 7 and output-VAT credits on 2300<rate>, all on one date, and WISE's
 * own invoice calculation (`calcLines`: base × rate rounded to cents per line) gives exactly the file's VAT and total.
 * Other groups stay journal lines (`rest`); groups that look like invoices but do not reproduce are listed in `refused`
 * (and stay journal lines too).
 */
export function jiInvoices(rows: readonly JiRow[]): { inv: JiInvoice[]; rest: JiRow[]; refused: JiInvoiceRefused[] } {
  const inv: JiInvoice[] = [], rest: JiRow[] = [], refused: JiInvoiceRefused[] = [];
  const G = new Map<string, JiRow[]>();
  for (const r of rows) {
    const k = jiDocOf(r);
    if (!k) { rest.push(r); continue; }
    G.set(k, [...(G.get(k) ?? []), r]);
  }
  const f = (c: number) => (c / 100).toFixed(2);
  for (const [no, R] of G) {
    const ar = R.filter((r) => /^120/.test(r.k));
    const rev = R.filter((r) => /^7/.test(r.k));
    const vat = R.filter((r) => jiVatRate(r.k) != null);
    const other = R.filter((r) => !ar.includes(r) && !rev.includes(r) && !vat.includes(r));
    const refuse = (why: string) => { refused.push({ no, rows: R.map((r) => r.r), why }); rest.push(...R); };
    // not an invoice at all (a payment, a correction): journal lines, without a message
    if (ar.length !== 1 || !rev.length) { rest.push(...R); continue; }
    const a = ar[0]!;
    if (other.length) { refuse(`има ставки и на ${[...new Set(other.map((r) => r.k))].join(', ')}`); continue; }
    if (new Set(R.map((r) => r.date)).size > 1) { refuse('ставките се со различни датуми'); continue; }
    if (!(a.d > 0) || a.p || rev.some((r) => r.d || !(r.p > 0)) || vat.some((r) => r.d || !(r.p > 0))) { refuse('не е излезна фактура (должи 120 / побарува 7 и 2300)'); continue; }
    const rates = [...new Set(vat.map((r) => jiVatRate(r.k)!))];
    if (rates.length > 1) { refuse('повеќе ДДВ стапки – приходите не може да се поврзат со стапката'); continue; }
    let rate = rates[0] ?? 0;
    // the old program books every rate on one VAT konto (5 % on 230018): when the konto's rate does not give the file's
    // VAT but exactly one other legal rate does (to the denar), that rate is the invoice's
    if (rate && vat.length) {
      const b0 = rev.reduce((s, r) => s + r.p, 0), v0 = vat.reduce((s, r) => s + r.p, 0);
      const fits = (x: number) => Math.abs(Math.round((b0 * x) / 100) - v0) < 100;
      const alt = JI_RATES.filter((x) => x !== rate && fits(x));
      if (!fits(rate) && alt.length === 1) rate = alt[0]!;
    }
    // without a VAT line: on 1200009 (the old program's konto of чл. 24 sales) → exempt with the right to deduct (08);
    // with a printed exemption note of a clear kind → that kind; else not guessed („провери“, stays journal lines)
    let ex: Pick<JiInvoice, 'vatExempt' | 'vatNote'> = {};
    if (!vat.length) {
      const vn = vatNoteOf(R.map((r) => r.desc).join('\n'));
      if (a.k === CUSTOMER_EXEMPT_KONTO) ex = { vatExempt: 'ded', vatNote: JI_EXEMPT_NOTE };
      else if (vn?.kind === 'exempt' && vn.exempt) ex = { vatExempt: vn.exempt, vatNote: vn.note };
      else { refuse(NO_VAT_NOTE_MSG); continue; }
    }
    const lines: JiInvoice['lines'] = rev.map((r) => ({ account: r.k, base: r.p, rate }));
    const C = calcLines(lines.map((l) => ({ qty: 1, price: l.base / 100, rate: l.rate, konto: l.account })));
    const base = rev.reduce((s, r) => s + r.p, 0), v = vat.reduce((s, r) => s + r.p, 0);
    const cV = Math.round(C.vat * 100), cT = Math.round(C.total * 100);
    if (base + v !== a.d) { refuse(`основа ${f(base)} + ДДВ ${f(v)} ≠ вкупно ${f(a.d)}`); continue; }
    if (cV === v && cT === a.d) { inv.push({ no, date: a.date, rows: R, ar: a, lines, base, vat: v, total: a.d, ...ex }); continue; }
    // the old program rounds the VAT to whole denars (legal in MK): a difference below 1.00 per rate is the file's VAT,
    // booked as the VAT of the first line of the rate; anything more is not this invoice
    const diff = v - cV;
    if (!rate || Math.abs(diff) >= 100) {
      refuse(`не се добива точно: во датотеката основа ${f(base)} + ДДВ ${f(v)} = ${f(a.d)}, WISE пресметува ДДВ ${f(cV)} (разлика ${f(diff)} – повеќе од заокружување)`);
      continue;
    }
    const v0 = Math.round(Math.round(lines[0]!.base * rate) / 100);
    lines[0] = { ...lines[0]!, vat: v0 + diff };
    inv.push({ no, date: a.date, rows: R, ar: a, lines, base, vat: v, total: a.d, vatRound: { rate, calc: cV, file: v } });
  }
  return { inv, rest, refused };
}

/* ------------------------------------------------------------------ the sheet → mapped rows (the screen and the tests) */

/** Header row: among the first 30 rows the one where the most journal columns are recognised (konto among them). */
export function jiHeaderRow(R: readonly (readonly unknown[])[]): number {
  let bi = 0, bs = -1;
  R.slice(0, 30).forEach((r, i) => {
    const m = impAuto('journal', r);
    const sc = Object.keys(m).length + (m.k != null ? 5 : 0);
    if (sc > bs) { bs = sc; bi = i; }
  });
  return bi;
}

export const JI_NUM: ReadonlySet<string> = new Set(['d', 'p', 'amt', 'curAmt', 'curD', 'curP']);

/**
 * The rows under the header as the importer's field → value rows (`r` = row number in the sheet): numbers by the
 * column's format (or the chosen „Децимали“), dates (Excel serials, `D.M.YYYY`, ISO) as `YYYY-MM-DD`.
 * `blocked` lists the amount columns that need the „Децимали“ choice.
 */
export function jiGridRows(R: readonly (readonly unknown[])[], hi: number, map: Readonly<Record<string, number>>, dec: DecMode = ''): { rows: JiIn[]; count: number; blocked: string[]; examples: string[] } {
  const data = R.slice(hi + 1).map((r, i) => ({ r, n: hi + 2 + i })).filter(({ r }) => r.some((c) => String(c ?? '').trim() !== ''));
  const NF = impNumFormats(data.map((x) => x.r), IMP_T.journal.f.filter(([k]) => JI_NUM.has(k)).map(([k, n]) => ({ key: k, label: n.replace('*', ''), idx: map[k] })));
  const decOf = (k: string): DecMode => dec || NF.dec[k] || '';
  const rows = data.map(({ r, n }) => ({
    r: n,
    ...Object.fromEntries(Object.entries(map).map(([k, i]) => {
      const v = r[i];
      if (JI_NUM.has(k)) return [k, String(v ?? '').trim() === '' ? null : impNum(v, decOf(k))];
      if (k === 'date') return [k, String(v ?? '').trim() === '' ? '' : impDate(v) || String(v)];
      return [k, typeof v === 'number' && k === 'k' ? v : String(v instanceof Date ? impDate(v) : v ?? '').trim()];
    })),
  }));
  return { rows, count: data.length, blocked: dec ? [] : NF.ambiguous, examples: NF.examples };
}
