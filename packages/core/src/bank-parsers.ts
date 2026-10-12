/**
 * Bank statement parsers (Phase 4) — pure ports of the final legacy parsers.
 *
 * Legacy sources (`legacy/index.html`, see docs/LEGACY-MAP.md §Phase 4):
 * - MT940: `parseMT940` 4763 → 12558 → 12593 → **12720** (whole chain)
 * - XML: `xNum` 12605, `xDate` 12606, **`parseBankXml` 12607** (Halk `RacunPrivredaIzvod` + ISO 20022 camt.053)
 * - Komercijalna KBFileFormat (.300): `KB_RE` 12669, **`parseKB` 12670**
 * - Excel/CSV tables: `parseAmount` 4745, `parseDate` 4746, `findHeader` 4747, `importRows` **4748** (parse part only)
 * - File dispatch: `importBankFile` 4784 → 12641 → 12677 → **12889**
 *
 * Every amount is integer cents (deni), signed: + = inflow (прилив), − = outflow (одлив).
 * Inputs may be raw bytes (UTF-8 or cp1251, decoded here) or text.
 *
 * Deliberate fixes (LEGACY-MAP Phase 4 §4.4 and found while porting) are marked `FIX:`.
 */
import { decodeBankBytes } from './bank/text';
import { byLocalInDoc, byTagInDoc, descendants, parseXml, textOf, type XmlElement } from './bank/xml';
import { toCents } from './bank/cents';
import { r2 } from './money';
import { AmbiguousAmountsError, ambExamples, colFormat, parseNumAuto, reconcileFmt, type NumFmt } from './numfmt';
import { itemCell, prepBankGrid, type BankItem, type BankRole } from './bank/table';

export { decodeBankBytes, decodeCp1251, detectEncoding, isUtf8 } from './bank/text';

export type StatementFormat = 'mt940' | 'halk-xml' | 'camt.053' | 'kb' | 'table' | 'ai';

export interface StatementLine {
  /** Booking date `YYYY-MM-DD`. */
  date: string;
  /** Value date when the format gives one. */
  valDate?: string;
  /** Signed cents in the statement currency (+ inflow). */
  amount: number;
  /** Signed denar counter-value in cents when the bank printed one (Halk `DinarskaProtivvrednost`, KB MKD column). */
  amountMkd?: number;
  /** Counterparty name (налогодавач / корисник); '' when the bank did not give one. */
  counterparty: string;
  /** Counterparty account / IBAN. */
  iban?: string;
  /** Bank / payment reference. */
  ref: string;
  /** Purpose of payment (цел на дознака). */
  purpose: string;
  /** Description exactly as legacy built it (shown in the bank screen, used by matching). */
  desc: string;
  /** Payment basis code (шифра на основ / ISO purpose code). */
  osnov?: string;
  /** Our order number (Halk `VasBrojNaloga`). */
  nalog?: string;
  /** Gross incoming amount (cents) when a foreign bank deducted fees (Halk `NominalniIznosPriliva`). */
  nominal?: number;
  /** Bank fees in cents (Halk `Provizija + ProvizijaInoBanke + InoTrosak`). */
  fee?: number;
  /** Statement number printed on this line (KBFileFormat). */
  stmtNo?: string;
}

export interface Statement {
  format: StatementFormat;
  /** Statement owner's account number as given in the file (`:25:`, `Partija`, `Acct/Id/Othr`, KB account). */
  account: string;
  iban?: string;
  owner?: string;
  /** Statement number ('' when the file has none). */
  no: string;
  /** Statement date (stated, else the latest line date). */
  date: string;
  currency: string;
  /** Opening / closing balance in cents (null = not in the file). */
  opening: number | null;
  closing: number | null;
  /** Debit / credit turnover in cents (null = not stated). */
  debit: number | null;
  credit: number | null;
  /** Exchange rate to MKD printed on the statement (AI read, legacy `izvRate` from `r.rate` 4802). */
  rate?: number;
  lines: StatementLine[];
}

const lastDate = (lines: StatementLine[]): string => lines.map((l) => l.date).filter(Boolean).sort().pop() || '';

/** Statement numbers like `2026105` mean year 2026, statement 105 (legacy 12558 / 4759 / 4804). */
export const stripYearPrefix = (n: string): string => (/^20\d{2}\d+$/.test(n) && n.length > 4 ? String(+n.slice(4)) : n);

/* ------------------------------------------------------------------ MT940 */

/**
 * SWIFT MT940 (`.sta/.940/.mt940/.swi`, or `.txt/.csv` containing `:61:`).
 *
 * FIX (LEGACY-MAP 4.4 #1): legacy 12558 took `:60F:/:62F:` from the *whole file*, so every
 * statement in a multi-statement file got the first statement's balances; here each `:20:` block
 * uses its own balances. Legacy 12720 mapped `:86:` names to items by a running index over all
 * `:61:` chunks (drifts when a `:61:` is skipped); here each item takes the `:86:` that follows it.
 * Legacy 12720 also only read the *first line* of `:86:` (a `$` in multiline mode ended the
 * match), so `?32` names on later lines were lost; here the whole field is used.
 * Legacy 12724 re-saved names keyed by `date|amount` (ambiguous) — unnecessary, names are on the lines.
 */
export function parseMT940(input: Uint8Array | string): Statement[] {
  const txt = decodeBankBytes(input).replace(/\r/g, '');
  const out: Statement[] = [];
  const blocks = txt.split(/(?=^:20:)/m).filter((b) => /:61:/.test(b));
  for (const b of blocks) {
    const m28 = b.match(/^:28C?:\s*0*(\d+)/m);
    const m60c = b.match(/^:60[FM]:[CD]\d{6}([A-Z]{3})/m);
    const m25 = b.match(/^:25:(.+)$/m);
    const bal = (tag: string): number | null => {
      const m = b.match(new RegExp('^:' + tag + '[FM]:([CD])\\d{6}[A-Z]{3}([\\d,]+)', 'm'));
      return m ? toCents((m[1] === 'D' ? -1 : 1) * parseFloat(m[2]!.replace(',', '.'))) : null;
    };
    const st: Statement = {
      format: 'mt940',
      account: m25 ? m25[1]!.trim() : '',
      no: stripYearPrefix(m28 ? m28[1]! : ''),
      date: '',
      currency: m60c ? m60c[1]! : '',
      opening: bal('60'),
      closing: bal('62'),
      debit: 0,
      credit: 0,
      lines: [],
    };
    const fields = b.split(/\n(?=:\d{2}[A-Z]?:)/);
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      if (!f.startsWith(':61:')) continue;
      const m = f.slice(4).match(/^(\d{2})(\d{2})(\d{2})(\d{4})?(R?[DC])[A-Z]?(\d+,\d*)/);
      if (!m) continue;
      const date = '20' + m[1] + '-' + m[2] + '-' + m[3];
      let amt = parseFloat(m[6]!.replace(',', '.'));
      const dc = m[5];
      if (dc === 'D' || dc === 'RC') amt = -amt;
      const supp = f.split('\n').slice(1).join(' ').trim();
      const nx = fields[i + 1];
      const has86 = !!nx && nx.startsWith(':86:');
      const det = has86 ? nx.slice(4).replace(/\n/g, ' ').replace(/\?\d{2}/g, ' ').replace(/\s+/g, ' ').trim() : '';
      let desc = (det || supp || f.slice(4)).slice(0, 300);
      // 12558: a bare `:61:` line as description → "Налог бр. <ref>" / "Пренос"
      const dm = desc.match(/^\d{6}(?:\d{4})?R?[DC][A-Z]?\d+,\d*(?:N|F|S)?([A-Z]{3})?(.*)$/);
      if (dm) {
        const ref = (dm[2] || '').replace(/^\/\//, '').trim();
        desc = ref ? 'Налог бр. ' + ref : 'Пренос';
      }
      // 12720: name from ?32/?33 or /NAME/ /ORDP/ /BENM/ /NM/; purpose from ?2x or /REMI/
      let name = '';
      let pur = '';
      let iban: string | undefined;
      if (has86) {
        const raw = nx.slice(4).replace(/\n/g, '');
        const sf = [...raw.matchAll(/\?(3[23])([^?]*)/g)].map((x) => x[2]).join(' ').trim();
        if (sf) name = sf;
        const tg = raw.match(/\/(?:NAME|ORDP|BENM|NM)\/+([^/]+)/i);
        if (!name && tg) name = tg[1]!.trim();
        pur = [...raw.matchAll(/\?(2\d)([^?]*)/g)].map((x) => x[2]).join('').trim() || (raw.match(/\/REMI\/+([^/]+)/i) || [])[1] || '';
        const acc = raw.match(/\?31([^?]*)/);
        if (acc && acc[1]!.trim()) iban = acc[1]!.trim();
        if (name) desc = name + (pur ? ' – ' + pur : '');
      }
      // reference from the :61: line: after amount and the 4-char transaction type
      const after = f.slice(4).split('\n')[0]!.slice(m[0].length).replace(/^[NFS][A-Z0-9]{3}/, '');
      const [cust = '', bank = ''] = after.split('//');
      const ref = (cust && cust.toUpperCase() !== 'NONREF' ? cust : bank).trim();
      const cents = toCents(amt);
      st.lines.push({
        date,
        amount: cents,
        counterparty: name,
        ...(iban ? { iban } : {}),
        ref,
        purpose: pur || det,
        desc,
      });
      if (cents < 0) st.debit! += -cents;
      else st.credit! += cents;
    }
    st.date = lastDate(st.lines);
    if (st.lines.length) out.push(st);
  }
  return out;
}

/* ------------------------------------------------------------------ XML */

/** Legacy `xNum` (12605): "1.234,56" / "1,234.56" / "1234.56" → denars (r2). */
export function xNum(v: unknown): number {
  let s = String(v ?? '').trim();
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  return r2(parseFloat(s.replace(/[^\d.\-]/g, '')) || 0);
}

/** Legacy `xDate` (12606): `dd.mm.yyyy` or ISO → `YYYY-MM-DD`. */
export function xDate(v: unknown): string {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

/** Path of direct children by local name (legacy `T`). */
function T(el: XmlElement | undefined, path: string): string {
  let x: XmlElement | undefined = el;
  for (const p of path.split('/')) {
    if (!x) return '';
    x = x.children.find((c) => c.local === p);
  }
  return x ? textOf(x).trim() : '';
}

/** `el.getElementsByTagNameNS('*', local)` (legacy `all`). */
const allLocal = (el: XmlElement, local: string) => descendants(el, (e) => e.local === local);

/**
 * Bank XML statements: Halk Banka `RacunPrivredaIzvod` (and banks on the same software) and ISO 20022
 * camt.053. Returns `null` when the XML is not well-formed, `[]` when it holds no statement.
 */
export function parseBankXml(input: Uint8Array | string): Statement[] | null {
  const root = parseXml(decodeBankBytes(input));
  if (!root) return null;
  const out: Statement[] = [];

  /* 1) RacunPrivredaIzvod (Halk) */
  for (const rootEl of byTagInDoc(root, 'RacunPrivredaIzvod')) {
    const H = byTagInDoc(rootEl, 'Zaglavlje').filter((e) => e !== rootEl)[0];
    if (!H) continue;
    const a = (k: string) => H.attrs[k] || '';
    const items: StatementLine[] = [];
    for (const it of byTagInDoc(rootEl, 'Stavke').filter((e) => e !== rootEl)) {
      const g = (k: string) => (it.attrs[k] || '').trim();
      const dug = xNum(g('Duguje'));
      const pot = xNum(g('Potrazuje'));
      if (!dug && !pot) continue;
      const amt = r2(pot - dug);
      const name = g('NalogKorisnik');
      const purpose = [g('Opis'), g('Napomena'), g('TekstOsnova')].filter(Boolean).filter((x, i, A) => A.indexOf(x) === i).join(' – ');
      const mkd = xNum(g('DinarskaProtivvrednost'));
      const nom = Math.abs(xNum(g('NominalniIznosPriliva')));
      const fee = r2(xNum(g('Provizija')) + xNum(g('ProvizijaInoBanke')) + xNum(g('InoTrosak')));
      const valDate = xDate(g('DatumValute'));
      const cp = g('RacunNalogodavacKorisnik');
      const osnov = g('OsnovPlacanja');
      const nalog = g('VasBrojNaloga');
      items.push({
        date: xDate(g('DatumObrade')) || valDate || xDate(a('DatumIzvoda')),
        ...(valDate ? { valDate } : {}),
        amount: toCents(amt),
        amountMkd: mkd ? toCents(Math.sign(amt) * Math.abs(mkd)) : 0,
        counterparty: name,
        ...(cp ? { iban: cp } : {}),
        ref: g('Referenca'),
        purpose,
        desc: (name ? name + ' – ' : '') + (purpose || 'Налог ' + nalog),
        ...(osnov ? { osnov } : {}),
        ...(nalog ? { nalog } : {}),
        nominal: amt > 0 && nom > amt + 0.009 ? toCents(nom) : 0,
        fee: toCents(fee),
      });
    }
    if (!items.length) continue;
    const no = String(+String(a('BrojIzvoda')).replace(/\D/g, '') || '') || '';
    const iban = a('IBANBroj');
    out.push({
      format: 'halk-xml',
      account: a('Partija') || a('SkracenaPartija'),
      ...(iban ? { iban } : {}),
      owner: a('KomitentNaziv').trim(),
      no: no === '0' ? '' : no,
      date: xDate(a('DatumIzvoda')) || lastDate(items),
      currency: a('OznakaValute') || '',
      opening: toCents(xNum(a('PrethodnoStanje'))),
      closing: toCents(xNum(a('NovoStanje'))),
      debit: toCents(xNum(a('DugovniPromet'))),
      credit: toCents(xNum(a('PotrazniPromet'))),
      lines: items,
    });
  }

  /* 2) ISO 20022 camt.053 */
  for (const S0 of byLocalInDoc(root, 'Stmt')) {
    let cur = '';
    let open: number | null = null;
    let close: number | null = null;
    for (const B of allLocal(S0, 'Bal')) {
      const cd = T(B, 'Tp/CdOrPrtry/Cd');
      const v = xNum(T(B, 'Amt')) * (T(B, 'CdtDbtInd') === 'DBIT' ? -1 : 1);
      if (/OPBD|PRCD/.test(cd)) open = toCents(v);
      if (/CLBD/.test(cd)) close = toCents(v);
      const am = B.children.find((c) => c.local === 'Amt');
      if (am) cur = am.attrs['Ccy'] || cur;
    }
    const items: StatementLine[] = [];
    for (const E of allLocal(S0, 'Ntry')) {
      const am = E.children.find((c) => c.local === 'Amt');
      if (!am) continue;
      const v = xNum(textOf(am)) * (T(E, 'CdtDbtInd') === 'DBIT' ? -1 : 1);
      if (!v) continue;
      cur = cur || am.attrs['Ccy'] || '';
      const tx = allLocal(E, 'TxDtls')[0] || E;
      const cr = v > 0;
      const name = T(tx, cr ? 'RltdPties/Dbtr/Nm' : 'RltdPties/Cdtr/Nm') || T(tx, cr ? 'RltdPties/Dbtr/Pty/Nm' : 'RltdPties/Cdtr/Pty/Nm');
      const purpose = [allLocal(tx, 'Ustrd').map((x) => textOf(x).trim()).join(' '), T(E, 'AddtlNtryInf')].filter(Boolean).join(' – ');
      const valDate = xDate(T(E, 'ValDt/Dt'));
      const cp = T(tx, cr ? 'RltdPties/DbtrAcct/Id/IBAN' : 'RltdPties/CdtrAcct/Id/IBAN');
      const osnov = T(tx, 'Purp/Cd');
      items.push({
        date: xDate(T(E, 'BookgDt/Dt') || T(E, 'BookgDt/DtTm')),
        ...(valDate ? { valDate } : {}),
        amount: toCents(v),
        amountMkd: 0,
        counterparty: name,
        ...(cp ? { iban: cp } : {}),
        ref: T(tx, 'Refs/EndToEndId') || T(E, 'AcctSvcrRef'),
        purpose,
        desc: (name ? name + ' – ' : '') + (purpose || 'Трансакција'),
        ...(osnov ? { osnov } : {}),
        nominal: 0,
        fee: 0,
      });
    }
    if (!items.length) continue;
    const iban = T(S0, 'Acct/Id/IBAN');
    const owner = T(S0, 'Acct/Ownr/Nm');
    out.push({
      format: 'camt.053',
      account: T(S0, 'Acct/Id/Othr/Id'),
      ...(iban ? { iban } : {}),
      ...(owner ? { owner } : {}),
      no: T(S0, 'ElctrncSeqNb') || T(S0, 'LglSeqNb') || (T(S0, 'Id').match(/(\d+)\D*$/) || [])[1] || '',
      date: xDate(T(S0, 'CreDtTm')) || lastDate(items),
      currency: cur,
      opening: open,
      closing: close,
      debit: null,
      credit: null,
      lines: items,
    });
  }
  return out;
}

/** Halk Banka XML only (the `RacunPrivredaIzvod` part of {@link parseBankXml}). */
export const parseHalkXml = (input: Uint8Array | string): Statement[] | null => {
  const r = parseBankXml(input);
  return r && r.filter((s) => s.format === 'halk-xml');
};

/** camt.053 only (the ISO 20022 part of {@link parseBankXml}). */
export const parseCamt053 = (input: Uint8Array | string): Statement[] | null => {
  const r = parseBankXml(input);
  return r && r.filter((s) => s.format === 'camt.053');
};

/* ------------------------------------------------------------------ Komercijalna KBFileFormat */

export const KB_RE = /^(\d{13})(\d{7})\s+([A-Z]{3})(\d{3})(\d{3})(\d{4}\.\d{2}\.\d{2})(\d{4}\.\d{2}\.\d{2})?((?:[+-]\d+\.\d{2})+)(.*)$/;

/**
 * Komercijalna Banka "KBFileFormat" (`.300`): item file (`Izvod_stavki…`) and/or leading record
 * (`Izvod_vodecki_slog…`, balances only — then `lines` is empty). `null` when no line matches.
 *
 * FIX (LEGACY-MAP 4.4 #12): legacy overwrote `no`/`acct`/`cur` on every line; the statement keeps the
 * first line's values and each item records its own `stmtNo`.
 */
export function parseKB(input: Uint8Array | string): Statement | null {
  const L = decodeBankBytes(input).replace(/\r/g, '').split('\n').filter((l) => KB_RE.test(l));
  if (!L.length) return null;
  const st: Statement = { format: 'kb', account: '', no: '', date: '', currency: '', opening: null, closing: null, debit: null, credit: null, lines: [] };
  let hdrDate = '';
  for (const l of L) {
    const m = l.match(KB_RE)!;
    const nums = (m[8]!.match(/[+-]\d+\.\d{2}/g) || []).map((x) => +x);
    const dt = m[6]!.replace(/\./g, '-');
    const no = String(+m[5]!);
    if (!st.account) st.account = m[1]!;
    if (!st.currency) st.currency = m[3]!;
    if (!st.no) st.no = no;
    if (m[7] && nums.length >= 4) {
      const deb = Math.abs(nums[1]! || nums[0]!);
      const cre = Math.abs(nums[3]! || nums[2]!);
      const debC = Math.abs(nums[0]!);
      const creC = Math.abs(nums[2]!);
      const amt = r2(cre - deb);
      const amtC = r2(creC - debC);
      if (!amt && !amtC) continue;
      const rest = m[9] || '';
      let ref = (rest.match(/^\s*([^\s0][^\s]*|\d+\/\d+)/) || [])[1] || rest.trim().split(/\s+/)[0] || '';
      if (/^0+$/.test(ref)) ref = '';
      const cp = (rest.replace(ref, '').match(/[1-9]\d{8,}/) || [])[0] || '';
      const a = m[3] === 'MKD' ? amt : amtC;
      st.lines.push({
        date: dt,
        valDate: m[7].replace(/\./g, '-'),
        amount: toCents(a),
        amountMkd: toCents(amt),
        counterparty: '',
        ...(cp ? { iban: cp } : {}),
        ref,
        purpose: '',
        desc: (a > 0 ? 'Прилив' : 'Одлив') + (ref ? ' · реф. ' + ref.replace(/^0+/, '') : ''),
        nominal: 0,
        fee: 0,
        stmtNo: no,
      });
    } else if (!m[7] && nums.length >= 4) {
      st.opening = toCents(nums[m[3] === 'MKD' ? 1 : 0]!);
      st.closing = toCents(nums[m[3] === 'MKD' ? 3 : 2]!);
      hdrDate = dt;
    }
  }
  st.date = hdrDate || lastDate(st.lines);
  return st;
}

/* ------------------------------------------------------------------ Excel / CSV tables */

/**
 * Legacy `parseAmount` (4745): "1.234,56" → 1234.56, "1,234.56" → 1234.56.
 * FIX: an ambiguous value („10.000“) is read in `fmt` (the column's / file's format, `numfmt.ts`; default the
 * Macedonian dot-thousands) — legacy read it as 10.
 */
export function parseBankAmount(s: unknown, fmt: NumFmt = 'mk'): number {
  if (typeof s === 'number') return s;
  return parseNumAuto(s, fmt) ?? 0;
}

/**
 * Legacy `parseDate` (4746): Date, Excel serial, `d.m.yyyy` / `d/m/yyyy` / `d-m-yyyy`, ISO.
 * FIX: Excel serials are converted in UTC (legacy used the browser's local time zone, which only
 * gave the right day east of UTC).
 */
export function parseBankDate(s: unknown): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (s instanceof Date && !isNaN(+s)) return s.getFullYear() + '-' + p2(s.getMonth() + 1) + '-' + p2(s.getDate());
  if (typeof s === 'number' && s > 30000 && s < 70000) {
    const d = new Date(Math.round((s - 25569) * 864e5));
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  }
  const t = String(s || '').trim();
  // FIX: an impossible date („31.02.2026“) is not a date (it was booked on 3 March)
  const ok = (y: string, mo: string, d: string) => {
    const t0 = new Date(Date.UTC(+y, +mo - 1, +d));
    return t0.getUTCMonth() === +mo - 1 && t0.getUTCDate() === +d ? `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
  };
  let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return ok(m[3]!, m[2]!, m[1]!);
  // FIX: two-digit years („05.03.26“, ТТК / some e-banking exports) and „2026.03.05“ (КБ)
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})(?![\d.,])/);
  if (m) return ok('20' + m[3], m[2]!, m[1]!);
  m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/);
  return m ? ok(m[1]!, m[2]!, m[3]!) : '';
}

/** Legacy `findHeader` (4747): first of 40 rows with a date column and an amount column. */
export function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hd = (rows[i] || []).map((x) => String(x ?? '').toLowerCase());
    if (hd.some((x) => /дат|date/.test(x)) && hd.some((x) => /износ|amount|прилив|одлив|должи|побар|debit|credit|на товар|во корист/.test(x))) return i;
  }
  return -1;
}

/**
 * Excel/CSV statement rows (sheet as array of rows) → statement. Port of the parsing half of legacy
 * `importRows` (4748), on the normalised table of `bank/table.ts`: header over 1–3 rows, columns by role, multi-line
 * transactions merged, page headers / footers / total rows skipped, statement number, date, account and balances
 * from the header block. FIX: tables without a date column (Халк: the date is in the header „Извод бр. … од …“) take
 * the statement date; a column with both directions („ИЗНОС задолжува одобрува“) and an amount that slipped into the
 * next cell are split. `null` when the columns are not recognised or no line has an amount ({@link readBankTable}
 * says why).
 */
export function parseBankTable(rows: unknown[][], fmt?: NumFmt): Statement | null {
  return readBankTable(rows, fmt).st;
}

export interface BankTableRead {
  st: Statement | null;
  /** Why nothing was read (Macedonian, names the row / column). */
  error?: string;
  /** Rows that were left out or need a look. */
  warnings: string[];
  /**
   * The statement does not agree with itself (opening + movements ≠ closing, Σ debits / credits ≠ the printed totals):
   * the import is refused until it is fixed ({@link statementProblems}).
   */
  blocking: string[];
}

/**
 * HARD CHECK of a read statement (every format): opening + credits − debits = closing, and the debit / credit sums =
 * the printed totals („Вкупно задолжување / одобрување“, the table's „Вкупно“ row). Each problem as a message with both
 * numbers; an empty list = the statement agrees with itself (or prints no balances / totals).
 */
export function statementProblems(st: Pick<Statement, 'opening' | 'closing' | 'debit' | 'credit' | 'lines'>): string[] {
  if (!st.lines.length) return [];
  const P: string[] = [];
  const sum = st.lines.reduce((a, l) => a + l.amount, 0);
  const out = -st.lines.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0), inn = st.lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);
  if (st.opening != null && st.closing != null && st.opening + sum !== st.closing) {
    P.push(`Салдата не се совпаѓаат: претходна состојба ${fmtC(st.opening)} + приливи ${fmtC(inn)} − одливи ${fmtC(out)} = ${fmtC(st.opening + sum)}, а во изводот новата состојба е ${fmtC(st.closing)} (разлика ${fmtC(st.closing - st.opening - sum)}).`);
  }
  if (st.debit != null && st.debit !== out) P.push(`Збирот на прочитаните одливи (задолжување) е ${fmtC(out)}, а во изводот „Вкупно задолжување“ е ${fmtC(st.debit)} (разлика ${fmtC(st.debit - out)}).`);
  if (st.credit != null && st.credit !== inn) P.push(`Збирот на прочитаните приливи (одобрување) е ${fmtC(inn)}, а во изводот „Вкупно одобрување“ е ${fmtC(st.credit)} (разлика ${fmtC(st.credit - inn)}).`);
  return P;
}

/** {@link parseBankTable} with the reasons: what was not recognised, which rows were left out, reconciliation. */
export function readBankTable(rows: readonly (readonly unknown[])[], fmt?: NumFmt, o: { hi?: number } = {}): BankTableRead {
  if (fmt) return parseBankTableFmt(rows, fmt, undefined, o.hi);
  // FIX: number format of the amount columns over all lines (`numfmt.ts`). Ambiguous („10.000“ only) → the
  // interpretation for which opening + movements = closing (balances printed above / below the table); otherwise
  // AmbiguousAmountsError (flag for review instead of guessing).
  const cells: unknown[] = [];
  const first = parseBankTableFmt(rows, 'mk', cells, o.hi);
  if (!first.st) return first;
  const amb = ambExamples(cells);
  if (!amb.length) return first;
  const f = colFormat(cells);
  if (f === 'mk') return first;
  if (f === 'dot') return parseBankTableFmt(rows, 'dot', undefined, o.hi);
  const pick = reconcileFmt((x) => {
    const st = parseBankTableFmt(rows, x, undefined, o.hi).st;
    return !!st && st.opening != null && st.closing != null && st.opening + st.lines.reduce((a, l) => a + l.amount, 0) === st.closing;
  });
  if (!pick) throw new AmbiguousAmountsError('Износите во изводот', amb);
  return parseBankTableFmt(rows, pick, undefined, o.hi);
}

const DIR_RE = /^(д\s*\/\s*п|d\s*\/\s*c|db\s*\/\s*cr|тип|tip|насока)$/i;
const fmtC = (c: number) => {
  const s = (Math.abs(c) / 100).toFixed(2).split('.');
  return (c < 0 ? '-' : '') + s[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1];
};

function parseBankTableFmt(rows: readonly (readonly unknown[])[], fmt: NumFmt, cells?: unknown[], hi?: number): BankTableRead {
  const amt = (v: unknown) => { cells?.push(v); return parseBankAmount(v, fmt); };
  const P = prepBankGrid(rows, hi);
  if (!P) return { st: null, warnings: [], blocking: [], error: 'Не е пронајден редот со насловите на колоните (на пр. „Датум“, „Налогодавач / примач“, „Должи / Побарува“, „Одлив / Прилив“ или „Износ“) во првите 60 реда.' };
  const has = (r: BankRole) => P.cols.some((c) => c.role === r);
  const hdrRows = `ред ${P.hi + 1}${P.hn > 1 ? '–' + (P.hi + P.hn) : ''}`;
  if (!has('amount') && !has('debit') && !has('credit')) return { st: null, warnings: [], blocking: [], error: `Во насловите (${hdrRows}) нема колона за износ („Износ“, „Должи / Побарува“, „Одлив / Прилив“, „Задолжува / Одобрува“).` };
  if (!has('date') && !P.meta.date) return { st: null, warnings: [], blocking: [], error: `Во насловите (${hdrRows}) нема колона „Датум“, а датумот на изводот не е пронајден во заглавјето („Извод бр. … од дд.мм.гггг“ / „Датум на извод“). Внесете го датумот во 🔄 Конвертор на датотеки.` };
  const iDir = P.cols.findIndex((c) => c.role === null && DIR_RE.test(c.header.trim()));
  const purposeCols = P.cols.map((c, i) => (c.role === 'purpose' ? i : -1)).filter((i) => i >= 0);
  const val = (it: BankItem, r: BankRole): unknown => {
    for (let i = 0; i < P.cols.length; i++) if (P.cols[i]!.role === r && it.cells[i] !== '') return it.cells[i];
    return '';
  };
  const warnings: string[] = [];
  const lines: StatementLine[] = [];
  for (const it of P.items) {
    const rowNo = it.row + 1;
    if (it.errs.length) { warnings.push(`Ред ${rowNo}: ${it.errs.join('; ')} – ставката е прескокната.`); continue; }
    const date = parseBankDate(it.rawDate) || (has('date') ? '' : P.meta.date);
    let amount = has('amount') && val(it, 'amount') !== '' ? amt(val(it, 'amount')) : amt(val(it, 'credit')) - amt(val(it, 'debit'));
    if (!date) {
      const raw = it.rawDate instanceof Date ? '' : String(it.rawDate ?? '').trim();
      // legacy: rows without a date are skipped silently; a row with an amount is reported
      if (amount) warnings.push(`Ред ${rowNo}: ${raw ? `„${raw}“ во колоната „${P.cols.find((c) => c.role === 'date')!.header}“ не е датум` : 'нема датум'} – ставката е прескокната.`);
      continue;
    }
    if (iDir >= 0 && has('amount')) {
      const d = String(it.cells[iDir] ?? '').trim();
      if (/^(д|d|-|дб|db|задолж|должи)/i.test(d)) amount = -Math.abs(amount);
      else if (/^(п|c|\+|кр|cr|одобр|побар)/i.test(d)) amount = Math.abs(amount);
    }
    if (!amount) continue;
    const name = itemCell(P, it, 'name', ' ');
    const ref = itemCell(P, it, 'ref', ' ');
    const osnov = itemCell(P, it, 'code', ' ');
    const iban = itemCell(P, it, 'account', ' ');
    const purp = purposeCols.map((i) => String(it.cells[i] ?? '').trim());
    const purpose = purp.filter((x, i, A) => x && A.indexOf(x) === i).join(' · ');
    const desc = [name, ...purp].filter((x, i, A) => x && A.indexOf(x) === i).join(' · ') || (ref ? 'Реф. ' + ref : '');
    const valDate = parseBankDate(it.rawValDate);
    lines.push({ date, ...(valDate && valDate !== date ? { valDate } : {}), amount: toCents(amount), counterparty: name, ...(iban ? { iban } : {}), ref, purpose, desc, ...(osnov ? { osnov } : {}) });
  }
  if (!lines.length) return { st: null, warnings, blocking: [], error: `Под насловите (${hdrRows}) нема ниту една ставка со датум и износ.${warnings.length ? ' ' + warnings.slice(0, 3).join(' ') : ''}` };
  const M = P.meta;
  const cOf = (v: string | null) => (v == null ? null : toCents(amt(v)));
  const opening = cOf(M.opening), closing = cOf(M.closing);
  const debit = cOf(M.debit ?? P.totals.debit), credit = cOf(M.credit ?? P.totals.credit);
  const st: Statement = {
    format: 'table', account: M.account, no: M.no, date: M.date || lastDate(lines), currency: M.currency,
    opening, closing, debit: debit == null ? null : Math.abs(debit), credit: credit == null ? null : Math.abs(credit), lines,
  };
  return { st, warnings, blocking: statementProblems(st) };
}
/**
 * Split CSV/TXT text into rows the way legacy did (delimiter = the one of `; \t , |` that splits the
 * first line into most cells). FIX: quoted cells may contain the delimiter (`"1.234,56"` with `,`);
 * legacy split blindly and only stripped the outer quotes.
 */
export function splitCsv(text: string): string[][] {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
  const first = lines[0] || '';
  const delim = [';', '\t', ',', '|'].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  return lines.map((l) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (q) {
        if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"' && cur.trim() === '') { q = true; cur = ''; }
      else if (ch === delim) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/** CSV/TXT statement: MT940 when it contains `:61:` lines, otherwise a table. */
export function parseBankCsv(input: Uint8Array | string): Statement[] | null {
  const txt = decodeBankBytes(input);
  if (/^:61:/m.test(txt)) {
    const m = parseMT940(txt);
    if (m.length) return m;
  }
  const st = parseBankTable(splitCsv(txt));
  return st ? [st] : null;
}

/* ------------------------------------------------------------------ dispatch */

export type StatementFileKind = StatementFormat | 'excel' | 'ai';

/**
 * Which reader handles a file (final legacy `importBankFile` chain 12889 → 12677 → 12641 → 4784).
 * `excel` = read the workbook with a spreadsheet library and pass rows to {@link parseBankTable};
 * `ai` = not machine-readable (PDF/image or unknown) → AI reading job.
 */
export function detectStatementFormat(input: Uint8Array | string, fileName: string): StatementFileKind {
  const nm = String(fileName || '').toLowerCase();
  const txt = () => decodeBankBytes(input);
  if (/\.\d{3}$/.test(nm) || /kbfileformat/i.test(nm)) {
    if (parseKB(txt())) return 'kb';
  }
  if (/\.xml$/.test(nm) || /\.xls$/.test(nm)) {
    const t = txt().slice(0, 4000);
    if (/<RacunPrivredaIzvod/i.test(t)) return 'halk-xml';
    if (/BkToCstmrStmt|camt\.053/i.test(t)) return 'camt.053';
  }
  if (/\.(xlsx|xls)$/.test(nm)) return 'excel';
  if (/\.(sta|940|mt940|swi)$/.test(nm)) return parseMT940(txt()).length ? 'mt940' : 'ai';
  if (/\.(csv|txt)$/.test(nm)) {
    const t = txt();
    if (/^:61:/m.test(t) && parseMT940(t).length) return 'mt940';
    return 'table';
  }
  return 'ai';
}

/**
 * Parse a statement file by name and content. Returns `null` when the file needs the Excel reader
 * or AI (see {@link detectStatementFormat}) or nothing could be read.
 */
export function parseStatementFile(input: Uint8Array | string, fileName: string): Statement[] | null {
  const kind = detectStatementFormat(input, fileName);
  switch (kind) {
    case 'kb': { const s = parseKB(input); return s ? [s] : null; }
    case 'halk-xml':
    case 'camt.053': { const r = parseBankXml(input); return r && r.length ? r : null; }
    case 'mt940': return parseMT940(input);
    case 'table': return parseBankCsv(input);
    default: return null;
  }
}
