/**
 * Inspection record / decision (записник, решение, платен налог…) read WITHOUT AI from its text: the text layer of a
 * PDF (`kontrolaFromPdf`, lines grouped by y with a tolerance by `pdfLines`), a .docx or a .txt (`kontrolaFromText`).
 *
 *   header    орган (УЈП / ДПИ / ДИТ / УФР / Царина / АЗЛП by name or abbreviation), act type, број, датум,
 *             контролиран период („за периодот од … до …“), предмет
 *   findings  numbered points (1. / 1) / I. / „Наод бр. 1“) or, without numbering, the paragraphs that state an
 *             irregularity („утврдено“, „констатирано“, „неправилност“, „не е пресметан“, „не е платен“…); for each:
 *             the articles cited („член 53 став 8 од Законот за ДДВ“), the amounts („… ден.“, MK or dot format via
 *             `numfmt`) split into tax / interest / fine by the words before them, the tax type (area)
 *   deadline  „правна поука“: „во рок од 8 / 15 (петнаесет) дена“ → `remedyDays` (the case's deadline from delivery)
 *
 * The result has the shape of the AI read (`KontrolaAiResult`), so `applyKontrolaAi` works unchanged; `noai: true`
 * and `note` tell the screen it was read without AI and must be checked. A document without text (scan / photo)
 * gives null — the caller says that AI or manual entry is needed.
 */
import { AUTH_AREA, type FindingArea, type KontrolaAiResult, type KontrolaAuth, type KontrolaDoc } from '../compliance/kontrola';
import { colFormat, parseNumAuto, type NumFmt } from '../numfmt';
import { lineText, type PdfLine } from './pdf-lines';

export const KONTROLA_NOAI_NOTE = 'прочитано без AI – проверете ги наодите';
/** A scanned act (image / PDF without a text layer) when AI is not available. */
export const KONTROLA_SCAN_MSG = 'Скенирана слика – потребно е AI или рачен внес. Документот нема текст што програмата може да го прочита без AI: внесете ги наодите рачно („✎ Внеси рачно“) или кликнете ↻ Повторно кога AI ќе биде достапен.';

export interface KontrolaFreeResult extends KontrolaAiResult {
  /** Deadline of the legal remedy from the „правна поука“ (counted from delivery). */
  remedyDays?: number;
  remedyUnit?: 'days' | 'workdays';
  noai: true;
  note: string;
}

const sp = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\s+/g, ' ').trim();
/** „З А П И С Н И К“ → „ЗАПИСНИК“ (titles printed letter-spaced). */
const unspace = (s: string) => (/^(?:\p{L}\s){3,}\p{L}$/u.test(s.trim()) ? s.replace(/\s/g, '') : s);

/* ---------------- dates ---------------- */

const MONTHS: Record<string, number> = {
  јануари: 1, февруари: 2, март: 3, април: 4, мај: 5, јуни: 6, јули: 7, август: 8, септември: 9, октомври: 10, ноември: 11, декември: 12,
};
const DATE_SRC = '(\\d{1,2})\\s*[./-]\\s*(\\d{1,2})\\s*[./-]\\s*(\\d{4}|\\d{2})(?!\\d)|(\\d{1,2})\\s+(јануари|февруари|март|април|мај|јуни|јули|август|септември|октомври|ноември|декември)\\s+(\\d{4})';
const iso = (y: string, m: number, d: number) => (d >= 1 && d <= 31 && m >= 1 && m <= 12 ? `${y.length === 2 ? '20' + y : y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
function dateOf(m: RegExpExecArray | RegExpMatchArray): string {
  if (m[1]) return iso(m[3]!, +m[2]!, +m[1]);
  return iso(m[6]!, MONTHS[m[5]!.toLowerCase()]!, +m[4]!);
}
/** All dates of a text, in order (d.m.yyyy, d/m/yy, „5 март 2026“). */
export function datesIn(s: string): string[] {
  return [...s.matchAll(new RegExp(DATE_SRC, 'giu'))].map(dateOf).filter(Boolean);
}

/* ---------------- header ---------------- */

const AUTH_RE: [KontrolaAuth, RegExp][] = [
  ['ujp', /управа\s+за\s+јавни\s+приходи|(?<![\p{L}])УЈП(?![\p{L}])/iu],
  ['dpi', /државен\s+пазарен\s+инспекторат|(?<![\p{L}])ДПИ(?![\p{L}])/iu],
  ['dit', /државен\s+инспекторат\s+за\s+труд|инспекција\s+на\s+трудот|(?<![\p{L}])ДИТ(?![\p{L}])/iu],
  ['ufr', /управа\s+за\s+финансиско\s+разузнавање|(?<![\p{L}])УФР(?![\p{L}])/iu],
  ['carina', /царинска\s+управа|(?<![\p{L}])царина(?![\p{L}])/iu],
  ['dzlp', /агенција\s+за\s+заштита\s+на\s+личните\s+податоци|дирекција\s+за\s+заштита\s+на\s+личните\s+податоци|(?<![\p{L}])(?:АЗЛП|ДЗЛП)(?![\p{L}])/iu],
];

/** The issuing authority: the one named first in the document (the letterhead), otherwise null. */
export function authOf(text: string): KontrolaAuth | null {
  let best: KontrolaAuth | null = null, at = Infinity;
  for (const [k, re] of AUTH_RE) {
    const m = re.exec(text);
    if (m && m.index < at) { at = m.index; best = k; }
  }
  return best;
}

const DOC_RE: [KontrolaDoc, RegExp][] = [
  ['platen', /прекршочен\s+платен\s+налог|покана\s+за\s+плаќање/iu],
  ['zapisnik', /записник/iu],
  ['reshenie', /решение/iu],
  ['zakl', /заклучок|известување/iu],
];

/** Act type: the first title-like line (short, mostly capitals) naming an act; otherwise the first mention. */
function docOf(lines: readonly string[], head: string): KontrolaDoc | null {
  const title = (l: string) => l.length <= 60 && (l.match(/\p{Lu}/gu)?.length ?? 0) >= (l.match(/\p{L}/gu)?.length ?? 1) * 0.7;
  const pick = (s: string) => {
    let best: KontrolaDoc | null = null, at = Infinity;
    for (const [k, re] of DOC_RE) { const m = re.exec(s); if (m && m.index < at) { at = m.index; best = k; } }
    return best;
  };
  let d: KontrolaDoc | null = null;
  let at = 8;
  for (const [i, l] of lines.slice(0, 50).entries()) if (title(l) && (d = pick(l))) { at = i; break; }
  d ??= pick(head);
  // a second-instance decision names the commission in its letterhead (above the title)
  if (d === 'reshenie' && /второстепен|втор\s+степен|државна\s+комисија\s+за\s+одлучување/iu.test(lines.slice(0, at + 1).join(' '))) d = 'vtor';
  return d;
}

const NO_RE = /(?<![\p{L}])(?:бр(?:ој)?\.?|број)\s*[:.]?\s*([0-9][0-9A-Za-zА-Ша-шЃЌЉЊЏЅЈѓќљњџѕј\-/.]*[0-9A-Za-zА-Ша-ш])/iu;

function docNoOf(lines: readonly string[]): string {
  for (const l of lines.slice(0, 40)) {
    if (/ЕДБ|ЕМБС|сметка|наод|точка|лична\s+карта|весник/iu.test(l)) continue;
    const m = NO_RE.exec(l);
    if (m) return m[1]!.replace(/[.\-/]+$/, '');
  }
  return '';
}

function docDateOf(lines: readonly string[], start: number): string {
  const H = lines.slice(0, Math.max(5, Math.min(start, 40)));
  for (const l of H) if (/датум|година|г\.|од\s+\d/iu.test(l) && !/период|рок/iu.test(l)) { const d = datesIn(l)[0]; if (d) return d; }
  for (const l of H) if (!/период|роден|рок/iu.test(l)) { const d = datesIn(l)[0]; if (d) return d; }
  return '';
}

function periodOf(text: string): [string, string] {
  const re = /период(?:от)?|контролиран(?:иот)?\s+период/giu;
  for (const m of text.matchAll(re)) {
    const D = datesIn(text.slice(m.index!, m.index! + 160));
    if (D.length >= 2) return [D[0]!, D[1]!];
  }
  // „за 2025 година“ / „за 01/2025 до 03/2025“ are left to the office
  return ['', ''];
}

function subjectOf(lines: readonly string[]): string {
  for (const l of lines.slice(0, 60)) {
    const m = /^\s*предмет\s*[:.-]\s*(.+)$/iu.exec(l);
    if (m) return m[1]!.slice(0, 200);
  }
  for (const l of lines.slice(0, 60)) {
    const m = /((?:даночна|теренска|канцелариска|вонредна|редовна|инспекциска)?\s*(?:контрола|инспекциски\s+надзор)\s+(?:на|за|по)\s+[^.;]{3,120})/iu.exec(l);
    if (m) return sp(m[1]!).slice(0, 200);
  }
  return '';
}

/* ---------------- findings ---------------- */

const FIND_KW = /утврд(?:ено|ија|ил|и\s+дека)|констатира|неправилност|не\s+е\s+(?:пресметан|платен|уплатен|евидентиран|пријавен|издаден|искажан|изготвен|склучен|доставен|прокнижен|вклучен)|не\s+(?:се|ги|го|ја)?\s*(?:пресметал|платил|уплатил|евидентирал|пријавил|искажал|издал|прокнижил|водел|доставил)|неосновано|неправилно|повред|прекршок|пропуст|се\s+задолжува|се\s+налага|се\s+изрекува|помалку\s+(?:пресметан|платен|искажан)|неплатен|непресметан/iu;
const NUM_START = /^\s*(?:(?:наод|точка)\s*(?:бр\.?|број)?\s*(\d{1,2})\s*[.:)-]?|(\d{1,2})\s*[.)]|((?:X|IX|IV|V?I{1,3}|V))\s*[.)])\s+(?=\S)/iu;
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
const POUKA = /правна\s+поука|поука\s+за\s+правн/iu;

interface Block { no: number | null; text: string; pouka: boolean }

/** Lines → blocks: a numbered start or a blank line opens a new block; inside the „правна поука“ blocks are marked. */
function blocksOf(lines: readonly string[]): Block[] {
  const B: Block[] = [];
  let cur: Block | null = null;
  let pouka = false;
  for (const raw of lines) {
    const l = sp(raw);
    if (!l) { cur = null; continue; }
    if (POUKA.test(l) && (l.length < 80 || /^\W*(?:правна\s+)?поука/iu.test(l))) { pouka = true; cur = null; }
    const m = NUM_START.exec(l);
    if (m) {
      const no = m[1] ? +m[1] : m[2] ? +m[2] : ROMAN[m[3]!.toUpperCase()] ?? null;
      cur = { no, text: l.slice(m[0].length), pouka };
      B.push(cur);
    } else if (cur) cur.text += (cur.text.endsWith('-') ? '' : ' ') + l;
    else { cur = { no: null, text: l, pouka }; B.push(cur); }
  }
  return B.map((b) => ({ ...b, text: sp(b.text) }));
}

const isHeading = (t: string) => t.length < 70 && !/\d/.test(t) && (t.match(/\p{Lu}/gu)?.length ?? 0) >= (t.match(/\p{L}/gu)?.length ?? 1) * 0.6;

/* ----- articles ----- */

const LAW_ABBR: Record<string, string> = {
  ЗДДВ: 'Законот за ДДВ', ЗДП: 'Законот за даночна постапка', ЗДД: 'Законот за данокот на добивка', ЗПДД: 'Законот за персоналниот данок на доход',
  ЗПЗСО: 'Законот за придонеси од задолжително социјално осигурување', ЗРО: 'Законот за работните односи', ЗИН: 'Законот за инспекцискиот надзор',
  ЗТД: 'Законот за трговските друштва', ЗЗЛП: 'Законот за заштита на личните податоци',
};
const ART_RE = /(?<![\p{L}])(?:член(?:от)?|чл\.)\s*(\d{1,3}(?:-?[а-ж](?![\p{L}]))?)((?:\s*,?\s*(?:став|ст\.)\s*\(?\d{1,2}\)?(?:\s*(?:и|,)\s*\(?\d{1,2}\)?)*)?(?:\s*,?\s*(?:точка|т\.)\s*\d{1,2}\)?)?(?:\s*,?\s*(?:алинеја|ал\.)\s*\d{1,2})?)(?:\s*(?:од|на|во)\s+(?:(?:истиот|овој)\s+закон|(Закон(?:от)?\s+за\s+[^,.;()„“"\n]{3,90}?)(?=\s*[,.;()„“"]|\s+(?:и|со|според|за\s+периодот|во\s+износ|бидејќи|односно|се|е|како|поради|па)\s|\s*$)|(З[А-Ш]{1,5})(?![\p{L}])))?/giu;

/** Articles cited in a text: „член 53 став 8 од Законот за ДДВ“ (several joined with „; “). */
export function articlesIn(t: string): string {
  const out: string[] = [];
  let lastLaw = '';
  const raw: { art: string; law: string }[] = [];
  for (const m of t.matchAll(ART_RE)) {
    const rest = sp(m[2] ?? '').replace(/^,\s*/, '').replace(/ставови/iu, 'став');
    const law = m[3] ? sp(m[3]).replace(/^Закон\s/u, 'Законот ') : m[4] ? LAW_ABBR[m[4]] ?? m[4] : '';
    raw.push({ art: `член ${m[1]}${rest ? ' ' + rest : ''}`, law });
  }
  // „член 31 и член 32 од Законот за ДДВ“: the law named last applies to the articles before it without one
  for (let i = raw.length - 1; i >= 0; i--) { if (raw[i]!.law) lastLaw = raw[i]!.law; else if (lastLaw) raw[i]!.law = lastLaw; }
  for (const r of raw) {
    const s = r.law ? `${r.art} од ${r.law}` : r.art;
    if (!out.includes(s)) out.push(s);
  }
  return out.join('; ').slice(0, 500);
}

/* ----- amounts ----- */

const AMT_RE = /(?<![\d.,])(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:ден(?:ари)?\.?|МКД|MKD)(?![\p{L}])/giu;

type Cat = 'interest' | 'fine' | 'base' | 'tax';
const CATS: [Cat, RegExp][] = [
  ['interest', /камат/giu],
  ['fine', /глоб|парична\s+казна|казн[аи]|прекршочн|санкциј/giu],
  ['base', /основица|промет(?:от)?|вредност(?:а)?\s+на|набавк|фактур|износ\s+на\s+(?:фактура|набавка|промет)|приход|расход|плата\s+во\s+бруто|бруто\s+плата|готовинск\w*\s+плаќањ|благајнички\s+максимум/giu],
  ['tax', /ддв|данок|придонес|обврск|задолжува|доплат|разлика|помалку|за\s+плаќање|неплатен|непресметан|утврден/giu],
];

/** Category of an amount from the words before it (since the previous amount): the last keyword wins. */
function catOf(before: string): Cat | null {
  let best: Cat | null = null, at = -1;
  for (const [c, re] of CATS) for (const m of before.matchAll(re)) if (m.index! >= at) { at = m.index!; best = c; }
  return best;
}

/** Amount tokens of the whole document → its number format (one format per document). */
export function amountFmt(text: string): NumFmt {
  const f = colFormat([...text.matchAll(AMT_RE)].map((m) => m[1]!.replace(/\s/g, '')));
  return f === 'dot' ? 'dot' : 'mk';
}

interface Amounts { claimed: number; interest: number; fine: number }

function amountsIn(t: string, fmt: NumFmt): Amounts {
  const A: { v: number; cat: Cat | null; total: boolean }[] = [];
  let prev = 0;
  for (const m of t.matchAll(AMT_RE)) {
    const v = parseNumAuto(m[1]!.replace(/\s(?=\d{3}(?!\d))/g, ''), fmt);
    const before = t.slice(Math.max(prev, m.index! - 120), m.index!);
    prev = m.index! + m[0].length;
    if (v == null || !(v > 0)) continue;
    A.push({ v, cat: catOf(before), total: /вкупно|севкупно|збирно/iu.test(before) });
  }
  if (A.length === 1 && !A[0]!.cat) A[0]!.cat = 'tax';
  const pick = (c: Cat) => {
    const X = A.filter((a) => a.cat === c);
    if (!X.length) return 0;
    const T = X.filter((a) => a.total);
    if (T.length) return Math.max(...T.map((a) => a.v));
    return [...new Set(X.map((a) => a.v))].reduce((s, v) => s + v, 0);
  };
  return { claimed: pick('tax'), interest: pick('interest'), fine: pick('fine') };
}
const dec = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/* ----- tax type / area ----- */

const AREA_RE: [FindingArea, RegExp][] = [
  ['vat', /ддв|данок\s+на\s+додадена\s+вредност|данокот\s+на\s+додадена/iu],
  ['cit', /данок(?:от)?\s+на\s+добивка/iu],
  ['pit', /персонал\w*\s+данок|данок(?:от)?\s+на\s+доход/iu],
  ['contrib', /придонес/iu],
  ['fiscal', /фискал/iu],
  ['cash', /благајн|готовин/iu],
  ['labour', /работн(?:о|ото)\s+време|работен\s+однос|договор\s+за\s+вработување|пријав\w*\s+(?:во|на)\s+АВРМ|неформал/iu],
  ['payroll', /плат[аи](?![\p{L}])|исплат\w*\s+на\s+плат/iu],
  ['invoice', /фактур|нумерациј/iu],
  ['books', /деловни\s+книги|книжењ|сметководств/iu],
  ['gdpr', /лични\s+податоци/iu],
  ['aml', /перење\s+пари|сомнителн\w*\s+трансакц/iu],
];

const TAX_AREAS = 4; // vat, cit, pit, contrib come first in AREA_RE

/** Tax type / area of a finding: the tax named first, otherwise the topic named first, otherwise the authority's default. */
export function areaOf(t: string, auth: KontrolaAuth | null): FindingArea {
  const first = (R: typeof AREA_RE) => {
    let best: FindingArea | null = null, at = Infinity;
    for (const [a, re] of R) { const m = re.exec(t); if (m && m.index < at) { at = m.index; best = a; } }
    return best;
  };
  return first(AREA_RE.slice(0, TAX_AREAS)) ?? first(AREA_RE.slice(TAX_AREAS)) ?? (auth ? AUTH_AREA[auth] : 'other');
}

/* ----- legal remedy deadline ----- */

const WORDNUM: Record<string, number> = { три: 3, пет: 5, осум: 8, десет: 10, петнаесет: 15, дваесет: 20, триесет: 30, шеесет: 60 };
const RE_DL = /рок\s+од\s+(\d{1,3}|три|пет|осум|десет|петнаесет|дваесет|триесет|шеесет)\s*(?:\(\s*[\p{L}\d]+\s*\)\s*)?(работни\s+)?(?:ден|дена)(?![\p{L}])/giu;
const REMEDY_KW = /приговор|жалба|забелешк|изјасн|тужба|правн\w*\s+средств/iu;

/** Days of the remedy from the „правна поука“ (or a sentence naming a remedy), null when absent. */
export function remedyDeadline(lines: readonly string[]): { n: number; unit: 'days' | 'workdays' } | null {
  const text = lines.map(sp).join(' ');
  const p = text.search(POUKA);
  const scan = (s: string, needKw: boolean) => {
    for (const m of s.matchAll(RE_DL)) {
      const sent = s.slice(Math.max(0, s.lastIndexOf('.', m.index!) + 1), s.indexOf('.', m.index! + m[0].length) + 1 || undefined);
      if (needKw && !REMEDY_KW.test(sent)) continue;
      const n = /^\d+$/.test(m[1]!) ? +m[1]! : WORDNUM[m[1]!.toLowerCase()]!;
      if (n > 0 && n <= 90) return { n, unit: m[2] ? 'workdays' as const : 'days' as const };
    }
    return null;
  };
  return (p >= 0 ? scan(text.slice(p), false) : null) ?? scan(text, true);
}

/* ---------------- whole document ---------------- */

/** Read the act from its text lines (blank line = paragraph break); null when there is no usable text. */
export function kontrolaFromText(input: readonly string[]): KontrolaFreeResult | null {
  const lines = input.map((l) => unspace(sp(l)));
  const text = lines.filter(Boolean).join('\n');
  if (text.replace(/[^\p{L}]/gu, '').length < 40) return null;
  const head = lines.slice(0, 60).join('\n');
  const auth = authOf(head) ?? authOf(text);
  const doc = docOf(lines.filter(Boolean), head);
  const B = blocksOf(lines);
  const fmt = amountFmt(text);

  const hasAmt = (t: string) => new RegExp(AMT_RE.source, 'iu').test(t);
  const candidate = (b: Block) => !b.pouka && b.text.length >= 25 && !isHeading(b.text)
    && (FIND_KW.test(b.text) || (hasAmt(b.text) && /ддв|данок|придонес|глоб|казн/iu.test(b.text)));
  let F = B.filter((b) => b.no != null && candidate(b));
  if (!F.length) F = B.filter((b) => b.no == null && candidate(b));
  const NL = lines.filter(Boolean);
  const firstFinding = F.length ? NL.findIndex((l) => F[0]!.text.startsWith(sp(l.replace(NUM_START, '')).slice(0, 20))) : -1;

  const [periodFrom, periodTo] = periodOf(text);
  const dl = remedyDeadline(lines);
  const findings = F.map((b, i) => {
    const a = amountsIn(b.text, fmt);
    return {
      no: i + 1, area: areaOf(b.text, auth), text: b.text.slice(0, 2000), article: articlesIn(b.text),
      claimed: dec(a.claimed), interest: dec(a.interest), fine: dec(a.fine),
    };
  });
  return {
    auth: auth ?? 'other', doc: doc ?? 'zapisnik', docNo: docNoOf(NL), docDate: docDateOf(NL, firstFinding < 0 ? 40 : firstFinding),
    periodFrom, periodTo, subject: subjectOf(NL), findings,
    ...(dl ? { remedyDays: dl.n, remedyUnit: dl.unit } : {}),
    noai: true, note: KONTROLA_NOAI_NOTE,
  };
}

/**
 * PDF lines → text lines with a blank line where the vertical gap is clearly larger than the usual line spacing
 * (paragraph breaks), then `kontrolaFromText`.
 */
export function kontrolaFromPdf(L: readonly PdfLine[]): KontrolaFreeResult | null {
  if (!L.length) return null;
  const gaps: number[] = [];
  for (let i = 1; i < L.length; i++) if (L[i]!.page === L[i - 1]!.page) { const g = L[i - 1]!.y - L[i]!.y; if (g > 0) gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 12;
  const out: string[] = [];
  L.forEach((l, i) => {
    const p = L[i - 1];
    if (p && p.page === l.page && p.y - l.y > med * 1.6) out.push('');
    out.push(lineText(l).replace(/ {2,}/g, ' '));
  });
  return kontrolaFromText(out);
}
