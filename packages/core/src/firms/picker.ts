/**
 * Firm picker for 400+ firms (legacy `firmPicker` v455–v458, 14173–14286) and the office-wide notification
 * helpers used by the top bar / Известувања (legacy `alFirmBadge` 8606, `alSummaryText` 8572, `alMail` 8579).
 * Pure: the screens pass plain rows.
 */

/** Legacy `FP_AZ`: Macedonian alphabet for the letter bar. */
export const FP_AZ = 'АБВГДЃЕЖЗЅИЈКЛЉМНЊОПРСТЌУФХЦЧЏШ'.split('');

/** Legacy `FP_VIEWS`. */
export const FP_VIEWS = [['grid', '⊞ Табела'], ['list', '☰ Листа'], ['tiles', '▦ Плочки'], ['group', '▤ По групи'], ['status', '📊 Состојба']] as const;
export type FpView = (typeof FP_VIEWS)[number][0];

/** Legacy `FL` filter chips. */
export const FP_FILTERS = [
  ['all', 'Сите'], ['ddv', 'ДДВ обврзници'], ['nddv', 'Не се ДДВ'], ['mon', 'ДДВ месечно'], ['qtr', 'ДДВ тромесечно'], ['al', '🔔 Со известувања'],
] as const;
export type FpFilter = (typeof FP_FILTERS)[number][0];
/** Legacy `FLN` (print subtitle). */
export const FP_FILTER_TITLE: Record<FpFilter, string> = {
  all: 'Сите фирми', ddv: 'ДДВ обврзници', nddv: 'Фирми што не се ДДВ обврзници', mon: 'ДДВ обврзници – месечно', qtr: 'ДДВ обврзници – тромесечно', al: 'Фирми со известувања',
};

export interface FpFirm {
  id: string; name: string; code?: string | null; edb?: string | null; embs?: string | null; city?: string | null; address?: string | null;
  email?: string | null; phone?: string | null; phone2?: string | null; contact?: string | null; vat: boolean; month: boolean;
  example?: boolean; ddvNo?: string | null; recNext?: string | null; fee?: number;
  /** Open (unacknowledged, non-info) notifications: total and urgent. */
  al?: { n: number; bad: number; txt: string[] } | null;
  /** Last accepted МПИН month + number (legacy `S.mpinIdx`). */
  mp?: { month: string; no: string | null } | null;
  /** Old-program grid columns („Избор на работна фирма“), see `fgData`. */
  g?: FgData;
}

/* ---------------- Grid „Избор на работна фирма“ (the old DOS-era program) ---------------- */

/**
 * Old-program columns that are not plain firm columns. Sources: the Excel import of the old program's firm list
 * (`firmimp.ts` → `firms.settings`: parent, bank2, realBank, bankAcc, ftype, closedFlag, regNo, bankEdb, bankName,
 * payCode, depositor, opstina, opstina2, curYear), the firm's bank accounts and the year closing of the selected year.
 * Empty strings are kept: a column without data stays empty (an empty „Родител“ = no record the year before).
 */
export interface FgData {
  year: string; parent: string; bank: string; activity: string; ftype: string; closed: string; bank2: string; regNo: string;
  bankName: string; payCode: string; realBank: string; bankEdb: string; depositor: string; bankAcc: string; opstina: string; opstina2: string;
  /** Every account number of the firm (search only). */
  accts: string[];
  /** Every шифра of the firm: this year's, the WISE code and the parent (search only). */
  codes: string[];
}

/** Grid columns in the old program's order: key, heading, cell text. */
export const FG_COLS: readonly (readonly [string, string, (f: FpFirm) => string])[] = [
  ['code', 'Шифра', (f) => f.code || ''],
  ['name', 'Име на фирма', (f) => f.name],
  ['year', 'Година', (f) => f.g?.year ?? ''],
  ['parent', 'Родител', (f) => f.g?.parent ?? ''],
  ['bank', 'Жиро сметка', (f) => f.g?.bank ?? ''],
  ['activity', 'Дејност', (f) => f.g?.activity ?? ''],
  ['ftype', 'Ф/СТД', (f) => f.g?.ftype ?? ''],
  ['closed', 'Заклуч.', (f) => f.g?.closed ?? ''],
  ['bank2', 'Дополн. жиро', (f) => f.g?.bank2 ?? ''],
  ['embs', 'Матичен број', (f) => f.embs || ''],
  ['regNo', 'Рег. број', (f) => f.g?.regNo ?? ''],
  ['edb', 'Даночен бр', (f) => f.edb || ''],
  ['address', 'Адреса', (f) => f.address || ''],
  ['phone', 'Телефон', (f) => fpPhone(f)],
  ['bankName', 'Банка', (f) => f.g?.bankName ?? ''],
  ['payCode', 'Код за п.', (f) => f.g?.payCode ?? ''],
  ['realBank', 'Реална жиро', (f) => f.g?.realBank ?? ''],
  ['bankEdb', 'Даночен бр. на б…', (f) => f.g?.bankEdb ?? ''],
  ['depositor', 'Депозитор на б…', (f) => f.g?.depositor ?? ''],
  ['bankAcc', 'Жиро с-ка на банка', (f) => f.g?.bankAcc ?? ''],
  ['opstina', 'Општина', (f) => f.g?.opstina ?? ''],
  ['opstina2', 'Општина2', (f) => f.g?.opstina2 ?? ''],
];
export type FgCol = string;

const sv = (o: Readonly<Record<string, unknown>>, k: string): string => (typeof o[k] === 'string' || typeof o[k] === 'number' ? String(o[k]).trim() : '');

/**
 * „Шифра“ / „Родител“ for the selected year. The old program had one record per firm and year, each with its own
 * шифра, and „Родител“ = the шифра of the same company the year before. WISE keeps one firm over all years with one
 * code; the import kept the code of its „Година“ (`curYear`) and that record's „Родител“ (`parent`). So:
 *  - the year before the imported year: the imported parent is that year's шифра (its own parent is unknown → empty);
 *  - otherwise: the firm code and the imported parent (empty when the firm had no record the year before, or was
 *    created in WISE — an empty Родител is valid data).
 */
export function fgCodes(code: string | null | undefined, st: Readonly<Record<string, unknown>>, year: number): { code: string; parent: string } {
  const parent = sv(st, 'parent'), cy = Number(sv(st, 'curYear'));
  if (parent && /^\d{4}$/.test(String(cy)) && year === cy - 1) return { code: parent, parent: '' };
  return { code: String(code ?? '').trim(), parent };
}

const COMPANY = new Set(['doo', 'dooel', 'ad', 'jtd', 'co']);
const SELF = new Set(['tp', 'sd', 'zan', 'adv', 'not']);
/** „Ф/СТД“: the imported value; otherwise Ф for a company, СТД for a sole trader / self-employed (from the closing entity or the legal form). */
export function fgFtype(st: Readonly<Record<string, unknown>>, legalForm: string | null | undefined, entity?: string | null): string {
  const t = sv(st, 'ftype');
  if (t) return t;
  const k = String(entity || legalForm || '').toLowerCase();
  return COMPANY.has(k) ? 'Ф' : SELF.has(k) ? 'СТД' : '';
}

/** „Заклуч.“ (Д/Н) for the selected year: the year closing (closed / carried / locked), else the imported flag of that year. */
export function fgClosed(status: string | null | undefined, st: Readonly<Record<string, unknown>>, year: number): string {
  if (status) return status === 'open' ? 'Н' : 'Д';
  const fl = sv(st, 'closedFlag').toLowerCase();
  if (fl && Number(sv(st, 'curYear')) === year) return /^(д|да|d|da|y|yes|1|true|x|х)$/.test(fl) ? 'Д' : 'Н';
  return 'Н';
}

/** The old-program columns of one firm (server side; no queries — the caller passes the firm's bank accounts and closing). */
export function fgData(f: { code?: string | null; legalForm?: string | null; activity?: string | null; settings?: Readonly<Record<string, unknown>> | null }, year: number,
  banks: readonly { account: string | null; name: string }[], closing?: { status: string; entity: string | null } | null): FgData & { code: string } {
  const st = f.settings ?? {};
  const c = fgCodes(f.code, st, year);
  const main = banks.find((b) => b.account)?.account ?? '';
  const generic = (n: string) => !n || /^(трансакциска|жиро|сметка)/i.test(n);
  return {
    code: c.code, year: String(year), parent: c.parent,
    bank: main || sv(st, 'bankAccount') || sv(st, 'bank'),
    activity: String(f.activity ?? '').trim() || sv(st, 'nkd'),
    ftype: fgFtype(st, f.legalForm, closing?.entity), closed: fgClosed(closing?.status, st, year),
    bank2: sv(st, 'bank2') || (banks.filter((b) => b.account)[1]?.account ?? ''),
    regNo: sv(st, 'regNo'),
    bankName: sv(st, 'bankName') || (banks.find((b) => b.account && !generic(b.name))?.name ?? ''),
    payCode: sv(st, 'payCode'), realBank: sv(st, 'realBank'), bankEdb: sv(st, 'bankEdb'), depositor: sv(st, 'depositor'), bankAcc: sv(st, 'bankAcc'),
    opstina: sv(st, 'opstina'), opstina2: sv(st, 'opstina2'),
    codes: [...new Set([c.code, String(f.code ?? '').trim(), c.parent, sv(st, 'parent')].filter(Boolean))],
    accts: [...new Set([...banks.map((b) => b.account), sv(st, 'bankAccount'), sv(st, 'bank'), sv(st, 'bank2'), sv(st, 'realBank')].filter((x): x is string => !!x))],
  };
}

/** Grid search: every word in name, шифра, Родител, ЕДБ, ЕМБС or an account (accounts also without dashes / spaces). */
export function fgMatch(f: FpFirm, q: string): boolean {
  const A = [...(f.g?.accts ?? []), f.g?.bank ?? ''].filter(Boolean);
  const hay = [f.name, f.code, f.g?.parent, ...(f.g?.codes ?? []), f.edb, f.embs, ...A, ...A.map((a) => a.replace(/\D/g, ''))].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Grid pipeline: search → sort by a column (default Шифра, numbers in numeric order, empty cells last). */
export function fgApply(F0: readonly FpFirm[], q: string, sort: FgCol = 'code', desc = false): FpFirm[] {
  const col = FG_COLS.find(([k]) => k === sort) ?? FG_COLS[0]!;
  const get = col[2];
  const F = q.trim() ? F0.filter((f) => fgMatch(f, q)) : [...F0];
  return F.sort((a, b) => {
    const x = get(a), y = get(b);
    if (!x !== !y) return x ? -1 : 1;
    const r = x.localeCompare(y, 'mk', { numeric: true }) || a.name.localeCompare(b.name, 'mk');
    return desc ? -r : r;
  });
}

/** Grid keyboard: ↑ ↓ PgUp PgDn Home End move the selection, Enter opens it. */
export function fgKey(k: number, n: number, key: string): { k: number; open: boolean } | null {
  const c = (i: number) => Math.max(0, Math.min(n - 1, i));
  switch (key) {
    case 'ArrowDown': return { k: c(k + 1), open: false };
    case 'ArrowUp': return { k: c(k - 1), open: false };
    case 'PageDown': return { k: c(k + 20), open: false };
    case 'PageUp': return { k: c(k - 20), open: false };
    case 'Home': return { k: 0, open: false };
    case 'End': return { k: c(n - 1), open: false };
    case 'Enter': return n ? { k: c(k), open: true } : null;
    default: return null;
  }
}

/** Legacy `fpShort`: drop the long "Друштво за трговија и услуги …" prefix. */
export function fpShort(n: string | null | undefined): string {
  const s = String(n || '');
  return s.replace(/^Друштво за (производство,? )?(трговија|услуги|производство)( и (услуги|трговија|производство))*( и [^А-Я]*)?\s*/i, '').trim() || s;
}
export const fpLetter = (f: { name: string }): string => fpShort(f.name).trim().charAt(0).toUpperCase();

/** Legacy `fpDdvNo`. */
export const fpDdvNo = (f: FpFirm): string => (f.vat ? f.ddvNo || 'MK' + String(f.edb || '').replace(/\D/g, '') : '');
/** Legacy `fpPhone`. */
export const fpPhone = (f: FpFirm): string => [f.phone, f.phone2].filter((v): v is string => !!v).filter((v, i, a) => a.indexOf(v) === i).join(', ');
/** Legacy `fpPerson` (contact person). */
export const fpPerson = (f: FpFirm): string => f.contact || '';

/** Legacy `fpStatus().prev`: previous month `YYYY-MM`. */
export function fpPrevMonth(today: string): string {
  let y = +today.slice(0, 4), m = +today.slice(5, 7) - 1;
  if (m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Legacy `fpDdvDue`: the VAT return due on the 25th of this month (none for a quarterly firm outside a quarter end). */
export function fpDdvDue(f: Pick<FpFirm, 'vat' | 'month'>, today: string): { per: string; due: string } | null {
  if (!f.vat) return null;
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  let pm = m - 1, py = y;
  if (pm < 1) { pm = 12; py--; }
  if (!f.month && pm % 3 !== 0) return null;
  return { per: (f.month ? String(pm).padStart(2, '0') : 'Q' + Math.ceil(pm / 3)) + '/' + py, due: today.slice(0, 7) + '-25' };
}

/** Legacy `srchMatch`: every word must occur (case-insensitive). */
export function fpMatch(f: FpFirm, q: string): boolean {
  const hay = [f.name, f.edb, f.city, f.code, f.embs, f.email, f.phone, f.phone2, f.contact].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const FILTER: Record<FpFilter, (f: FpFirm) => boolean> = {
  all: () => true, ddv: (f) => f.vat, nddv: (f) => !f.vat, mon: (f) => f.vat && f.month, qtr: (f) => f.vat && !f.month, al: (f) => !!f.al?.n,
};

export type FpSort = 'name' | 'edb' | 'city' | 'rec';
export interface FpState { q: string; flt: FpFilter; az: string; sort: FpSort }

/** Legacy picker pipeline: search → filter chip → letter → sort. Returns the rows and the letters that have firms. */
export function fpApply(F0: readonly FpFirm[], P: FpState, recent: readonly string[] = []): { rows: FpFirm[]; letters: Set<string> } {
  const q = P.q.trim();
  let F = F0.filter((f) => (!q || fpMatch(f, q)) && (FILTER[P.flt] ?? FILTER.all)(f));
  const letters = new Set(F.map(fpLetter));
  if (P.az) F = F.filter((f) => fpLetter(f) === P.az);
  const nm = (a: FpFirm, b: FpFirm) => fpShort(a.name).localeCompare(fpShort(b.name), 'mk');
  const ri = (id: string) => { const i = recent.indexOf(id); return i < 0 ? 99 : i; };
  const cmp: Record<FpSort, (a: FpFirm, b: FpFirm) => number> = {
    name: nm,
    edb: (a, b) => String(a.edb || '').localeCompare(String(b.edb || '')),
    city: (a, b) => String(a.city || '').localeCompare(String(b.city || ''), 'mk') || nm(a, b),
    rec: (a, b) => ri(a.id) - ri(b.id) || nm(a, b),
  };
  return { rows: [...F].sort(cmp[P.sort] ?? nm), letters };
}

/** Legacy `fpGrpKey`. */
export function fpGroupKey(f: FpFirm, by: 'letter' | 'city' | 'ddv'): string {
  if (by === 'city') return f.city || 'Без град';
  if (by === 'ddv') return f.vat ? (f.month ? 'ДДВ – месечно' : 'ДДВ – тромесечно') : 'Не се ДДВ обврзници';
  return fpLetter(f) || '#';
}

/** Legacy `fpXlsx` rows (header + one row per firm). */
export function fpExportRows(L: readonly FpFirm[]): (string | number)[][] {
  const head: (string | number)[][] = [['Фирма', 'Цел назив', 'Шифра', 'ЕДБ', 'ЕМБС', 'ДДВ обврзник', 'ДДВ период', 'ДДВ број', 'Контакт лице', 'Телефон', 'Е-пошта', 'Адреса', 'Град', 'Мес. фактура', 'Надомест']];
  return head.concat(L.map((f) => [fpShort(f.name), f.name, f.code || '', f.edb || '', f.embs || '', f.vat ? 'Да' : 'Не', f.vat ? (f.month ? 'месечно' : 'тромесечно') : '',
      fpDdvNo(f), fpPerson(f), fpPhone(f), f.email || '', f.address || '', f.city || '', f.recNext || '', f.fee || '']));
}

/* ---------------- Notifications (Известувања) ---------------- */

export interface AlItem { firm: string; lvl: 'bad' | 'warn' | 'info'; txt: string }

/** Legacy `alSummaryText`: per firm, urgent / attention lines (info left out); the voice variant is one sentence. */
export function alSummaryText(items: readonly AlItem[], forVoice = false): string {
  const byF = new Map<string, AlItem[]>();
  for (const a of items.filter((x) => x.lvl !== 'info')) byF.set(a.firm, [...(byF.get(a.firm) ?? []), a]);
  if (!byF.size) return forVoice ? 'Нема итни известувања. Сè е во ред.' : 'Нема итни известувања – сè е во ред.';
  const F = [...byF.entries()];
  if (forVoice) {
    return 'Имате ' + items.filter((a) => a.lvl === 'bad').length + ' итни и ' + items.filter((a) => a.lvl === 'warn').length + ' известувања за внимание. '
      + F.map(([f, A]) => f + ': ' + A.map((a) => a.txt.replace(/\(.*?\)/g, '').replace(/ден\./g, 'денари')).join('. ')).join('. ') + '.';
  }
  return F.map(([f, A]) => f + '\n' + A.map((a) => (a.lvl === 'bad' ? '  🔴 ' : '  🟠 ') + a.txt).join('\n')).join('\n\n');
}

/** Legacy `alMail` body (plain text). `todayDmy` is dd.mm.yyyy. */
export function alMailBody(items: readonly AlItem[], todayDmy: string, auto: boolean): { subject: string; body: string } {
  const n = items.filter((a) => a.lvl !== 'info').length;
  const info = items.filter((a) => a.lvl === 'info');
  const body = 'Известувања од WISE CONSULTING – ' + todayDmy + '\n\n' + alSummaryText(items) + '\n\n'
    + (info.length ? 'Инфо:\n' + info.map((a) => '  🔵 ' + a.firm + ': ' + a.txt).join('\n') + '\n\n' : '')
    + (auto ? '(Автоматски потсетник – се праќа еднаш дневно при првото отворање на програмата.)' : '');
  return { subject: '🔔 Известувања (' + n + ') – ' + todayDmy, body };
}

/** Legacy `alBell` state: label and class of the big top-bar button. */
export function alBellState(bad: number, warn: number): { cls: 'bad' | 'warn' | 'ok'; n: number; label: string; title: string } {
  const n = bad + warn;
  return {
    cls: bad ? 'bad' : warn ? 'warn' : 'ok', n, label: n ? (bad ? 'ИТНО' : 'ВНИМАНИЕ') : 'Нема известувања',
    title: n ? `${bad} итни и ${warn} известувања за внимание – кликнете за да ги видите` : 'Нема итни известувања',
  };
}
