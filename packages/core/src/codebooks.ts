/**
 * Codebooks (Шифрарници) — legacy `CB` 6947, `cbRows` 6965, `cbList` 6966, `cbSave` 7369, `cbDelRow` 14291,
 * `VIEWS.sifrarnik` 6984, `VIEWS.tarifi` / `VIEWS.terkovi` 6975–6976, `cenPdf` 7371.
 *
 * Pure definitions and helpers; persistence is the `codes` table (`@wise/db` `codebooks.ts`).
 * Server change vs legacy: `city`, `municipality` and `country` are office-wide lists (`firm_id IS NULL`, seeded
 * cities), edited with the `settings` permission; every other codebook belongs to the current firm. Rows of the
 * office-wide list are also shown (read-only for `write`) in the per-firm lists that fall back to them
 * (`currency`, `paysif`).
 */

export type CbFieldType = 'text' | 'num' | 'date';
export type CbField = readonly [key: string, label: string, type?: CbFieldType];
export interface CbDef { t: string; f: readonly CbField[] }

export const CB = {
  cenovnik: { t: 'Ценовници', f: [['code', 'Шифра'], ['name', 'Назив'], ['date', 'Важи од', 'date'], ['rabat', 'Рабат %', 'num'], ['note', 'Забелешка']] },
  store: { t: 'Продавници', f: [['code', 'Шифра'], ['name', 'Назив'], ['address', 'Адреса'], ['konto', 'Конто залиха (празно = од шемата)'], ['kMarg', 'Конто разлика во цена'], ['kVat', 'Конто вкалкулиран ДДВ']] },
  warehouse: { t: 'Магацини', f: [['code', 'Шифра'], ['name', 'Назив'], ['address', 'Адреса'], ['konto', 'Конто залиха (празно = од шемата)'], ['kMarg', 'Конто разлика во цена'], ['kVat', 'Конто вкалкулиран ДДВ']] },
  cash: { t: 'Благајни', f: [['code', 'Шифра'], ['name', 'Назив'], ['konto', 'Конто']] },
  oe: { t: 'Организациони единици (ОЕ)', f: [['code', 'Шифра'], ['name', 'Назив']] },
  vehicle: { t: 'Возила', f: [['code', 'Рег. број'], ['name', 'Марка / модел'], ['driver', 'Возач']] },
  location: { t: 'Локации', f: [['code', 'Шифра'], ['name', 'Назив'], ['address', 'Адреса']] },
  route: { t: 'Дистрибуција', f: [['code', 'Шифра'], ['name', 'Линија / рута'], ['note', 'Опис']] },
  position: { t: 'Работни места', f: [['code', 'Шифра'], ['name', 'Назив'], ['nkz', 'Шифра по НКЗ'], ['coef', 'Коефициент', 'num']] },
  paysif: { t: 'Шифри на ставки за плата', f: [['code', 'Шифра'], ['name', 'Опис'], ['cat', 'Тип (reg/dop/bol/odm/kor/sin)'], ['pct', 'Процент', 'num'], ['payer', 'На товар на'], ['mpin', 'МПИН шифра'], ['basis', 'Законски основ']] },
  city: { t: 'Шифрарник на градови', f: [['code', 'Шифра'], ['name', 'Град / место'], ['postal', 'Поштенски број'], ['muni', 'Општина']] },
  municipality: { t: 'Општини', f: [['code', 'Шифра'], ['name', 'Назив']] },
  currency: { t: 'Странски валути', f: [['code', 'Ознака (EUR…)'], ['name', 'Назив'], ['rate', 'Курс НБРСМ', 'num'], ['date', 'На ден', 'date']] },
  fgroup: { t: 'Групи финансови книжења', f: [['code', 'Шифра'], ['name', 'Назив']] },
  country: { t: 'Држави', f: [['code', 'Ознака'], ['name', 'Назив']] },
  hall: { t: 'Сали', f: [['code', 'Шифра'], ['name', 'Назив'], ['location', 'Локација']] },
} as const satisfies Record<string, CbDef>;

export type CbKey = keyof typeof CB;
export const CB_KEYS = Object.keys(CB) as CbKey[];
export const isCbKey = (k: unknown): k is CbKey => typeof k === 'string' && Object.hasOwn(CB, k);

/** Office-wide codebooks (stored with `firm_id IS NULL`). */
export const CB_GLOBAL: ReadonlySet<CbKey> = new Set<CbKey>(['city', 'municipality', 'country']);
export const cbIsGlobal = (k: CbKey) => CB_GLOBAL.has(k);
/** The permission needed to change a codebook row (legacy `cbSave` needs `write`; office-wide lists need `settings`). */
export const cbPerm = (k: CbKey, global: boolean): 'write' | 'settings' => (global || cbIsGlobal(k) ? 'settings' : 'write');

/** A codebook row as the UI sees it: `code` / `name` columns plus the type-specific fields from `data`. */
export interface CbRow { id: string; code: string | null; name: string; global: boolean; data: Record<string, unknown> }

/** Value of a field of a row (`code` / `name` are columns, the rest live in `data`). */
export const cbVal = (r: Pick<CbRow, 'code' | 'name' | 'data'>, f: string): unknown => (f === 'code' ? r.code : f === 'name' ? r.name : r.data[f]);

/** Legacy `cbRows` order: by code (or name), Macedonian collation, numeric. */
export function cbSort<T extends { code?: string | null; name?: string | null }>(rows: readonly T[]): T[] {
  const key = (x: T) => String(x.code || x.name || '');
  return [...rows].sort((a, b) => key(a).localeCompare(key(b), 'mk', { numeric: true }));
}

export interface CbInput { code: string | null; name: string; data: Record<string, string | number> }

/**
 * Legacy `cbSave`: read each field (numbers: '' stays empty), trim text, require a code or a name.
 * Returns an error message instead of the input when invalid.
 */
export function cbInput(k: CbKey, raw: Readonly<Record<string, unknown>>): CbInput | { error: string } {
  const D: CbDef = CB[k];
  const data: Record<string, string | number> = {};
  let code: string | null = null, name = '';
  for (const [f, , type] of D.f) {
    const s = String(raw[f] ?? '').trim();
    if (f === 'code') { code = s || null; continue; }
    if (f === 'name') { name = s; continue; }
    if (type === 'num') {
      if (s === '') continue;
      const n = Number(s.replace(',', '.'));
      if (!Number.isFinite(n)) return { error: `„${D.f.find((x) => x[0] === f)![1]}“ мора да биде број.` };
      data[f] = n;
    } else if (type === 'date') {
      if (s === '') continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'Неважечки датум.' };
      data[f] = s;
    } else if (s) data[f] = s;
  }
  if (!name && !code) return { error: 'Внесете шифра или назив.' };
  if (k === 'paysif' && data.cat && !['reg', 'dop', 'bol', 'odm', 'kor', 'sin'].includes(String(data.cat))) {
    return { error: 'Тип: reg, dop, bol, odm, kor или sin.' };
  }
  if (k === 'currency' && code) code = code.toUpperCase();
  return { code, name, data };
}

/** Next free numeric code (legacy `nextCode`), keeping zero padding. */
export function cbNextCode(existing: readonly (string | null | undefined)[]): string {
  const L = existing.map((x) => String(x ?? '').trim()).filter((v) => /^\d+$/.test(v));
  let w = 0, mx = 0;
  for (const v of L) { mx = Math.max(mx, +v); if (v.length > 1 && v[0] === '0') w = Math.max(w, v.length); }
  const n = mx + 1;
  return w ? String(n).padStart(w, '0') : String(n);
}

/** Legacy `CB_COLN` 14290 — where a code is used, by table. */
export const CB_USAGE_LABEL: Record<string, string> = {
  purchases: 'влезни фактури', invoices: 'излезни фактури', sales_daily: 'каса / продажба', stock_moves: 'магацински движења',
  levelling_docs: 'нивелации', transfers: 'преноси', stock_counts: 'пописи', production_orders: 'работни налози',
  supplier_credits: 'одобренија од добавувачи', journal_lines: 'налози',
};

/** The message legacy `cbDelRow` shows when a code is still in use. */
export function cbUsageMessage(name: string, usage: Readonly<Record<string, number>>): string | null {
  const E = Object.entries(usage).filter(([, n]) => n > 0);
  if (!E.length) return null;
  return `„${name}“ не може да се избрише – се користи во ${E.map(([t, n]) => `${n} ${CB_USAGE_LABEL[t] ?? t}`).join(', ')}.`;
}

/* ---------------- Сите шифрарници (legacy `VIEWS.sifrarnik` 6984) ---------------- */

/** [group, [view id, label]] — `cb_*` are the codebook editors; other ids are existing screens. */
export const SIFRARNIK_GROUPS: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  ['Артикли и партнери', [['artikli', 'Производи'], ['cb_cenovnik', 'Ценовници'], ['partneri', 'Комитенти'], ['uslugiS', 'Услуги']]],
  ['Објекти', [['cb_store', 'Продавници'], ['cb_warehouse', 'Магацини'], ['cb_cash', 'Благајни'], ['cb_oe', 'Организациони единици (ОЕ)'], ['cb_vehicle', 'Возила'], ['cb_location', 'Локации']]],
  ['Луѓе и дистрибуција', [['cb_route', 'Дистрибуција'], ['vraboteni', 'Вработени'], ['cb_position', 'Работни места']]],
  // FIX: legacy listed `terkovi` twice („Теркови за книжење“ / „… за финансово“) — same screen, shown once.
  ['Сметководство', [['tarifi', 'Даночни тарифи'], ['konto', 'Контен план'], ['terkovi', 'Теркови за книжење']]],
  ['Финансии и општо', [['banke', 'Банки'], ['cb_city', 'Градови'], ['cb_municipality', 'Општини'], ['cb_currency', 'Странски валути'], ['cb_fgroup', 'Групи финансови книжења'], ['cb_country', 'Држави'], ['cb_hall', 'Сали']]],
];

/** Screens reachable only from „Сите шифрарници“ (not in the menu); they inherit its permission. */
export const SIFRARNIK_SUBVIEWS: readonly string[] = [...CB_KEYS.map((k) => `cb_${k}`), 'tarifi', 'terkovi', 'uslugiS', 'banke'];

/** Legacy `VIEWS.tarifi` 6975: VAT tariffs with their accounts and ДДВ-04 fields. */
export const TARIFI: readonly (readonly [string, string, string, string, string, string])[] = [
  ['А', '18%', 'Општа стапка', '2300', '1300', '01/02 · 21/22'],
  ['Б', '10%', 'Угостителство и др. повластени', '2301', '1301', '03/04'],
  ['В', '5%', 'Храна, лекови, книги и др. повластени', '2302', '1302', '05/06'],
  ['Г', '0%', 'Извоз / ослободен промет', '—', '—', '07 / 08 / 09'],
  ['Чл. 32-а', '18% пренесен', 'Градежништво – пренесување на даночна обврска', '2309', '1309', '11 · 16/17 · 25/26'],
];

/** Legacy `VIEWS.terkovi` 6976: how each document is posted. */
export const TERKOVI: readonly (readonly [string, string])[] = [
  ['Излезна фактура', 'Должи 1200 (купувач) / Побарува 74xx приход и 230x ДДВ'],
  ['Излезна фактура чл. 32-а', 'Должи 1200 / Побарува 7460 (без ДДВ)'],
  ['Книжно одобрение', 'Должи 74xx и 230x / Побарува 1200'],
  ['Излез од залиха (продажба)', 'Должи 7000/7010 / Побарува 6300/6600 по просечна цена'],
  ['Влезна фактура', 'Должи 3100/4000/41xx/6600 и 130x ДДВ / Побарува 2200 (добавувач)'],
  ['Влезна фактура чл. 32-а', 'Должи трошок и 1309 / Побарува 2200 и 2309'],
  ['Извод – прилив', 'Должи банка (100005…) / Побарува 1200 или конто по правило'],
  ['Извод – одлив', 'Должи 2200 или конто по правило / Побарува банка'],
  ['Девизен извод', 'како горе + 4810 / 7810 курсни разлики'],
  ['Каса – дневен промет', 'Должи 1020 / Побарува 74xx и 230x'],
  ['Плати', 'Должи 4200 / Побарува 2400 нето, 2410–2413 придонеси, 2420 данок'],
  ['Производство', 'Должи 6000 / Побарува 3100 материјал и 4900 труд; Должи 6300 / Побарува 6000'],
  ['Амортизација', 'Должи 4300 / Побарува 0190'],
  ['Камата', 'Должи 1200 / Побарува 7800'],
  ['Затворање на година', 'класи 4 и 7 → 8000; 8100/2340 данок; 8200 → 9500 / 9600'],
];

/* ---------------- Ценовник (legacy `cenPdf` 7371) ---------------- */

export interface PriceListItem { code: string | null; name: string; unit: string | null; price: number; rate: number }
export interface PriceListRow extends PriceListItem { net: number; gross: number }

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Rows of the printed price list: price after the list's discount, then with VAT; items sorted by code/name. */
export function priceListRows(items: readonly PriceListItem[], rabat: number): PriceListRow[] {
  const rb = Number.isFinite(rabat) ? rabat : 0;
  return [...items]
    .sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name), 'mk', { numeric: true }))
    .map((i) => { const net = r2((i.price || 0) * (1 - rb / 100)); return { ...i, net, gross: r2(net * (1 + (i.rate || 0) / 100)) }; });
}
