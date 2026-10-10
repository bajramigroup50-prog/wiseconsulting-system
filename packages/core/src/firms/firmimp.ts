/**
 * Firm import from Excel (legacy `FIMP_MAP` / `fimpField` / `fimpRead` / `fimpFind` 8843–8848): columns are recognised
 * by their heading; existing firms (same ЕДБ, ЕМБС or name) only get their empty fields filled.
 */
export const FIMP_MAP: readonly (readonly [string, string])[] = [
  ['име на фирма', 'name'], ['назив', 'name'], ['година', 'curYear'], ['родител', 'parent'], ['дополн', 'bank2'], ['доп. жиро', 'bank2'], ['реална', 'realBank'],
  ['жиро с-ка на', 'bankAcc'], ['жиро сметка', 'bank'], ['жиро', 'bank'], ['правна форма', 'lf'], ['дејност', 'activity'], ['ф/стд', 'ftype'], ['заклуч', 'closedFlag'],
  ['матичен', 'embs'], ['рег', 'regNo'], ['даночен бр', 'bankEdb'], ['даночен', 'edb'], ['едб', 'edb'], ['адреса', 'address'], ['телефон', 'phone'], ['факс', 'fax'],
  ['доп. банка', 'bankName2'], ['банка', 'bankName'], ['код за', 'payCode'], ['депозитор', 'depositor'], ['општина2', 'opstina2'], ['општина 2', 'opstina2'],
  ['општина за', 'opstinaOther'], ['општина', 'opstina'], ['шифри во', 'codesIn'], ['лице за', 'contact'], ['е-маил', 'email'], ['e-mail', 'email'], ['email', 'email'],
  ['град', 'city'], ['шифра', 'code'], ['ддв период', 'perTxt'], ['ддв', 'ddvTxt'], ['е-пошта', 'email'],
];

/** Legacy `fimpField`: exact heading first, then "starts with". */
export function fimpField(hd: unknown): string | null {
  const x = String(hd ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!x) return null;
  const m = FIMP_MAP.find(([k]) => x === k) ?? FIMP_MAP.find(([k]) => x.startsWith(k));
  return m ? m[1] : null;
}

export type FimpRecord = Record<string, string | boolean>;
export interface FimpRow { f: FimpRecord; ex: string }

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Legacy `fimpRead` on a sheet as rows of cells: header row = the first with a name column. */
export function fimpParse(rows: readonly (readonly unknown[])[]): { cols: string[]; L: FimpRecord[] } | { error: string } {
  const hi = rows.findIndex((r) => r.some((x) => fimpField(x) === 'name'));
  if (hi < 0) return { error: 'Не е пронајдена колона „Име на фирма“ / „Назив“.' };
  const H = rows[hi]!.map(fimpField);
  const L: FimpRecord[] = [];
  for (const r of rows.slice(hi + 1)) {
    const f: FimpRecord = {};
    H.forEach((k, i) => { if (!k) return; const v = String(r[i] ?? '').trim(); if (v && f[k] == null) f[k] = v; });
    if (!f.name) continue;
    for (const k of ['edb', 'embs', 'bank', 'bank2', 'realBank', 'bankAcc', 'bankEdb']) if (f[k]) f[k] = String(f[k]).replace(/\s/g, '');
    if (f.ddvTxt != null) { f.ddv = /^(д|да|y|yes|1|true)/i.test(String(f.ddvTxt)); delete f.ddvTxt; }
    if (f.perTxt != null) { f.per = /мес|month/i.test(String(f.perTxt)) ? 'month' : 'quarter'; delete f.perTxt; }
    L.push(f);
  }
  if (!L.length) return { error: 'Нема фирми во датотеката.' };
  return { cols: [...new Set(H.filter((x): x is string => !!x))], L };
}

/** Legacy `fimpFind`: same ЕДБ or ЕМБС, otherwise same name (case-insensitive). */
export function fimpFind<T extends { id: string; name: string; edb: string | null; embs: string | null }>(f: FimpRecord, firms: readonly T[]): T | undefined {
  const e = digits(f.edb), m = digits(f.embs), n = String(f.name ?? '').trim().toLowerCase();
  return firms.find((x) => (e && digits(x.edb) === e) || (m && digits(x.embs) === m)) ?? firms.find((x) => n && x.name.trim().toLowerCase() === n);
}

/** Legal-form text of the other program → code (`dooel`, `doo`, `ad`, `jtd`, `tp`, `zdr`, …). */
export function fimpLegalForm(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/дооел|dooel/.test(s)) return 'dooel';
  if (/доо|doo/.test(s)) return 'doo';
  if (/^ад\b|акционер/.test(s)) return 'ad';
  if (/јтд|кд|командит|јавно трговско/.test(s)) return 'jtd';
  if (/^тп|трговец поединец/.test(s)) return 'tp';
  if (/здруж/.test(s)) return 'zdr';
  if (/фонд/.test(s)) return 'fon';
  if (/адвокат/.test(s)) return 'adv';
  if (/нотар/.test(s)) return 'not';
  if (/занает/.test(s)) return 'zan';
  return null;
}

export interface FimpFirm {
  cols: { name: string; code: string | null; legalForm: string | null; edb: string | null; embs: string | null; address: string | null; city: string | null; phone: string | null; email: string | null; activity: string | null; vatRegistered: boolean | null; vatPeriod: 'month' | 'quarter' | null };
  /** Into `firms.settings`. */
  settings: Record<string, string>;
}

const COLS = new Set(['name', 'code', 'lf', 'edb', 'embs', 'address', 'city', 'phone', 'email', 'activity', 'ddv', 'per']);

/** One imported record → firm columns + settings (bank account etc.). */
export function fimpToFirm(f: FimpRecord): FimpFirm {
  const s = (k: string) => (f[k] == null || f[k] === '' ? null : String(f[k]).trim().slice(0, 300));
  const e = digits(f.edb);
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (COLS.has(k) || v === '' || v == null) continue;
    settings[k === 'bank' ? 'bankAccount' : k] = String(v).slice(0, 300);
  }
  return {
    cols: {
      name: String(f.name).trim().slice(0, 300), code: s('code'), legalForm: fimpLegalForm(f.lf), edb: e.length === 13 ? e : s('edb'),
      embs: digits(f.embs) || null, address: s('address'), city: s('city'), phone: s('phone'), email: s('email'), activity: s('activity'),
      vatRegistered: typeof f.ddv === 'boolean' ? f.ddv : null, vatPeriod: f.per === 'month' || f.per === 'quarter' ? f.per : null,
    },
    settings,
  };
}

/** Template headings for the "⬇ Excel образец" download. */
export const FIMP_TEMPLATE = ['Шифра', 'Име на фирма', 'Правна форма', 'ЕДБ', 'Матичен број', 'Адреса', 'Град', 'Телефон', 'Е-пошта', 'Дејност', 'Жиро сметка', 'Банка', 'Лице за контакт', 'ДДВ (да/не)', 'ДДВ период (месечно/тромесечно)'];
