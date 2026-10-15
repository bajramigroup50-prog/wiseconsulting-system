/**
 * Statement tables as the Macedonian banks print / export them (Excel, CSV, the text layer of a PDF, a PDF converted to
 * Excel) → one header per column + one row per transaction + the statement data from the header block. Shared by the
 * Excel / CSV import (`parseBankTable`), the PDF reader without AI (`noai/bank.ts`) and the converter (`convert`):
 *
 *  - header over 1–3 rows: wrapped text („Повикување на број (задолжување и“ / „одобрување)“), a parent heading with
 *    sub-headings („ИЗНОС“ over „задолжува | одобрува“), a sub-row under the name column („број на сметката“);
 *  - columns by role (date, name, account, purpose, reference, code, debit, credit, signed amount, balance, ordinal);
 *    a column whose heading names both directions („задолжува одобрува“ in one cell) holds both amounts, the second
 *    one may have slipped into the next cell („0.00 666“ under „Шифра“) and is split off;
 *  - a transaction over several rows (name line + account line, wrapped purpose, amounts printed a little below the
 *    text line) is merged into one;
 *  - repeated page headers, page footers („Страна 1 од 3“) and total rows are skipped;
 *  - statement number, date, account, currency, opening / closing balance and the debit / credit turnover from the
 *    rows above / below the table (label and value in one cell, in the next cell, or in the cell below the label).
 *    Rows without a date take the statement date („Извод бр. 12 од 05.03.2026“).
 */
import { parseBankDate, stripYearPrefix } from '../bank-parsers';

export type BankRole = 'date' | 'valDate' | 'name' | 'account' | 'purpose' | 'ref' | 'code' | 'debit' | 'credit' | 'amount' | 'balance' | 'seq' | 'fee';

export interface BankCol {
  /** Source column. */
  src: number;
  role: BankRole | null;
  /** Combined heading (all header rows). */
  header: string;
}

export interface BankMetaRaw {
  no: string;
  /** Statement date `YYYY-MM-DD` ('' = not printed). */
  date: string;
  account: string;
  currency: string;
  /** Amounts as printed (the number format is decided with the table). */
  opening: string | null;
  closing: string | null;
  debit: string | null;
  credit: string | null;
}

export interface BankItem {
  /** First source row (0-based index in the input grid). */
  row: number;
  /** Logical cells, aligned with `cols` (numbers from Excel stay numbers in the amount columns). */
  cells: (string | number)[];
  /** Raw cell values of the date / value-date columns (Date / Excel serial kept). */
  rawDate: unknown;
  rawValDate: unknown;
  /** Cells of the amount columns that are not amounts (reported with the row number). */
  errs: string[];
}

export interface BankPrep {
  /** First header row in the input and the number of header rows. */
  hi: number;
  hn: number;
  cols: BankCol[];
  items: BankItem[];
  meta: BankMetaRaw;
  /** Turnover from a total row of the table („Вкупно | 2.415,00 | 26.500,50“), as printed. */
  totals: { debit: string | null; credit: string | null };
}

const str = (v: unknown): string => (v instanceof Date ? '' : String(v ?? '')).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
/** Lower case; Latin look-alike letters inside Cyrillic words („задoлжува“ with a Latin o, „нa“) made Cyrillic. */
const HOMO: Record<string, string> = { a: 'а', o: 'о', e: 'е', c: 'с', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т' };
const low = (s: string) => s.toLowerCase().replace(/[\p{L}]+/gu, (w) => (/[а-яѓѕјљњќџ]/.test(w) ? w.replace(/[aoecpxykmt]/g, (ch) => HOMO[ch] ?? ch) : w));

// „ПБО/ПБЗ“ (Комерцијална: повикување на број одобрување / задолжување)
const R_REF = /повик|референц|reference|број на налог|бр\.? на налог|poziv|referenc|пбо|пбз|(^|[\s/])пнб([\s/]|$)/;
const R_BAL = /салдо|состојба|balance|bilanc|stanje/;
const R_BOOK = /книж|booking|обработ|knizenj/;
const R_VAL = /валута|вал\.|value date|valuta/;
const R_DATE = /датум|(^|\s)дат(\.|\s|$)|date|data|datum/;
const R_DEB = /задолж|должи|должув|одлив|исплат|на товар|debit|dalje|isplat|zadolz|dolzi/;
const R_CRED = /одобр|побар|прилив|уплат|во корист|в корист|credit|hyrje|uplat|odobr|pobar|priliv/;
const R_AMT = /износ|amount|shuma|iznos|vlera/;
const R_NAME = /налогодав|примач|партнер|partner|назив|name|корисник|комитент|nalogodav|primac|emri|klient/;
const R_ACC = /сметк|account|iban|racun|smetk|llogari/;
const R_PURP = /опис|цел|назн|desc|përsh|pershk|purpose|намена|детали|opis|svrha|qellim/;
const R_CODE = /шифр|(^|\s)шиф\.?($|\s)|основ|code|sifr|kod/;
/** Bank fee charged on the line, printed beside the amount („Износ … пров.“, „Провизија“): not a movement of the account. */
const R_FEE = /(^|\s)пров\.?($|\s)|провизиј|надомест|commission|(^|\s)fee($|\s)|provizij/;
const R_SEQ = /^(ред\.?\s*бр\.?|р\.?\s*бр\.?|рб\.?|р\.б\.?|бр\.|ред\.?|no\.?|nr\.?|#|r\.?\s*br\.?)$/;

/** Roles of a column from its (combined) heading; a heading with both directions gives [debit, credit] in its order. */
export function bankColRoles(h0: string): BankRole[] {
  const h = low(str(h0));
  if (!h) return [];
  // ordinal („Р. бр.“, „Р . бр на нал .“, „Ред. број“): never an amount
  if (R_SEQ.test(h) || /^(р\.?бр|ред\.?бр|реденброј|рб\.?$|р\.б\.?$|r\.?br)/.test(h.replace(/\s+/g, ''))) return ['seq'];
  if (R_REF.test(h)) return ['ref'];
  if (R_FEE.test(h) && !(R_DEB.test(h) || R_CRED.test(h))) return ['fee'];
  // the counterparty's bank („Депонент на (назив и седиште на банката)“): not the counterparty itself
  if (/депонент|седиште\s+н[аa]\s+банката|банка\s+на\s+(примач|налогодав)/.test(h)) return [];
  if (R_BAL.test(h) && !R_AMT.test(h)) return ['balance'];
  const d = h.search(R_DEB), c = h.search(R_CRED);
  if (d >= 0 && c >= 0) return d < c ? ['debit', 'credit'] : ['credit', 'debit'];
  if (d >= 0) return ['debit'];
  if (c >= 0) return ['credit'];
  if (R_AMT.test(h)) return ['amount'];
  if (R_BOOK.test(h)) return ['date'];
  if (R_VAL.test(h) && !/датум|date|datum/.test(h)) return ['valDate'];
  if (R_DATE.test(h)) return ['date'];
  const out: BankRole[] = [];
  if (R_NAME.test(h)) out.push('name');
  if (R_ACC.test(h)) out.push('account');
  if (out.length) return out;
  if (R_PURP.test(h)) return ['purpose'];
  if (R_CODE.test(h)) return ['code'];
  return [];
}

const MONEY = /^[-+]?\(?\d{1,3}(?:[.,' ]\d{3})*(?:[.,]\d{1,2})?\)?-?$|^[-+]?\(?\d+(?:[.,]\d{1,2})?\)?-?$/;
const MONEY_DEC = /^[-+]?\(?(?:\d{1,3}(?:[.,']\d{3})+|\d+)[.,]\d{2}\)?-?$/;
const DATE_TXT = /(?<!\d)\d{1,2}[./-]\d{1,2}[./-](\d{4}|\d{2})(?!\d)|\d{4}-\d{2}-\d{2}/;
/** A value that is an amount (with decimals) — used to tell data rows from header rows. */
const isMoneyCell = (v: unknown) => typeof v === 'number' ? true : MONEY_DEC.test(str(v));
const isDateCell = (v: unknown) => v instanceof Date || (typeof v === 'number' && v > 30000 && v < 70000) || DATE_TXT.test(str(v));

/** A transaction-table header row: an amount column and at least one other column, all cells text. */
export function isBankHeaderRow(cells: readonly unknown[]): boolean {
  const S = cells.map(str).filter(Boolean);
  if (S.length < 2) return false;
  if (cells.some((c) => isDateCell(c) || isMoneyCell(c))) return false;
  if (S.some((s) => /^(вкупно|збир|total)/i.test(s))) return false;
  const roles = new Set(S.flatMap(bankColRoles));
  const amt = roles.has('debit') || roles.has('credit') || roles.has('amount');
  const other = ['date', 'valDate', 'name', 'purpose', 'ref', 'code', 'account'].some((r) => roles.has(r as BankRole));
  return amt && other;
}

const HDR_WORD = /дат|валут|износ|задолж|одобр|должи|побар|прилив|одлив|сметк|број|бр\.|шифр|цел|назив|налог|примач|корист|товар|повик|рефер|опис|салдо|ред|седиште|банка|основ|date|amount|debit|credit|account|ref|desc|name|code|iban|partner/i;

/** A row under the header that continues it (sub-headings, wrapped heading text). */
export function isHeaderContinuation(row: readonly unknown[], above: readonly unknown[]): boolean {
  const S = row.map(str);
  if (!S.some(Boolean)) return false;
  if (row.some((c) => isDateCell(c) || isMoneyCell(c) || typeof c === 'number')) return false;
  if (S.some((s) => /\d{5,}/.test(s.replace(/[-\s]/g, '')))) return false;
  if (S.some((s) => HDR_WORD.test(s))) return true;
  // wrapped heading: the cell above ends unfinished („(задолжување и“, „-“, „,“)
  return S.some((s, i) => s && /(\([^)]*|[-,/]|\sи)$/.test(str(above[i])));
}

/** Header rows → one heading per column. */
function combineHeader(H: readonly (readonly unknown[])[]): string[] {
  const w = Math.max(...H.map((r) => r.length));
  return Array.from({ length: w }, (_, c) => H.map((r) => str(r[c])).filter(Boolean).join(' '));
}

const TOTAL = /^(вкупно|вкупен промет|збир|промет (должи|побарува|задолж|одобр)|пренос (од|на) |ново салдо|нова состојба|крајна состојба|завршна состојба|салдо на крај|претходна состојба|почетна состојба|total|gjithsej|ukupno)/i;
// a bare „2 / 3“ is a page number; „0310/2026“ (a reference wrapped onto its own line) is not
const FOOTER = /^(страна|стр\.|page|faqe)\s*:?\s*\d+(\s*(од|\/|of|nga)\s*\d+)?$|^\d{1,3}\s*(\/|од|of)\s*\d{1,3}$/i;
const ACC_RE = /(?<![\d])(?:MK\s?\d{2}\s?)?(\d{3})[-\s]?(\d{10})[-\s]?(\d{2})(?!\d)/;

/** Leading amounts of a text („1.500,00 0,00 666“ → [„1.500,00“, „0,00“], rest „666“). */
function leadMoney(s: string, max: number, needDec: boolean): { vals: string[]; rest: string } {
  const T = s.split(' ').filter(Boolean);
  const vals: string[] = [];
  while (vals.length < max && T.length && (needDec ? MONEY_DEC : MONEY).test(T[0]!)) vals.push(T.shift()!);
  return { vals, rest: T.join(' ') };
}

/**
 * Find and normalise the statement table of a grid. `hi` forces the first header row (converter „Наслови во ред“).
 * Null when no header with an amount column is found.
 */
export function prepBankGrid(rows: readonly (readonly unknown[])[], hi0?: number): BankPrep | null {
  let hi = hi0 ?? -1;
  if (hi < 0) for (let i = 0; i < Math.min(rows.length, 60); i++) if (isBankHeaderRow(rows[i] ?? [])) { hi = i; break; }
  if (hi < 0 || hi >= rows.length) return null;
  let hn = 1;
  while (hn < 4 && hi + hn < rows.length && isHeaderContinuation(rows[hi + hn] ?? [], rows[hi + hn - 1] ?? [])) hn++;
  const H = rows.slice(hi, hi + hn);
  const heads = combineHeader(H);
  // columns by role; a column with both directions or name + account is split into two logical columns
  const cols: BankCol[] = [];
  heads.forEach((h, c) => {
    const R = bankColRoles(h);
    if (!R.length) cols.push({ src: c, role: null, header: h });
    for (const r of R) cols.push({ src: c, role: r, header: R.length > 1 ? `${h} (${ROLE_MK[r]})` : h });
  });
  // a heading without a known role but data under it stays (shown in the converter); several date columns: booking first
  if (!cols.some((c) => c.role === 'date')) { const v = cols.find((c) => c.role === 'valDate'); if (v) v.role = 'date'; }
  const roleIdx = (r: BankRole) => {
    if (r === 'date') { const b = cols.findIndex((c) => c.role === 'date' && R_BOOK.test(low(c.header))); if (b >= 0) return b; }
    return cols.findIndex((c) => c.role === r);
  };
  // FIX: a column whose values are the row numbers 1, 2, 3 … is the ordinal, whatever its heading says
  for (const c of cols) {
    if (c.role !== 'amount' && c.role !== 'credit' && c.role !== 'debit') continue;
    if (cols.filter((d) => d.src === c.src).length > 1) continue;
    const all = rows.slice(hi + hn).map((r) => r?.[c.src]).map((v) => (typeof v === 'number' ? String(v) : str(v))).filter(Boolean);
    const N = all.filter((v) => /^\d{1,4}\.?$/.test(v)).map((v) => parseInt(v, 10));
    // 1, 2, 3 … (a new page may start again from its own number); the money values of an amount column are not like this
    if (N.length >= 2 && N[0] === 1 && N.length >= all.length * 0.8 && N.every((n, i) => i === 0 || n === N[i - 1]! + 1)) c.role = 'seq';
  }
  const hdrSigs = new Set(H.map((r) => r.map(str).join('|').toLowerCase()));
  const items: BankItem[] = [];
  const meta = metaOf(rows, hi);
  const totals: BankPrep['totals'] = { debit: null, credit: null };
  const dual = new Set(cols.filter((c, i) => cols.some((d, j) => j !== i && d.src === c.src && (d.role === 'debit' || d.role === 'credit')) && (c.role === 'debit' || c.role === 'credit')).map((c) => c.src));
  const iDate = roleIdx('date'), iVal = roleIdx('valDate'), iSeq = roleIdx('seq');
  const amtCols = cols.map((c, i) => (c.role === 'debit' || c.role === 'credit' || c.role === 'amount' ? i : -1)).filter((i) => i >= 0);
  let stopped = false;
  for (let r = hi + hn; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const S = row.map(str);
    if (!S.some(Boolean) && !row.some((v) => v instanceof Date)) continue;
    const sig = S.join('|').toLowerCase();
    if (hdrSigs.has(sig) || isBankHeaderRow(row)) { stopped = false; continue; }
    const joined = S.filter(Boolean).join(' ');
    if (FOOTER.test(joined) || /страна\s*\d+\s*(од|\/)\s*\d+/i.test(joined)) continue;
    const firstTxt = S.filter(Boolean).slice(0, 3);
    const hasDate = (iDate >= 0 && !!parseBankDate(row[cols[iDate]!.src])) || (iVal >= 0 && !!parseBankDate(row[cols[iVal]!.src]));
    // a total row („Вкупно“, „Нова состојба“ …) — not a wrapped purpose / name that happens to start with such a word
    const tk = S.findIndex((s) => s && TOTAL.test(s));
    const tRole = tk >= 0 ? cols.find((c) => c.src === tk)?.role : null;
    const isTotal = !hasDate && tk >= 0 && firstTxt.includes(S[tk]!) && (!(tRole === 'purpose' || tRole === 'name') || row.some((v) => isMoneyCell(v)) || (balanceLabels(S[tk]!).length > 0 && /\d/.test(S[tk]!)));
    if (isTotal) {
      stopped = true;
      // the table's own total row: turnover per direction
      for (const i of amtCols) {
        const v = S[cols[i]!.src];
        if (!v) continue;
        if (dual.has(cols[i]!.src)) {
          // „38,779.00 0.00“ under „ИЗНОС задолжува | одобрува“: the amounts in the order of the sub-headings
          const D = cols.filter((c) => c.src === cols[i]!.src);
          const k = D.indexOf(cols[i]!);
          const m = leadMoney(v.replace(/^[^\d-]*/, ''), D.length, false).vals[k];
          if (m == null) continue;
          if (cols[i]!.role === 'debit' && totals.debit == null) totals.debit = m;
          if (cols[i]!.role === 'credit' && totals.credit == null) totals.credit = m;
          continue;
        }
        const m = leadMoney(v.replace(/^[^\d-]*/, ''), 1, false).vals[0] ?? v;
        if (cols[i]!.role === 'debit' && totals.debit == null) totals.debit = m;
        if (cols[i]!.role === 'credit' && totals.credit == null) totals.credit = m;
      }
      continue;
    }
    if (stopped) continue;
    // logical cells
    const cur = S.slice();
    const cells: (string | number)[] = cols.map(() => '');
    const errs: string[] = [];
    const done = new Set<number>();
    cols.forEach((c, i) => {
      if (done.has(i)) return;
      const same = cols.map((d, j) => (d.src === c.src ? j : -1)).filter((j) => j >= 0);
      same.forEach((j) => done.add(j));
      const raw = row[c.src];
      if (typeof raw === 'number' && same.length === 1) { cells[i] = c.role === 'debit' || c.role === 'credit' || c.role === 'amount' ? raw : String(raw); cur[c.src] = ''; return; }
      const txt = cur[c.src] ?? '';
      const mRoles = same.filter((j) => ['debit', 'credit', 'amount'].includes(cols[j]!.role ?? ''));
      if (mRoles.length) {
        const { vals, rest } = leadMoney(txt, mRoles.length, false);
        // the second amount of a two-direction column slipped into the next cell („0.00 666“)
        if (mRoles.length > 1 && vals.length === 1) {
          const nx = cur[c.src + 1] ?? '';
          const m = leadMoney(nx, 1, true);
          if (m.vals.length) { vals.push(m.vals[0]!); cur[c.src + 1] = m.rest; }
        }
        vals.forEach((v, k) => { cells[mRoles[k]!] = v; });
        const tRoles = same.filter((j) => !mRoles.includes(j));
        if (tRoles.length && rest) cells[tRoles[0]!] = rest;
        else if (!vals.length && rest && /\d/.test(rest) && !/^[-–—/]+$/.test(rest)) errs.push(`колона „${c.header}“: „${rest}“ не е износ`);
        cur[c.src] = '';
        return;
      }
      const nameJ = same.find((j) => cols[j]!.role === 'name'), accJ = same.find((j) => cols[j]!.role === 'account');
      if (nameJ != null && accJ != null) {
        const m = ACC_RE.exec(txt);
        if (m) { cells[accJ] = m[1]! + m[2]! + m[3]!; cells[nameJ] = str(txt.replace(m[0], ' ')); }
        else cells[nameJ] = txt;
      } else if (c.role === 'account') {
        const m = ACC_RE.exec(txt);
        cells[i] = m ? str(m[1]! + m[2]! + m[3]! + ' ' + txt.replace(m[0], ' ')) : txt;
      } else cells[same[0]!] = txt;
      cur[c.src] = '';
    });
    // account numbers on a line of the name column (no account column)
    const iName = roleIdx('name');
    if (iName >= 0 && roleIdx('account') < 0) {
      const nm = String(cells[iName]);
      const m = ACC_RE.exec(nm);
      if (m) cells[iName] = str(nm.replace(m[0], ' '));
    }
    const hasAmt = amtCols.some((i) => cells[i] !== '') || errs.length > 0;
    const seqStart = iSeq >= 0 && /^\d{1,5}\.?$/.test(String(cells[iSeq]));
    const prev = items[items.length - 1];
    const rec: BankItem = { row: r, cells, rawDate: iDate >= 0 ? row[cols[iDate]!.src] : undefined, rawValDate: iVal >= 0 ? row[cols[iVal]!.src] : undefined, errs };
    const prevHasAmt = !!prev && amtCols.some((i) => prev.cells[i] !== '');
    const prevHasDate = !!prev && iDate >= 0 && !!parseBankDate(prev.rawDate);
    const conflict = (a: BankItem, b: BankItem) => b.cells.some((v, i) => v && a.cells[i] && cols[i]!.role !== 'purpose' && cols[i]!.role !== 'name' && cols[i]!.role !== null);
    if (hasDate || hasAmt || seqStart) {
      // a row that only completes the previous item (amounts printed below the text line, or the date line after it)
      const completes = prev && !seqStart && !conflict(prev, rec) && (
        (hasAmt && !prevHasAmt && !(hasDate && prevHasDate)) || (hasDate && !prevHasDate && iDate >= 0 && prevHasAmt && !hasAmt));
      if (completes) { mergeInto(prev!, rec, cols); continue; }
      items.push(rec);
    } else if (prev) {
      mergeInto(prev, rec, cols);
    }
  }
  return { hi, hn, cols, items, meta, totals };
}

const ROLE_MK: Record<BankRole, string> = {
  date: 'датум', valDate: 'валута', name: 'назив', account: 'сметка', purpose: 'цел', ref: 'повикување на број', code: 'шифра',
  debit: 'задолжување', credit: 'одобрување', amount: 'износ', balance: 'салдо', seq: 'ред. бр.', fee: 'провизија',
};

/** Append a continuation row to an item (text joined, empty cells filled). */
function mergeInto(a: BankItem, b: BankItem, cols: readonly BankCol[]): void {
  b.cells.forEach((v, i) => {
    if (!v) return;
    const role = cols[i]!.role;
    if (a.cells[i] === '') a.cells[i] = v;
    else if (role === 'name' || role === 'purpose' || role === 'ref' || role === null) a.cells[i] = String(a.cells[i]) + ' ' + String(v);
  });
  a.errs.push(...b.errs);
  if (a.rawDate == null || !parseBankDate(a.rawDate)) a.rawDate = b.rawDate ?? a.rawDate;
  if (a.rawValDate == null || !parseBankDate(a.rawValDate)) a.rawValDate = b.rawValDate ?? a.rawValDate;
}

/* ------------------------------------------------------------------ statement data from the header block */

const L_OPEN = /(претходна|почетна)\s+состојба|претходно\s+салдо|почетно\s+салдо|салдо\s+на\s+почет|состојба\s+на\s+почет|opening\s+balance|prethodno\s+stanje|претходна\s+состојба/i;
const L_CLOSE = /(нова|крајна|завршна)\s+состојба|ново\s+салдо|крајно\s+салдо|салдо\s+на\s+крај|состојба\s+на\s+крај|closing\s+balance|novo\s+stanje/i;
const L_DEB = /вкупно\s+(задолжување|задолжено|должи|одлив|исплати)|вкупен\s+промет\s+(должи|задолж)|промет\s+(должи|долгува|задолж)|вкупно\s+на\s+товар|dugovni\s+promet|total\s+debit/i;
const L_CRED = /вкупно\s+(одобрување|одобрено|побарува|прилив|уплати)|вкупен\s+промет\s+(побарува|одобр)|промет\s+(побарува|одобр)|вкупно\s+во\s+корист|potrazni\s+promet|total\s+credit/i;
const NUM_AFTER = /-?\(?\d[\d.,' ]*\d\)?-?|-?\d/;

/** All balance / turnover labels of a text with their positions („Претходна состојба“, „Вкупно задолжување“ …). */
export function balanceLabels(t: string): { at: number; end: number }[] {
  const out: { at: number; end: number }[] = [];
  for (const re of [L_OPEN, L_CLOSE, L_DEB, L_CRED]) {
    const g = new RegExp(re.source, 'gi');
    for (const m of t.matchAll(g)) out.push({ at: m.index!, end: m.index! + m[0].length });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Statement data from the rows outside the table (above it, and the trailer). */
function metaOf(rows: readonly (readonly unknown[])[], hi: number): BankMetaRaw {
  const m: BankMetaRaw = { no: '', date: '', account: '', currency: '', opening: null, closing: null, debit: null, credit: null };
  const pre = rows.slice(0, hi);
  const all = rows.map((r) => (r ?? []).map(str));
  const numAt = (s: string): string | null => {
    const x = NUM_AFTER.exec(s.replace(/\s+(ден\.?|мкд|mkd|eur|usd)\b.*$/i, ''));
    return x ? x[0].trim() : null;
  };
  /** Value of a label: rest of the cell, the next cells of the row, or the cell below. */
  const valueOf = (re: RegExp, rowsIdx: number[], kind: 'num' | 'any'): string | null => {
    for (const r of rowsIdx) {
      const R = all[r] ?? [];
      for (let i = 0; i < R.length; i++) {
        const lm = re.exec(R[i]!);
        if (!lm) continue;
        const rest = R[i]!.slice(lm.index + lm[0].length);
        const v = kind === 'num' ? numAt(rest.replace(/^[^\d-(]*/, '')) : rest.replace(/^[\s:.-]+/, '');
        if (v && (kind === 'any' || /\d/.test(v))) return v;
        const isLabel = (t: string) => L_OPEN.test(t) || L_CLOSE.test(t) || L_DEB.test(t) || L_CRED.test(t);
        let nextLabel = R.length;
        for (let j = i + 1; j < R.length; j++) {
          if (!R[j]) continue;
          if (isLabel(R[j]!)) { nextLabel = j; break; }
          const w = kind === 'num' ? numAt(R[j]!) : R[j]!;
          if (w && (kind === 'any' || isMoneyCell(R[j]) || /^-?[\d.,' ()]+$/.test(R[j]!))) return w;
          break;
        }
        // labels in one row, values in the row below („Претходна состојба | Вкупно задолжување …“ over the amounts):
        // the value under the label, or (values printed right-aligned) the next one before the following label
        const B = all[r + 1] ?? [];
        const numCell = (t: string | undefined) => !!t && /^-?\(?[\d.,' ]+\)?-?$/.test(t) && /\d/.test(t);
        if (kind === 'num' && B.some(Boolean) && B.every((t) => !t || numCell(t))) {
          for (let j = i; j < Math.max(nextLabel, i + 1); j++) if (numCell(B[j])) return numAt(B[j]!);
        } else if (kind === 'any' && B[i]) return B[i]!;
      }
    }
    return null;
  };
  const idx = (A: readonly unknown[][] | readonly (readonly unknown[])[], from = 0) => A.map((_, i) => i + from);
  const outside = [...idx(pre), ...idx(rows.slice(hi), hi)];
  m.opening = valueOf(L_OPEN, outside, 'num');
  m.closing = valueOf(L_CLOSE, outside, 'num');
  m.debit = valueOf(L_DEB, outside, 'num');
  m.credit = valueOf(L_CRED, outside, 'num');
  const preTxt = pre.map((r) => (r ?? []).map(str).filter(Boolean).join(' '));
  // statement number: legacy patterns first („бр. 2026048/2026“), then „Извод бр. 12“ / „Број на извод: 12“
  for (const t of preTxt) {
    const x = t.match(/бр(?:ој)?\.?\s*(?:на извод)?\s*[:.]?\s*0*(\d{1,8})\s*\/\s*20\d\d/i) || t.match(/извод[^0-9]{0,20}(\d{1,8})/i) || t.match(/број\s+на\s+извод\s*[:.]?\s*(\d{1,8})/i) || t.match(/statement\s*(?:no\.?|nr\.?|number)?\s*[:.]?\s*(\d{1,8})/i);
    if (x) { m.no = stripYearPrefix(x[1]!); break; }
  }
  // statement date: labelled, „Извод … од dd.mm.yyyy“, the end of a period, or the only date above the table
  const dates = (s: string) => [...s.matchAll(/(?<!\d)(\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2}))(?!\d)|(\d{4}-\d{2}-\d{2})/g)].map((x) => x[0]);
  const iso = (s: string) => parseBankDate(s.replace(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/, (_, d, mo, y) => `${d}.${mo}.20${y}`));
  // FIX: a labelled statement date („за ден 07.10.2026“) before a bare „Датум: 15.10.2026“ (the print date above it)
  for (const strong of [true, false]) {
    if (m.date) break;
    for (const t of preTxt) {
      if (/печат|отпечат|print|креиран|изработ/i.test(t) && !/извод/i.test(t)) continue;
      const lab = (strong ? /(датум\s+на\s+извод|датум\s+на\s+изводот|извод.*?\sод\s|на\s+ден|состојба\s+на\s+ден|за\s+ден|датум\s+на\s+(обработка|книжење|промет)|statement\s+date)/i : /датум\s*:/i).exec(t);
      if (lab) { const d = dates(t.slice(lab.index)); if (d.length) { m.date = iso(d[0]!); break; } }
    }
  }
  if (!m.date) for (const t of preTxt) {
    const p = /(?:период|period|од)\s*:?\s*(\S+)\s*(?:до|-|–|to)\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(t);
    if (p && dates(p[1]!).length) { m.date = iso(p[2]!); break; }
  }
  if (!m.date) {
    const D = [...new Set(preTxt.filter((t) => !/печат|print|креиран/i.test(t)).flatMap(dates).map(iso).filter(Boolean))];
    if (D.length === 1) m.date = D[0]!;
  }
  // account: labelled first, else the first account number above the table
  for (const t of preTxt) if (/сметк|партија|account|iban|жиро|racun/i.test(t)) { const a = ACC_RE.exec(t); if (a) { m.account = a[1]! + a[2]! + a[3]!; break; } }
  if (!m.account) for (const t of preTxt) { const a = ACC_RE.exec(t); if (a) { m.account = a[1]! + a[2]! + a[3]!; break; } }
  m.currency = /\b(EUR|USD|CHF|GBP|MKD)\b/.exec(preTxt.join(' '))?.[1] ?? (/денар|ден\./i.test(preTxt.join(' ')) ? 'MKD' : '');
  return m;
}

/** Logical cell of an item by role ('' when the table has no such column); several columns of a role are joined. */
export function itemCell(p: Pick<BankPrep, 'cols'>, it: BankItem, role: BankRole, sep = ' · '): string {
  return p.cols.map((c, i) => (c.role === role ? String(it.cells[i]) : '')).filter((x, i, A) => x && A.indexOf(x) === i).join(sep);
}

/** Human description of what was found (for errors and the converter). */
export function bankPrepSummary(p: BankPrep): string {
  const R = (r: BankRole) => p.cols.find((c) => c.role === r)?.header;
  const parts = [
    R('date') ? `датум: „${R('date')}“` : p.meta.date ? `датум од заглавјето (${p.meta.date.split('-').reverse().join('.')})` : 'нема колона за датум',
    R('amount') ? `износ: „${R('amount')}“` : '',
    R('debit') ? `одлив: „${R('debit')}“` : '', R('credit') ? `прилив: „${R('credit')}“` : '',
  ].filter(Boolean);
  return `наслов во ред ${p.hi + 1}${p.hn > 1 ? `–${p.hi + p.hn}` : ''}; ${parts.join(', ')}`;
}
