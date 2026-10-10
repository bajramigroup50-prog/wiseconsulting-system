/**
 * Fixed-asset register extras (legacy `VIEWS.os` 5850, editor 8631–8655, `osBadge`, `osLabelsHTML` 8656, `osCardHTML`
 * 8676): vehicle fields, document types, expiry badges, QR text, and the Excel template / import of the register.
 */

/** Asset document types (legacy `OS_DOCT`). */
export const OS_DOCT: readonly string[] = [
  'Сообраќајна дозвола', 'Лиценца / дозвола', 'Договор за купување', 'Фактура за набавка', 'Полиса за осигурување', 'Технички преглед',
  'Гарантен лист', 'Записник за примопредавање', 'Друго',
];

/** Vehicle block fields in `fixed_assets.data` (legacy `as_veh`): [key, label, type, placeholder]. */
export const OS_VEH: readonly (readonly [string, string, 'text' | 'date' | 'number', string?])[] = [
  ['plate', 'Регистарска таблица', 'text', 'SK-1234-AB'],
  ['regExp', 'Регистрацијата важи до', 'date'],
  ['insExp', 'Осигурување до', 'date'],
  ['techExp', 'Технички преглед до', 'date'],
  ['fuelNorm', 'Норма на гориво (л/100 км)', 'number'],
  ['capKg', 'Носивост (кг)', 'number'],
  ['odo', 'Километража (тековна)', 'number'],
  ['oilEvery', 'Сервис (масло) на секои км', 'number', '15000'],
  ['oilLastKm', 'Последен сервис на км', 'number'],
  ['tyreEvery', 'Гуми на секои км', 'number', '40000'],
  ['tyreLastKm', 'Последна замена гуми на км', 'number'],
];

export interface OsDoc { fileId: string; type: string; title?: string; validTo?: string }

/** Legacy `osExpList`: what expires within 30 days (or already expired). */
export function osExpiry(data: Readonly<Record<string, unknown>>, docs: readonly OsDoc[], today: string): { what: string; date: string; bad: boolean }[] {
  const lim = new Date(Date.parse(today + 'T00:00:00Z') + 30 * 864e5).toISOString().slice(0, 10);
  const out: { what: string; date: string; bad: boolean }[] = [];
  const add = (what: string, d: unknown) => {
    const s = String(d ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && s <= lim) out.push({ what, date: s, bad: s < today });
  };
  if (data.veh || data.plate) { add('Регистрација', data.regExp); add('Осигурување', data.insExp); add('Технички преглед', data.techExp); }
  for (const d of docs) add(d.type + (d.title ? ' ' + d.title : ''), d.validTo);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** QR payload of a label / card (legacy `'OS|' + (barcode || invNo || id) + '|' + name`). */
export const osQrText = (a: { barcode?: string | null; invNo?: string | null; id: string; name: string }): string =>
  'OS|' + (a.barcode || a.invNo || a.id) + '|' + (a.name || '');

/** A scanned label in the search box → the asset code (legacy 5859). */
export const osScanCode = (q: string): string | null => {
  const m = /^OS\|([^|]+)\|/.exec(String(q || '').trim());
  return m ? m[1]! : null;
};

/** Register sort: inventory number, numeric (legacy `localeCompare(…, 'mk', {numeric:true})`). */
export const osCmp = (a: { invNo?: string | null; name: string }, b: { invNo?: string | null; name: string }): number =>
  String(a.invNo ?? '').localeCompare(String(b.invNo ?? ''), 'mk', { numeric: true }) || a.name.localeCompare(b.name, 'mk');

export const OS_XLSX_HEAD = ['Инв.бр.', 'Назив', 'Сериски / шасија', 'Баркод', 'Конто', 'Датум на набавка', 'Набавна вредност', 'Стапка %', 'Добавувач', 'Фактура', 'Локација', 'Регистарска таблица'] as const;

export interface OsImportRow {
  invNo: string; name: string; serial: string; barcode: string; konto: string; date: string; cost: number; rate: number;
  supplier: string; invDoc: string; location: string; plate: string;
}

const N = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^0-9a-zа-шѓќљњџѕј%]+/gi, ' ').trim();
const ALIAS: Record<keyof OsImportRow, string[]> = {
  invNo: ['инв', 'инвентарен', 'inv'], name: ['назив', 'име', 'средство', 'name'], serial: ['сериски', 'шасија', 'serial'], barcode: ['баркод', 'barcode'],
  konto: ['конто', 'konto', 'account'], date: ['датум', 'набавено', 'date'], cost: ['набавна', 'вредност', 'cost'], rate: ['стапка', 'rate', '%'],
  supplier: ['добавувач', 'supplier'], invDoc: ['фактура', 'документ', 'invoice'], location: ['локација', 'задолжено', 'location'], plate: ['таблица', 'регистарска', 'plate'],
};

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  let t = String(v ?? '').trim().replace(/\s|ден\.?/gi, '');
  if (/,\d{1,2}$/.test(t) || /\.\d{3},/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};
const isoDate = (v: unknown): string => {
  const t = String(v ?? '').trim();
  if (/^\d{5}$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + +t * 864e5).toISOString().slice(0, 10);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(t);
  if (m) return `${m[3]!.length === 2 ? '20' + m[3] : m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return '';
};

/** Register import: header row first; needs Назив, Набавна вредност and Датум. */
export function osParse(rows: readonly (readonly unknown[])[]): OsImportRow[] | { error: string } {
  const H = (rows[0] ?? []).map(N);
  const col: Partial<Record<keyof OsImportRow, number>> = {};
  const used = new Set<number>();
  for (const k of Object.keys(ALIAS) as (keyof OsImportRow)[]) {
    const i = H.findIndex((h, j) => !used.has(j) && ALIAS[k].some((a) => h === a || h.startsWith(a) || h.includes(a)));
    if (i >= 0) { col[k] = i; used.add(i); }
  }
  if (col.name == null || col.cost == null || col.date == null) return { error: 'Excel мора да има колони „Назив“, „Набавна вредност“ и „Датум на набавка“.' };
  const g = (r: readonly unknown[], k: keyof OsImportRow) => (col[k] == null ? '' : r[col[k]!]);
  const s = (r: readonly unknown[], k: keyof OsImportRow) => String(g(r, k) ?? '').trim();
  return rows.slice(1).filter((r) => s(r, 'name')).map((r) => ({
    invNo: s(r, 'invNo'), name: s(r, 'name').slice(0, 300), serial: s(r, 'serial'), barcode: s(r, 'barcode'), konto: s(r, 'konto').replace(/\D/g, '') || '0120',
    date: isoDate(g(r, 'date')), cost: Math.round(num(g(r, 'cost')) * 100) / 100, rate: num(g(r, 'rate')),
    supplier: s(r, 'supplier'), invDoc: s(r, 'invDoc'), location: s(r, 'location'), plate: s(r, 'plate'),
  }));
}
