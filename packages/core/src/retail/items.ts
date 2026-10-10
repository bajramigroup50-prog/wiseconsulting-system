/**
 * Item master clean-up (legacy `artQ` 11240–11345, `artNames` 17360, `artKonta` 8445): name normalisation keys,
 * similarity, unit standardisation, abbreviation rules, duplicate / similar / missing-data analysis, the choice of the
 * master item when merging, and the account role of an item.
 */

export interface CleanItem {
  id: string;
  code?: string | null;
  name: string;
  unit?: string | null;
  type?: string | null;
  price?: number | string | null;
  rate?: number | string | null;
  barcodes?: readonly string[];
  aliases?: readonly string[];
  active?: boolean;
  rawK?: string | null;
}

/** Built-in unit synonyms (legacy `ART_UNIT0`). */
export const ART_UNIT0: Readonly<Record<string, string>> = {
  kg: 'кг', 'кгр': 'кг', 'килограм': 'кг', 'килограми': 'кг', kom: 'ком', 'ком.': 'ком', komad: 'ком', pcs: 'ком', pc: 'ком', 'парче': 'ком', 'парчиња': 'ком',
  'бр': 'ком', 'бр.': 'ком', l: 'л', lit: 'л', lt: 'л', 'лит': 'л', 'литар': 'л', 'литри': 'л', m: 'м', 'метар': 'м', 'метри': 'м', m2: 'м2', 'м²': 'м2', m3: 'м3',
  'м³': 'м3', pak: 'пак', 'пакет': 'пак', 'пак.': 'пак', kut: 'кут', 'кутија': 'кут', 'кут.': 'кут', g: 'г', gr: 'г', 'гр': 'г', 'гр.': 'г', ml: 'мл', 'мл.': 'мл',
  t: 'т', 'тон': 'т',
};

const L2C: Readonly<Record<string, string>> = { a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з' };
const LAT2CYR: Readonly<Record<string, string>> = { a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'љ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'њ', x: 'џ', y: 'ѕ', z: 'з', 'ç': 'ч', 'ë': 'е', 'ş': 'ш', 'š': 'ш', 'č': 'ч', 'ć': 'ќ', 'ž': 'ж', 'đ': 'ѓ' };

/** Legacy `toCyr` (7835): Macedonian Latin transcription → Cyrillic (digraphs first). */
export function toCyr(t: string): string {
  const s = String(t ?? '').toLowerCase().replace(/sh/g, 'ш').replace(/zh/g, 'ж').replace(/ch/g, 'ч').replace(/dzh|dž|xh/g, 'џ').replace(/gj/g, 'ѓ')
    .replace(/kj/g, 'ќ').replace(/lj|ll/g, 'љ').replace(/nj/g, 'њ').replace(/dz/g, 'ѕ');
  return [...s].map((c) => LAT2CYR[c] ?? c).join('');
}

export interface ArtRules {
  /** Abbreviation → replacement (firm `artAbbr`). */
  abbr: Readonly<Record<string, string>>;
  /** Unit synonyms, built-in + firm `artUnits` (lower-case keys). */
  units: Readonly<Record<string, string>>;
}

export const artRules = (firmAbbr?: Record<string, string> | null, firmUnits?: Record<string, string> | null): ArtRules =>
  ({ abbr: firmAbbr ?? {}, units: { ...ART_UNIT0, ...(firmUnits ?? {}) } });

/** Standard unit (legacy `artUnit`): known synonym, else the unit as typed (trimmed). */
export function artUnit(u: string | null | undefined, rules: Pick<ArtRules, 'units'>): string {
  const x = String(u ?? '').trim().toLowerCase();
  if (!x) return '';
  if (rules.units[x]) return rules.units[x]!;
  if (Object.values(rules.units).includes(x)) return x;
  return String(u).trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace whole-word abbreviations (legacy `artApplyAbbr`). */
export function artApplyAbbr(name: string, abbr: Readonly<Record<string, string>>): string {
  let s = String(name ?? '');
  for (const [a, b] of Object.entries(abbr ?? {})) {
    if (!a) continue;
    s = s.replace(new RegExp('(^|[\\s(/,-])' + esc(a) + '(?=$|[\\s)/,.-])', 'giu'), (_m, p: string) => p + b);
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Normalised comparison key of an item name (legacy `artKey`): abbreviations, units glued to numbers, Latin → Cyrillic. */
export function artKey(name: string, abbr: Readonly<Record<string, string>> = {}): string {
  let s = artApplyAbbr(String(name ?? '').toLowerCase(), Object.fromEntries(Object.entries(abbr).map(([a, b]) => [a.toLowerCase(), String(b).toLowerCase()])));
  s = s.replace(/(\d)[,.](\d)/g, '$1.$2')
    .replace(/(\d)\s*(kg|кгр|кг)(?![a-zа-шѓќљњџѕј])/g, '$1кг')
    .replace(/(\d)\s*(gr|g|гр|г)\.?(?![a-zа-шѓќљњџѕј])/g, '$1г')
    .replace(/(\d)\s*(ml|мл)(?![a-zа-шѓќљњџѕј])/g, '$1мл')
    .replace(/(\d)\s*(lit|l|лит|л)(?![a-zа-шѓќљњџѕј])/g, '$1л')
    .replace(/(\d)\s*(kom|ком)(?![a-zа-шѓќљњџѕј])/g, '$1ком');
  s = (/[a-z]/.test(s) ? toCyr(s) : s).replace(/[a-z]/g, (c) => L2C[c] ?? c).replace(/[^0-9a-zа-шѓќљњџѕјѐѝ.]+/gi, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

const tok = (k: string) => new Set(k.split(' ').filter(Boolean));

/** Normalised Levenshtein similarity 0..1 (legacy `artLev`). */
export function artLev(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const c = [i];
    for (let j = 1; j <= n; j++) c[j] = Math.min(p[j]! + 1, c[j - 1]! + 1, p[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return 1 - p[n]! / Math.max(m, n);
}

/** Similarity of two keys (legacy `artSim`): 0 when their numbers differ, else max(Jaccard of words, Levenshtein). */
export function artSim(a: string, b: string): number {
  const A = tok(a), B = tok(b);
  const nums = (x: Set<string>) => [...x].filter((t) => /\d/.test(t)).sort().join('|');
  if (nums(A) !== nums(B)) return 0;
  let i = 0;
  for (const t of A) if (B.has(t)) i++;
  return Math.max(i / Math.max(1, A.size + B.size - i), artLev(a, b));
}

/** Key of a pair of item ids, as stored in the firm's "not the same" list (`artIgnore`). */
export const pairKey = (a: string, b: string): string => [a, b].sort().join('|');

export interface ArtFilter { code?: 'all' | 'with' | 'without'; pref?: string }

/** Legacy `artCodeOk`: with/without code, code prefix or numeric range `1000-1999`. */
export function artCodeOk(i: Pick<CleanItem, 'code'>, F: ArtFilter): boolean {
  const c = String(i.code ?? '').trim();
  if (F.code === 'with' && !c) return false;
  if (F.code === 'without' && c) return false;
  const p = String(F.pref ?? '').trim();
  if (!p) return true;
  const r = /^(\d+)\s*-\s*(\d+)$/.exec(p);
  if (r) {
    const n = Number(c.replace(/\D/g, ''));
    return c !== '' && n >= Number(r[1]) && n <= Number(r[2]);
  }
  return c.toLowerCase().startsWith(p.toLowerCase());
}

export interface ArtMissing<T> { i: T; p: string[] }
export interface ArtAnalysis<T extends CleanItem> {
  I: T[];
  /** Groups of the same item: same normalised name, same code or same barcode. */
  groups: T[][];
  /** Similar (not identical) names ≥ 75 %, best first, at most 300. */
  sim: { a: T; b: T; s: number; key: string }[];
  units: Record<string, number>;
  /** Abbreviation-like tokens with their count and an example name. */
  toks: [string, { n: number; ex: string }][];
  miss: ArtMissing<T>[];
}

const fi = (q: number) => String(Math.round(q * 1000) / 1000).replace('.', ',');

/** Legacy `artAnalyze` (11256). `stockOf` = current quantity of an item (all locations). */
export function artAnalyze<T extends CleanItem>(items: readonly T[], rules: ArtRules, opts: { filter?: ArtFilter; ignore?: Iterable<string>; stockOf?: (id: string) => number } = {}): ArtAnalysis<T> {
  const I = items.filter((i) => i.active !== false).filter((i) => artCodeOk(i, opts.filter ?? {}));
  const ign = new Set(opts.ignore ?? []);
  const st = opts.stockOf ?? (() => 0);
  const covered = (groups: T[][], g: T[]) => groups.some((G) => g.every((x) => G.includes(x)));
  const byK: Record<string, T[]> = {};
  for (const i of I) (byK[artKey(i.name, rules.abbr)] ??= []).push(i);
  const groups = Object.values(byK).filter((g) => g.length > 1);
  const byC: Record<string, T[]> = {};
  for (const i of I) {
    const c = String(i.code ?? '').trim();
    if (c) (byC[c] ??= []).push(i);
  }
  for (const g of Object.values(byC)) if (g.length > 1 && !covered(groups, g)) groups.push(g);
  const byB: Record<string, T[]> = {};
  for (const i of I) for (const b of (i.barcodes ?? []).filter(Boolean)) (byB[b] ??= []).push(i);
  for (const g of Object.values(byB)) if (g.length > 1 && !covered(groups, g)) groups.push(g);

  const sim: ArtAnalysis<T>['sim'] = [];
  const blk: Record<string, [T, string][]> = {};
  for (const i of I) {
    const k = artKey(i.name, rules.abbr);
    (blk[k.slice(0, 3)] ??= []).push([i, k]);
  }
  for (const Lb of Object.values(blk)) {
    if (Lb.length > 400) continue;
    for (let a = 0; a < Lb.length; a++) for (let b = a + 1; b < Lb.length; b++) {
      if (Lb[a]![1] === Lb[b]![1]) continue;
      const s = artSim(Lb[a]![1], Lb[b]![1]);
      if (s >= 0.75) {
        const key = pairKey(Lb[a]![0].id, Lb[b]![0].id);
        if (!ign.has(key)) sim.push({ a: Lb[a]![0], b: Lb[b]![0], s, key });
      }
    }
  }
  const units: Record<string, number> = {};
  for (const i of I) {
    const u = String(i.unit ?? '').trim();
    units[u] = (units[u] ?? 0) + 1;
  }
  const toks: Record<string, { n: number; ex: string }> = {};
  for (const i of I) for (const t of String(i.name ?? '').split(/\s+/)) {
    const x = t.replace(/[(),]/g, '');
    if (!x || /\d/.test(x)) continue;
    if (/\.$/.test(x) || (x.length <= 3 && /^[a-zа-ш]+$/i.test(x) && !/^(и|за|со|од|на|во|без|до|по|the|of|for)$/i.test(x))) {
      const k = x.toLowerCase();
      (toks[k] ??= { n: 0, ex: i.name }).n++;
    }
  }
  const miss: ArtMissing<T>[] = [];
  for (const i of I) {
    const p: string[] = [];
    if (![0, 5, 10, 18].includes(Number(i.rate))) p.push('ДДВ стапка');
    if (i.type !== 'service' && !(Number(i.price) > 0)) p.push('продажна цена');
    if (!String(i.unit ?? '').trim()) p.push('единица');
    if (String(i.name ?? '').trim().length < 3) p.push('назив');
    const q = i.type === 'service' ? 0 : st(i.id);
    if (q < -1e-9) p.push('залиха во минус (' + fi(q) + ')');
    if (/\s{2,}/.test(i.name) || i.name !== String(i.name).trim()) p.push('празни места');
    if (i.name.length > 6 && i.name === i.name.toUpperCase() && /[А-ШA-Z]/.test(i.name)) p.push('САМО ГОЛЕМИ БУКВИ');
    const u = artUnit(i.unit, rules);
    if (u && u !== i.unit) p.push('единица „' + i.unit + '“ → „' + u + '“');
    if (p.length) miss.push({ i, p });
  }
  return {
    I, groups, sim: sim.sort((x, y) => y.s - x.s).slice(0, 300), units,
    toks: Object.entries(toks).sort((a, b) => b[1].n - a[1].n).slice(0, 120), miss,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Legacy `artFmt` / `fixName`: abbreviations, collapse spaces, ALL CAPS → Title case (short all-caps words kept). */
export function artFixName(n: string, abbr: Readonly<Record<string, string>> = {}): string {
  let x = artApplyAbbr(n, abbr).replace(/\s{2,}/g, ' ').trim();
  if (x.length > 6 && x === x.toUpperCase() && /[А-ШA-Z]/.test(x)) x = x.split(' ').map((w) => (/\d/.test(w) || (w.length <= 3 && /^[A-ZА-Ш]+$/.test(w)) ? w : cap(w))).join(' ');
  return x;
}

/**
 * Master of a duplicate group (legacy `artPickMaster`): with a code, then more stock moves, then with a barcode, then a
 * Cyrillic name, then the longer name.
 */
export function artPickMaster<T extends CleanItem>(g: readonly T[], movesOf: (id: string) => number): T {
  const b = (x: boolean) => (x ? 1 : 0);
  return [...g].sort((a, c) =>
    b(!!String(c.code ?? '').trim()) - b(!!String(a.code ?? '').trim())
    || movesOf(c.id) - movesOf(a.id)
    || b(!!(c.barcodes ?? []).length) - b(!!(a.barcodes ?? []).length)
    || b(/[а-ш]/i.test(c.name)) - b(/[а-ш]/i.test(a.name))
    || String(c.name).length - String(a.name).length)[0]!;
}

/** Items created by an import with only a code: name `Артикл <code>` (legacy `noNameIt`). */
export const isNoNameItem = (i: Pick<CleanItem, 'name' | 'code'>): boolean =>
  /^Артикл\s/.test(String(i.name ?? '')) && String(i.name).slice(7).trim() === String(i.code ?? '').trim();

/* ---------------- account roles (artKonta) ---------------- */

export const ART_ROLES = [['goods', 'Трговија – стока'], ['material', 'Суровина / материјал'], ['prod', 'Сопствено производство'], ['service', 'Услуга']] as const;
export type ArtRole = (typeof ART_ROLES)[number][0];

/** Legacy `artRole`. */
export function artRole(it: Pick<CleanItem, 'type' | 'rawK'>): ArtRole {
  if (it.type === 'service') return 'service';
  if (String(it.rawK ?? '').trim()) return 'prod';
  if (it.type === 'material') return 'material';
  return 'goods';
}

/** Item fields for a chosen role (legacy `akSave`): type and the raw-material account. */
export function artRoleFields(role: ArtRole, rawK: string): { type: 'service' | 'goods' | 'material' | 'product'; rawAccount: string | null } {
  if (role === 'service') return { type: 'service', rawAccount: null };
  if (role === 'goods') return { type: 'goods', rawAccount: null };
  if (role === 'material') return { type: 'material', rawAccount: null };
  return { type: 'product', rawAccount: rawK };
}
