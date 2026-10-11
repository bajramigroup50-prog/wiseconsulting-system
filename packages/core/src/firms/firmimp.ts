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
  const vat = fimpVatField(x);
  if (vat) return vat;
  const m = FIMP_MAP.find(([k]) => x === k) ?? FIMP_MAP.find(([k]) => x.startsWith(k));
  if (m) return m[1];
  // Headings legacy did not know („Тел.“, „Мобилен“, „Контакт телефон“, „Емаил“, „Е-mail“ with mixed letters, „Електронска пошта“ …).
  const y = x.replace(/[.:\-_/()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/(mail|маил|мејл|имејл|емаил|пошта)/.test(y)) return 'email';
  if (/^(моб|mob|gsm)/.test(y) || /(мобилен|мобилни)/.test(y)) return 'phone2';
  if (/(^|\s)(тел|tel|phone|телефон)/.test(y)) return 'phone';
  if (/^(контакт лице|лице за контакт|одговорно лице|управител|contact)/.test(y)) return 'contact';
  return null;
}

/**
 * VAT headings of other programs, checked before the legacy map (where „Регистриран…“ would hit „рег“ and „Даночен период“
 * would hit „даночен“): „ДДВ“, „ДДВ обврзник“, „Регистриран за ДДВ“, „Период ДДВ“, „Даночен период“, „Месечно/Тромесечно“ …
 */
function fimpVatField(x: string): 'perTxt' | 'ddvTxt' | null {
  const y = x.replace(/[.:\-_/()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/(^|\s)(период|periud|period)/.test(y) && /(ддв|даноч|vat|tvsh|пдв)/.test(y)) return 'perTxt';
  if (/^(месеч|тромесеч|квартал)/.test(y)) return 'perTxt';
  if (/(^|\s)(ддв|vat|tvsh|пдв)(\s|$)/.test(y) || /^ддв/.test(y)) return 'ddvTxt';
  return null;
}

/** VAT period text → code: месечен/месечно/1/month → month, тромесечен/квартален/3/quarter → quarter. */
export function fimpVatPeriod(v: unknown): 'month' | 'quarter' | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/тромес|три мес|квартал|quarter|^q|^3$|tremuj/.test(s)) return 'quarter';
  if (/месеч|мјесеч|month|mujor|^m$|^1$|^12$/.test(s)) return 'month';
  return null;
}

/** VAT flag text → boolean: да/x/1/yes/обврзник → true, не/0/no/неопврзник → false, empty/unknown → null. */
export function fimpVatFlag(v: unknown): boolean | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(не|no|n|0|false|нема|ne|jo)(\s|$|[.,;!])/.test(s) || /^не\s*обврз|^необврз|^нерег/.test(s)) return false;
  if (/^(д|да|y|yes|1|true|x|х|✓|✔|po|обврз|регистр)/.test(s)) return true;
  if (fimpVatPeriod(s)) return true;
  return null;
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
    // A „ДДВ“ column may hold the period itself („месечно“); a period column implies a VAT payer.
    if (f.ddvTxt != null) { const b = fimpVatFlag(f.ddvTxt); const p = fimpVatPeriod(f.ddvTxt); if (b != null) f.ddv = b; if (p && f.perTxt == null) f.per = p; delete f.ddvTxt; }
    if (f.perTxt != null) { const p = fimpVatPeriod(f.perTxt); if (p) { f.per = p; if (f.ddv == null) f.ddv = true; } else if (fimpVatFlag(f.perTxt) === false && f.ddv == null) f.ddv = false; delete f.perTxt; }
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
  // „Даночен број“ matches the legacy heading „даночен бр…“ (the bank's tax no.); with no own ЕДБ column it is the firm's ЕДБ.
  if (!f.edb && f.bankEdb && /^(MK)?\d{13}$/i.test(String(f.bankEdb))) { f = { ...f, edb: String(f.bankEdb).replace(/^MK/i, '') }; delete f.bankEdb; }
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

/**
 * Re-import of an existing firm: empty columns are filled (legacy), and the VAT status / period are UPDATED whenever
 * the file states them, because these columns are never empty on the firm and the file is the newer source.
 */
export function fimpPatch(cur: Record<string, unknown>, cols: FimpFirm['cols']): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cols)) {
    if (v == null || v === '') continue;
    if (k === 'vatRegistered' || k === 'vatPeriod') { if (cur[k] !== v) patch[k] = v; continue; }
    if (cur[k] == null || cur[k] === '') patch[k] = v;
  }
  return patch;
}
