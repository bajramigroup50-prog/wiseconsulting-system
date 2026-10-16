/**
 * ⚖ Правен асистент — the stored law corpus (pure, no I/O): the key laws the office works with, where their official
 * consolidated texts are published, segmentation of a text into articles (член / став), the search normalisation
 * (lower case, crude Macedonian / Albanian stemming for the `simple` full-text index), article references in a
 * question („чл. 14 ст. 2 ЗДДВ“), and the word diff of two versions of an article.
 *
 * Free: no model is involved anywhere in this file.
 */
import { UJP_U } from './ujp';

export interface LawCorpusSource {
  /** Official listing page (ujp.gov.mk, finance.gov.mk, …) that links the consolidated text. */
  url: string;
  /** Link text that identifies the law's text on that page. */
  pick: RegExp;
}

export interface LawCorpusEntry {
  /** Stable key stored on `law_texts.law`. */
  k: string;
  /** Short name used in citations („ЗДДВ“). */
  abbr: string;
  /** Full name. */
  n: string;
  /** Kind: law or by-law (правилник / уредба). */
  kind: 'zakon' | 'pravilnik';
  /** Official pages the robot reads (no source = office imports the text by link or paste). */
  src: readonly LawCorpusSource[];
  /** Words in a question that point to this law (also matched against the abbreviation). */
  kw: RegExp;
  /** Where to find it by hand. */
  home: string;
}

const SV = 'https://www.slvesnik.com.mk/besplatni-izdanija.nspx';
const ujp = (t: string) => UJP_U + 'pregled/tipovi/' + t;

/** The key laws (owner list). Texts come from the official sources; the ones without a robot source are imported by link / paste. */
export const LAW_CORPUS: readonly LawCorpusEntry[] = [
  { k: 'zddv', abbr: 'ЗДДВ', n: 'Закон за данокот на додадена вредност', kind: 'zakon', src: [{ url: ujp('ddv'), pick: /закон\w* за данокот на додадена вредност/i }], kw: /ддв|додадена вредност|tvsh|vler(ës|es) s(ë|e) shtuar|аванс/i, home: ujp('ddv') },
  { k: 'pddv', abbr: 'Правилник ЗДДВ', n: 'Правилник за спроведување на Законот за данокот на додадена вредност', kind: 'pravilnik', src: [{ url: ujp('ddv'), pick: /правилник\w* за (спроведување|примена)[\s\S]*додадена вредност/i }], kw: /правилник[\s\S]{0,40}ддв|rregullore[\s\S]{0,40}tvsh/i, home: ujp('ddv') },
  { k: 'zdp', abbr: 'ЗДП', n: 'Закон за даночна постапка', kind: 'zakon', src: [{ url: UJP_U + 'opis/97', pick: /даночна постапка/i }, { url: ujp('drugo'), pick: /закон\w* за даночна(та)? постапка/i }], kw: /даночна постапка|застареност|камата|procedur(ë|e)s tatimore/i, home: UJP_U + 'opis/97' },
  { k: 'zdd', abbr: 'ЗДД', n: 'Закон за данокот на добивка', kind: 'zakon', src: [{ url: ujp('dd'), pick: /закон\w* за данокот на добивка/i }], kw: /данок на добивка|данокот на добивка|непризнат|tatim(i|it) mbi fitimin/i, home: ujp('dd') },
  { k: 'zpdd', abbr: 'ЗПДД', n: 'Закон за персоналниот данок на доход', kind: 'zakon', src: [{ url: ujp('pd'), pick: /закон\w* за персонал/i }], kw: /персонал|личен доход|tatim(i|it) personal/i, home: ujp('pd') },
  { k: 'zpri', abbr: 'ЗПЗСО', n: 'Закон за придонеси од задолжително социјално осигурување', kind: 'zakon', src: [{ url: ujp('pridonesi'), pick: /закон\w* за придонеси/i }], kw: /придонес|kontribut/i, home: ujp('pridonesi') },
  { k: 'zrgp', abbr: 'ЗРГП', n: 'Закон за регистрирање на готовинските плаќања', kind: 'zakon', src: [{ url: ujp('fis'), pick: /готовинск/i }], kw: /фискал|готовинск|pagesa(t)? n(ë|e) para|fiskal/i, home: ujp('fis') },
  { k: 'zro', abbr: 'ЗРО', n: 'Закон за работните односи', kind: 'zakon', src: [], kw: /работн\w* однос|отказ|годишен одмор|marr(ë|e)dh(ë|e)nie(t)? e pun(ë|e)s/i, home: SV },
  { k: 'ztd', abbr: 'ЗТД', n: 'Закон за трговските друштва', kind: 'zakon', src: [], kw: /трговск\w* друштв|управител|дивиденд|shoq(ë|e)ri(t)? tregtare/i, home: SV },
  { k: 'zvsr', abbr: 'ЗВСР', n: 'Закон за вршење сметководствени работи', kind: 'zakon', src: [], kw: /сметководствен\w* работ|сметководител|kontabilist/i, home: SV },
  { k: 'zsppft', abbr: 'ЗСППФТ', n: 'Закон за спречување перење пари и финансирање тероризам', kind: 'zakon', src: [], kw: /перење пари|ззспп|зсппфт|pastrim(i|it) e parave/i, home: SV },
  { k: 'zin', abbr: 'ЗИН', n: 'Закон за инспекциски надзор', kind: 'zakon', src: [], kw: /инспекциск|инспектор|mbik(ë|e)qyrj/i, home: SV },
  { k: 'zoup', abbr: 'ЗОУП', n: 'Закон за општата управна постапка', kind: 'zakon', src: [], kw: /управна постапка|жалба|procedur(ë|e)s administrative/i, home: SV },
  { k: 'zus', abbr: 'ЗУС', n: 'Закон за управните спорови', kind: 'zakon', src: [], kw: /управн\w* спор|тужба|kontest/i, home: SV },
  // procedural law of a misdemeanour payment order („📑 Контроли и решенија“ — приговор / барање за судско одлучување)
  { k: 'zprek', abbr: 'ЗП', n: 'Закон за прекршоците', kind: 'zakon', src: [], kw: /прекрш|платен налог|kundërvajtje/i, home: SV },
  { k: 'zzlp', abbr: 'ЗЗЛП', n: 'Закон за заштита на личните податоци', kind: 'zakon', src: [], kw: /лични податоци|gdpr|t(ë|e) dh(ë|e)nave personale/i, home: SV },
];

export const LAW_BY_KEY: Readonly<Record<string, LawCorpusEntry>> = Object.fromEntries(LAW_CORPUS.map((l) => [l.k, l]));
export const lawName = (k: string): string => LAW_BY_KEY[k]?.n ?? k;
export const lawAbbr = (k: string): string => LAW_BY_KEY[k]?.abbr ?? k;

/* ---------------- text → articles ---------------- */

export interface LawArticleSeg {
  /** Article number as printed, normalised („14“, „12-а“). */
  no: string;
  /** Numeric part for ordering. */
  num: number;
  /** Position in the text (0-based). */
  ord: number;
  heading: string | null;
  body: string;
}

const LAT2CYR: Record<string, string> = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'ц' };

/** „12 - a“, „12а“, „12-A“ → „12-а“ (Cyrillic letter); „14.“ → „14“. */
export function normArtNo(s: string): string {
  const m = /^\s*(\d{1,4})\s*(?:[-–]?\s*([a-zа-шѓќљњџѕј]))?\s*\.?\s*$/i.exec(s);
  if (!m) return s.trim();
  const l = m[2]?.toLowerCase();
  return l ? `${+m[1]!}-${LAT2CYR[l] ?? l}` : String(+m[1]!);
}

const ART_LINE = /^\s*(?:Член|ЧЛЕН|Neni|NENI)\s+(\d{1,4}(?:\s*[-–]?\s*[a-zа-шѓќљњџѕјA-ZА-Ш])?)\s*\.?\s*$/;
/** „Член 5“ followed on the same line by the text (some PDFs). */
const ART_INLINE = /^\s*(?:Член|ЧЛЕН|Neni|NENI)\s+(\d{1,4}(?:-[a-zа-ш])?)\s{2,}(\S[\s\S]*)$/;

const isHeading = (l: string) => {
  const s = l.trim();
  return s.length > 1 && s.length <= 140 && !/[.;:,]$/.test(s) && !/^\(\d+\)/.test(s) && !/^\d+\)/.test(s) && !ART_LINE.test(s);
};

/**
 * Split a law's text into articles. An article starts at a line „Член N“ (or Albanian „Neni N“); the short line just
 * before it (no final punctuation) is its heading. Text before the first article (title, gazette list) is dropped.
 * A repeated article number (amending provisions quoted in the text) keeps the first occurrence's number with a
 * suffix-free duplicate dropped — the consolidated text holds every article once.
 */
export function segmentArticles(text: string): LawArticleSeg[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: LawArticleSeg[] = [];
  let cur: { no: string; heading: string | null; body: string[] } | null = null;
  let prevBuf: string[] = [];
  const flush = () => {
    if (!cur) return;
    const body = cur.body.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (body) out.push({ no: cur.no, num: parseInt(cur.no, 10) || 0, ord: out.length, heading: cur.heading, body });
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const m = ART_LINE.exec(line) ?? ART_INLINE.exec(line);
    if (m) {
      // heading = last non-empty line of the previous body / preamble when it looks like a title
      const buf: string[] = cur ? (cur as { body: string[] }).body : prevBuf;
      let i = buf.length - 1;
      while (i >= 0 && !buf[i]!.trim()) i--;
      let heading: string | null = null;
      if (i >= 0 && isHeading(buf[i]!) && (i === 0 || !buf[i - 1]!.trim() || /[.;:]$/.test(buf[i - 1]!.trim()) || isHeading(buf[i - 1]!))) {
        heading = buf[i]!.trim();
        buf.splice(i, 1);
      }
      flush();
      cur = { no: normArtNo(m[1]!), heading, body: m[2] ? [m[2]] : [] };
      continue;
    }
    if (cur) cur.body.push(line); else prevBuf.push(line);
  }
  flush();
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.no) ? false : (seen.add(a.no), true))).map((a, i) => ({ ...a, ord: i }));
}

/** Paragraphs (ставови) of an article: „(1) …“, „(2) …“; an article without markers is one paragraph. */
export function articleParas(body: string): { no: string; text: string }[] {
  const parts = body.split(/\n?(?=^\s*\(\d{1,3}\)\s)/m).map((s) => s.trim()).filter(Boolean);
  const P = parts.map((p) => { const m = /^\((\d{1,3})\)\s*([\s\S]*)$/.exec(p); return m ? { no: m[1]!, text: m[2]!.trim() } : { no: '', text: p }; });
  if (P.length > 1 && !P[0]!.no) { P[1] = { ...P[1]!, text: P[0]!.text + '\n' + P[1]!.text }; P.shift(); }
  return P.length ? P : [{ no: '', text: body.trim() }];
}

/** Gazette references in a text („бр. 44/1999“) → unique „44/1999“ in order of appearance. */
export function gazetteRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/бр(?:ој|\.)\s*((?:\d{1,3}\s*\/\s*(?:19|20)\d{2}(?:\s*(?:,|и|;)\s*)?)+)/gi)) {
    for (const x of m[1]!.matchAll(/(\d{1,3})\s*\/\s*((?:19|20)\d{2})/g)) {
      const r = `${+x[1]!}/${x[2]}`;
      if (!out.includes(r)) out.push(r);
    }
  }
  return out;
}

/** Version date of a consolidated text: a date in the title / file name / first lines („…30.12.2025.pdf“), else null. */
export function lawTextDate(...hints: (string | null | undefined)[]): string | null {
  for (const h of hints) {
    if (!h) continue;
    const s = decodeURIComponentSafe(h).slice(0, 1500);
    const m = /(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})/.exec(s);
    if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    const i = /((?:19|20)\d{2})-(\d{2})-(\d{2})/.exec(s);
    if (i) return i[0];
  }
  return null;
}
function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

/** Stable content hash (FNV-1a 64 as hex) of the normalised text — a new version is stored only when it changes. */
export function lawTextHash(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + s.length.toString(16);
}

/* ---------------- search normalisation ---------------- */

const STOP = new Set(('и или на во за од со до по при не да ли се што кој која кое кои дали оваа овој ова тоа тој таа нив нѐ ги го ја е беше треба требаше може мора '
  + 'ако како каде кога дека ние вие тие сум си сме сте се чл член став ставот законот закон точка '
  + 'dhe ose n ne në për nga me deri te të që cili cila çfarë a duhet mund është ishte nëse si ku kur se ne ju ata neni nenit ligji ligjit pika').split(' '));

/** Lower case + only letters / digits (the stored `norm` column and the query use the same function). */
export const lawSearchNorm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-шѓќљњџѕјçëšžđć]+/gi, ' ').replace(/\s+/g, ' ').trim();

/** Crude stem: long words lose their ending (авансот → аванс, пресмета → пресме, плаќања → плаќа). */
export function lawStem(w: string): string {
  if (/^\d/.test(w)) return w;
  if (w.length >= 7) return w.slice(0, w.length - 2);
  if (w.length >= 5) return w.slice(0, w.length - 1);
  return w;
}

/** Search terms of a question (stop words dropped, stemmed, unique, at most 12). */
export function lawTerms(q: string): string[] {
  const out: string[] = [];
  for (const w of lawSearchNorm(q).split(' ')) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    const s = lawStem(w);
    if (!out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

/** `to_tsquery('simple', …)` text: prefix match of every term, OR-ed (ranking orders by how many match). */
export const lawTsQuery = (terms: readonly string[]): string => terms.map((t) => t.replace(/[^0-9a-zа-шѓќљњџѕјçëšžđć]/gi, '')).filter(Boolean).map((t) => `${t}:*`).join(' | ');

/* ---------------- references in a question ---------------- */

export interface LawRef { law: string | null; art: string; para: string | null }

/** Laws a question points to (abbreviation or keywords). */
export function lawsInText(q: string): string[] {
  const out: string[] = [];
  for (const l of LAW_CORPUS) {
    const ab = new RegExp(`(^|[^\\p{L}])${l.abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u');
    if (ab.test(q) || l.kw.test(q)) out.push(l.k);
  }
  // „Правилник … ДДВ“ also mentions ДДВ: keep both
  return out;
}

/** Article references: „чл. 14 ст. 2“, „член 12-а“, „neni 5 paragrafi 1“ with the nearest law abbreviation after it. */
export function articleRefs(q: string): LawRef[] {
  const out: LawRef[] = [];
  const re = /(?:чл(?:ен)?\.?|neni|nenin|nenit)\s*(\d{1,4}(?:\s*-\s*[a-zа-ш]|[а-ш](?![а-ш]))?)(?:\s*,?\s*(?:ст(?:ав)?\.?|paragraf(?:i|in)?)\s*(\d{1,3}))?(?:\s*(?:од|на|i|të|e)?\s*(?:законот\s+за\s+)?([А-ЯЃЌЉЊЏЅЈA-Z][А-ЯЃЌЉЊЏЅЈA-Za-zа-ш]{1,8}))?/gi;
  for (const m of q.matchAll(re)) {
    const abbr = m[3] ? LAW_CORPUS.find((l) => l.abbr.toLowerCase() === m[3]!.toLowerCase())?.k ?? null : null;
    out.push({ law: abbr, art: normArtNo(m[1]!.replace(/\s+/g, '')), para: m[2] ?? null });
  }
  return out;
}

/* ---------------- version → version ---------------- */

export interface DiffSeg { t: 'eq' | 'add' | 'del'; s: string }

const tokens = (s: string) => s.replace(/\s+/g, ' ').trim().split(/(\s)/).filter((x) => x !== '');

/** Word diff (LCS) of two texts; very long texts fall back to a line diff. Adjacent segments of one kind are merged. */
export function lawDiff(a: string, b: string): DiffSeg[] {
  let A = tokens(a), B = tokens(b);
  let sep = '';
  if (A.length * B.length > 3_000_000) { A = a.split('\n'); B = b.split('\n'); sep = '\n'; }
  const n = A.length, m = B.length;
  // LCS table (Uint32 rows)
  const T: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i]![j] = A[i] === B[j] ? T[i + 1]![j + 1]! + 1 : Math.max(T[i + 1]![j]!, T[i]![j + 1]!);
  const out: DiffSeg[] = [];
  const push = (t: DiffSeg['t'], s: string) => { const l = out[out.length - 1]; if (l && l.t === t) l.s += sep + s; else out.push({ t, s }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('eq', A[i]!); i++; j++; }
    else if (T[i + 1]![j]! >= T[i]![j + 1]!) push('del', A[i++]!);
    else push('add', B[j++]!);
  }
  while (i < n) push('del', A[i++]!);
  while (j < m) push('add', B[j++]!);
  return out;
}

/** Was anything changed (beyond white space)? */
export const diffChanged = (D: readonly DiffSeg[]): boolean => D.some((d) => d.t !== 'eq' && d.s.trim());

export interface LawVersionLite { id: string; asOf: string | null; effectiveFrom: string | null; fetchedAt?: string | null }

/** Date a version applies from (effective date, else its version date). */
export const versionFrom = (v: LawVersionLite): string => v.effectiveFrom ?? v.asOf ?? (v.fetchedAt ?? '').slice(0, 10);

/**
 * The version that applies on a date: the latest one whose start is on or before the date. `null` when every stored
 * version starts later (the store has no text for that date → „треба да се провери“).
 */
export function versionAt<T extends LawVersionLite>(V: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const v of V) { const f = versionFrom(v); if (f && f <= date && (!best || f > versionFrom(best))) best = v; }
  return best;
}

/** Official hosts a law text may be fetched from (office „📥 Преземи од линк“): state domains and the official gazette. */
export const LAW_OFFICIAL_HOSTS = /(^|\.)(gov\.mk|slvesnik\.com\.mk|sobranie\.mk|crm\.com\.mk|azlp\.mk|dzlp\.mk|nbrm\.mk)$/i;

/** Is the URL an https / http link on an official host? */
export function lawOfficialUrl(url: string): boolean {
  const m = /^https?:\/\/([^/:?#@]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  return !!m && LAW_OFFICIAL_HOSTS.test(m[1]!);
}
