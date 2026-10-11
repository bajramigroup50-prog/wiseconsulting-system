/**
 * Firm picker for 400+ firms (legacy `firmPicker` v455–v458, 14173–14286) and the office-wide notification
 * helpers used by the top bar / Известувања (legacy `alFirmBadge` 8606, `alSummaryText` 8572, `alMail` 8579).
 * Pure: the screens pass plain rows.
 */

/** Legacy `FP_AZ`: Macedonian alphabet for the letter bar. */
export const FP_AZ = 'АБВГДЃЕЖЗЅИЈКЛЉМНЊОПРСТЌУФХЦЧЏШ'.split('');

/** Legacy `FP_VIEWS`. */
export const FP_VIEWS = [['list', '☰ Листа'], ['tiles', '▦ Плочки'], ['group', '▤ По групи'], ['status', '📊 Состојба']] as const;
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
