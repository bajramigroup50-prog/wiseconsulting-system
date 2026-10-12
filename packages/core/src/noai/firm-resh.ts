/**
 * „📷 Нова фирма од решение“ read WITHOUT AI from the text of an electronic document (the text layer of a PDF, lines
 * by `pdfLines` → `lineText`, or a .txt). Covers what the Централен регистар (ЦРСМ) and УЈП issue electronically:
 *
 *   upis     „Решение за упис / регистрација / основање“ (ЦРСМ)
 *   tekovna  „Тековна состојба“ and „Историјат“ (ЦРСМ extracts)
 *   ddv      „Решение / Потврда за регистрација за ДДВ“ (УЈП) — ДДВ обврзник + датум од
 *   edb      „Решение / Потврда за ЕДБ“ (УЈП)
 *
 * Fields are found by their printed labels („Целосен назив“, „ЕМБС“ / „Матичен број“, „ЕДБ“ / „Даночен број“,
 * „Седиште“, „Приоритетна дејност“, „Датум на основање“, „Основна главнина“, „Управител“, „Основачи“…), whether the
 * value follows on the same line („Label: value“ or the next cell) or on the next line. ЕМБС (7 digits) and ЕДБ (13
 * digits, „МК“ prefix dropped) are checked by FORMAT only — the control-digit algorithms are not officially published,
 * so a number with a wrong control digit is not rejected (the user checks the read anyway).
 *
 * The result has the shape of `normalizeResh` (the AI read), so the review screen works unchanged; `noai: true`,
 * `note` and `warnings` tell the screen it was read without AI and must be checked. Text that is not a registration
 * document (or no text at all: a scan / photo) gives null — the caller uses AI.
 */
import { lfGuess, normalizeResh, type ReshData } from '../firms/resh';
import { parseNumAuto } from '../numfmt';
import { datesIn } from './kontrola';

export const RESH_NOAI_NOTE = 'прочитано без AI – проверете';

export interface ReshFree extends ReshData {
  noai: true;
  note: string;
  /** Општина of the seat (when printed separately from the place). */
  municipality: string;
  /** What the reader could not confirm (bad format, missing required field). */
  warnings: string[];
}

const sp = (s: string) => s.replace(/\s+/g, ' ').trim();
const unq = (s: string) => sp(s).replace(/^[„“"'«»]+|[„“"'«»]+$/g, '').replace(/[„“"«»]/g, '"').replace(/\s*[.;,]$/, '').trim();

/* ---------------- labels ---------------- */

/** Every label the reader knows: a next line that is itself a label is never taken as a value. */
const ANY_LABEL = /^(?:\d+[.)]\s*)?(?:целосен\s+назив|назив|кратко\s+име|скратен\s+назив|фирма|емб[сc]|матичен\s+број|едб|единствен\s+даночен|даночен\s+број|даночен\s+обврзник|правна\s+форма|вид\s+на\s+субјект|седиште|адреса|улица|број|место|град|општина|приоритетна\s+дејност|претежна\s+дејност|шифра\s+на\s+дејност|дејност|други\s+дејности|датум|основна\s+главнина|главнина|управител|застапник|лица\s+овластени|овластено\s+лице|основач|сопственици|содружници|членови|жиро\s+сметка|трансакциска\s+сметка|сметка|банка|носител\s+на\s+платен|телефон|тел(?!\p{L})|е-?пошта|e-?mail|статус|деловоден|број\s+на\s+решение)/iu;
const isLabel = (s: string) => ANY_LABEL.test(s.trim()) && (/:\s*$/.test(s) || /^[^:]{0,60}:/.test(s) || s.trim().split(/\s+/).length <= 4);

interface Hit { v: string; i: number }

/**
 * The value printed with a label: „Label: value“, „Label  value“ (next cell) or the label alone with the value on the
 * next line. `re` matches the label at the start of a line (after an optional „1.“ numbering).
 */
function field(L: readonly string[], re: RegExp, o: { from?: number; to?: number; next?: boolean } = {}): Hit | null {
  const full = new RegExp(`^\\s*(?:\\d+[.)]\\s*)?(?:${re.source})(?:\\s*\\([^)]*\\))?\\s*(?:[:：]|\\s{2,}|\\s+-\\s+|(?<=\\.)\\s|$)\\s*(.*)$`, 'iu');
  for (let i = o.from ?? 0; i < Math.min(L.length, o.to ?? L.length); i++) {
    const m = full.exec(L[i]!);
    if (!m) continue;
    const v = sp(m[1] ?? '');
    if (v) return { v, i };
    if (o.next === false) continue;
    const n = L.slice(i + 1).findIndex((x) => x.trim());
    if (n >= 0 && !isLabel(L[i + 1 + n]!)) return { v: sp(L[i + 1 + n]!), i: i + 1 + n };
  }
  return null;
}

/* ---------------- numbers ---------------- */

/** ЕМБС: 7 digits (some documents print a leading 0 → 8). Format check only. */
export function embsOf(s: string): string {
  const m = /(?<!\d)(\d{7,8})(?!\d)/.exec(s.replace(/(\d)\s+(?=\d)/g, '$1'));
  if (!m) return '';
  const d = m[1]!;
  return d.length === 8 ? (d[0] === '0' ? d.slice(1) : '') : d;
}
export const embsValid = (s: string) => /^\d{7}$/.test(s);

/** ЕДБ: 13 digits, with or without the „МК“ / „MK“ prefix of the ДДВ number. Format check only. */
export function edbOf(s: string): string {
  const m = /(?:^|[^\d])(?:М\s*К|M\s*K)?\s*(\d(?:\s?\d){12})(?!\d)/iu.exec(s);
  return m ? m[1]!.replace(/\s/g, '') : '';
}
export const edbValid = (s: string) => /^\d{13}$/.test(s);

/** Bank account: 15 digits (the first 3 = bank), spaces / dashes allowed. */
const accountOf = (s: string) => {
  const m = /(?<!\d)(\d{3}[\s-]?\d(?:[\s-]?\d){10,11})(?!\d)/.exec(s);
  const d = m ? m[1]!.replace(/\D/g, '') : '';
  return d.length === 15 ? d : '';
};

const firstDate = (s: string) => datesIn(s)[0] ?? '';

/* ---------------- doc type ---------------- */

function docTypeOf(t: string, head: string): string {
  // the issuer is in the letterhead: a ЦРСМ decision also names УЈП (the ЕДБ it assigns) in its text
  const ujp = /управа\s+за\s+јавни\s+приходи|(?<!\p{L})УЈП(?!\p{L})/iu.test(head) && !/централен\s+регистар/iu.test(head);
  if (ujp && /регистр\p{L}*\s+(?:за|како)\s+(?:обврзник\s+(?:за|на)\s+)?(?:ДДВ|данок\s+на\s+додадена)|(?:ДДВ|данок\s+на\s+додадена\s+вредност)[^\n]{0,80}регистр/iu.test(t)) return 'ddv';
  if (ujp && /(?<!\p{L})ЕДБ(?!\p{L})|единствен\s+даночен\s+број/iu.test(t)) return 'edb';
  if (/т\s*е\s*к\s*о\s*в\s*н\s*а\s+с\s*о\s*с\s*т\s*о\s*ј\s*б\s*а|историјат/iu.test(t)) return 'tekovna';
  if (/решение|потврда/iu.test(t) && /централен\s+регистар|ЦРСМ|ЦРМ|упис|основање|регистрација/iu.test(t)) return 'upis';
  return 'other';
}

/* ---------------- legal form ---------------- */

const LF_TEXT: [RegExp, string][] = [
  [/ограничена\s+одговорност\s+(?:основано\s+)?од\s+едно\s+лице|ДООЕЛ/iu, 'dooel'],
  [/ограничена\s+одговорност|(?<!\p{L})ДОО(?!\p{L})/iu, 'doo'],
  [/акционерско|(?<!\p{L})АД(?!\p{L})/iu, 'ad'],
  [/командитно|(?<!\p{L})КД(?!\p{L})/iu, 'kd'],
  [/јавно\s+трговско|(?<!\p{L})ЈТД(?!\p{L})/iu, 'jtd'],
  [/трговец\s+поединец|(?<!\p{L})ТП(?!\p{L})/iu, 'tp'],
  [/адвокат/iu, 'adv'], [/нотар/iu, 'not'], [/извршител/iu, 'izv'], [/занаетчи/iu, 'zan'],
  [/фондација/iu, 'fon'], [/сојуз/iu, 'soj'], [/здружение/iu, 'zdr'],
];
const lfOf = (s: string) => LF_TEXT.find(([re]) => re.test(s))?.[1] ?? '';

/* ---------------- address ---------------- */

/** „ул. Македонија бр. 12, Скопје - Центар“ → street + number, place, municipality. */
export function splitSeat(v: string): { address: string; city: string; municipality: string } {
  const s = unq(v);
  const cityPart = (c: string) => {
    const [p, m] = c.split(/\s+[-–]\s+|\s*\/\s*/);
    return { city: sp(p ?? ''), municipality: sp(m ?? '') };
  };
  const parts = s.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 2) {
    // the place is the last part unless that is only a postal code / state
    let k = parts.length - 1;
    while (k > 1 && /^(?:\d{4}|република|северна|македонија)/iu.test(parts[k]!)) k--;
    return { address: parts.slice(0, k).join(', '), ...cityPart(parts[k]!.replace(/^\d{4}\s*/, '')) };
  }
  const m = /^(.*?(?<!\p{L})бр\.?\s*[\w/-]+)\s+(.+)$/iu.exec(s);
  if (m) return { address: sp(m[1]!), ...cityPart(m[2]!) };
  return { address: s, city: '', municipality: '' };
}

/* ---------------- people ---------------- */

const NAME_RE = /\p{Lu}[\p{Ll}\p{Lu}'’-]+(?:\s+\p{Lu}[\p{Ll}\p{Lu}'’-]+){1,3}/u;
const ROLE_RE = /управител|застапник|извршен\s+директор|директор|претседател|овластено\s+лице/iu;
const SHARE_RE = /(\d{1,3}(?:[.,]\d+)?\s*%)|(?:удел|влог)\s*[:\-]?\s*([\d.,]+\s*(?:%|ЕУР|EUR|ден\.?|МКД|MKD)?)/iu;
/** Words that start a section line, never a person's name. */
const NOT_NAME = /^(?:име|презиме|тип|вид|улога|овластувања|ограничувања|без|адреса|држава|државјанство|удел|влог|износ|основна|главнина|лица|основачи|сопственици|содружници|членови|управител|застапник|датум|број|емб|едб)/iu;

/** A person on a line: „Име и презиме: Марко Марковски“, „Марко Марковски, управител“, a table row. */
function personOf(line: string): string {
  const lab = /(?:име\s+и\s+презиме|име\s+и\s+презиме\s*\/\s*назив|назив|основач|сопственик|содружник|управител|застапник)\s*[:\-]\s*(.+)$/iu.exec(line);
  const s = lab ? lab[1]! : line;
  if (!lab && NOT_NAME.test(s.trim())) return '';
  const m = NAME_RE.exec(s.replace(/\s{2,}.*$/, ''));
  return m && !NOT_NAME.test(m[0]) && !ROLE_RE.test(m[0]) ? sp(m[0]) : '';
}

/** Lines of a section: from the heading to the next known heading (max 25 lines). */
function section(L: readonly string[], head: RegExp, stop: RegExp): { lines: string[]; at: number } | null {
  const i = L.findIndex((l) => head.test(l));
  if (i < 0) return null;
  const out: string[] = [];
  const rest = L[i]!.replace(head, '').replace(/^[\s:]+/, '');
  if (rest) out.push(rest);
  for (let j = i + 1; j < Math.min(L.length, i + 26); j++) {
    if (stop.test(L[j]!)) break;
    out.push(L[j]!);
  }
  return { lines: out, at: i };
}

const STOP = /^\s*(?:\d+[.)]\s*)?(?:основна\s+главнина|вкупна\s+главнина|приоритетна|претежна|шифра\s+на\s+дејност|други\s+дејности|дејности?\s|седиште|адреса|жиро|трансакциска|банка|носител\s+на\s+платен|контакт|телефон|е-?пошта|правна\s+поука|образложение|датум\s+на|статус|лица\s+овластени|управител(?:и)?\s*:?\s*$|овластени\s+лица|основачи|сопственици|содружници|членови\s+на|органи\s+на\s+управување|надзорен|ревизор|ликвидатор|стечаен)/iu;

function managersOf(L: readonly string[]): { name: string; role: string }[] {
  const out: { name: string; role: string }[] = [];
  const push = (name: string, role: string) => { if (name && !out.some((x) => x.name === name)) out.push({ name, role }); };
  const S = section(L, /^\s*(?:\d+[.)]\s*)?(?:лица\s+овластени\s+за\s+застапување|овластени\s+лица(?:\s+за\s+застапување)?|застапници|управители|органи\s+на\s+управување)(?!\p{L}).*?(?::|$)/iu, STOP);
  if (S) {
    for (let j = 0; j < S.lines.length; j++) {
      const l = S.lines[j]!;
      const n = personOf(l);
      if (!n) continue;
      const role = (ROLE_RE.exec(l) ?? ROLE_RE.exec(S.lines.slice(j + 1, j + 3).join(' ')) ?? ['управител'])[0].toLowerCase();
      push(n, role);
    }
  }
  if (!out.length) {
    // „Управител: Марко Марковски“ / „Застапник: …“ printed as a field
    const h = field(L, /управител|застапник|лице\s+овластено\s+за\s+застапување|овластено\s+лице/);
    if (h) push(personOf(h.v) || unq(h.v.split(/\s{2,}|,/)[0]!), /застапник/iu.test(L[h.i]!) ? 'застапник' : 'управител');
  }
  return out;
}

function foundersOf(L: readonly string[]): { name: string; share: string }[] {
  const S = section(L, /^\s*(?:\d+[.)]\s*)?(?:основачи|основач|сопственици|сопственик|содружници|содружник|членови\s+на\s+друштвото|сопственост)(?!\p{L}).*?(?::|$)/iu, STOP);
  if (!S) return [];
  const out: { name: string; share: string }[] = [];
  for (let j = 0; j < S.lines.length; j++) {
    const l = S.lines[j]!;
    const n = personOf(l);
    if (n) {
      const sh = SHARE_RE.exec(l) ?? SHARE_RE.exec(S.lines[j + 1] ?? '');
      if (!out.some((x) => x.name === n)) out.push({ name: n, share: sp((sh?.[1] ?? sh?.[2] ?? '').replace(/\s+%/, '%')) });
    } else if (out.length && !out[out.length - 1]!.share) {
      const sh = SHARE_RE.exec(l);
      if (sh) out[out.length - 1]!.share = sp((sh[1] ?? sh[2] ?? '').replace(/\s+%/, '%'));
    }
  }
  return out;
}

/* ---------------- activities ---------------- */

const NKD_RE = /(?<![\d.,])(\d{2}\.\d{1,2})(?![\d.,])\s*[-–:]?\s*(\p{L}[^\n]*)?/u;
const NKD_ALL = /(?<![\d.,])(\d{2}\.\d{1,2})(?![\d.,])(?=\s*[-–:]?\s*\p{L})/gu;
const codeNorm = (c: string) => { const [a, b] = c.split('.'); return `${a}.${b!.padStart(2, '0')}`; };

/* ---------------- main ---------------- */

/** Free read of a registration document; null when the text is not one (or there is no text). */
export function reshFromText(lines: readonly string[]): ReshFree | null {
  const L = lines.map((l) => l.replace(/ /g, ' ').replace(/[ \t]+$/g, '')).filter((l) => l.trim());
  if (!L.length) return null;
  const text = L.join('\n');
  const docType = docTypeOf(text, L.slice(0, 6).join('\n'));
  const warnings: string[] = [];

  // ---- identifiers
  const embsHit = field(L, /ЕМБС(?:\s+на\s+(?:субјектот|правното\s+лице|трговецот))?|матичен\s+број(?:\s+на\s+(?:субјектот|правното\s+лице))?|единствен\s+матичен\s+број(?:\s+на\s+субјектот)?/);
  let embs = embsHit ? embsOf(embsHit.v) : '';
  if (!embs) { const m = /(?:ЕМБС|матичен\s+број)[^\d\n]{0,30}(\d{7,8})(?!\d)/iu.exec(text); if (m) embs = embsOf(m[1]!); }
  const edbHit = field(L, /ЕДБ(?:\s+за\s+ДДВ)?|единствен\s+даночен\s+број|даночен\s+број|ДДВ\s+број|идентификационен\s+број\s+за\s+ДДВ/);
  let edb = edbHit ? edbOf(edbHit.v) : '';
  if (!edb) { const m = /(?:ЕДБ|даночен\s+број)[^\d\n]{0,30}((?:М\s*К|M\s*K)?\s*\d(?:\s?\d){12})(?!\d)/iu.exec(text); if (m) edb = edbOf(m[1]!); }
  if (embsHit && !embs) warnings.push(`ЕМБС „${embsHit.v}“ не е 7 цифри`);
  if (edbHit && !edb) warnings.push(`ЕДБ „${edbHit.v}“ не е 13 цифри`);

  // ---- name
  const nameHit = field(L, /целосен\s+назив(?:\s+на\s+(?:субјектот|друштвото|правното\s+лице|трговецот))?|назив\s+на\s+(?:субјектот|правното\s+лице|друштвото|трговецот|даночниот\s+обврзник|фирмата)|назив(?!\s+на\s)|фирма|даночен\s+обврзник|име\s+на\s+фирмата/);
  const name = nameHit ? unq(nameHit.v.split(/\s{2,}(?=(?:ЕМБС|ЕДБ|матичен|даночен))/iu)[0]!) : '';
  const shortHit = field(L, /кратко\s+име(?:\s+на\s+(?:субјектот|друштвото|фирмата))?|скратен\s+назив|скратено\s+име/);
  const short = shortHit ? unq(shortHit.v) : '';

  // ---- legal form
  const lfHit = field(L, /правна\s+форма|вид\s+на\s+(?:субјект|трговец|друштво)|организациона\s+форма/);
  let legalForm = lfHit ? lfOf(lfHit.v) : '';
  if (!legalForm && name) legalForm = lfOf(name) || lfGuess(name);

  // ---- seat
  let address = '', city = '', municipality = '';
  const street = field(L, /улица/, { next: false });
  if (street) {
    const no = field(L, /(?:куќен\s+)?број(?!\s+на)/, { from: street.i, to: street.i + 4, next: false });
    address = unq(street.v) + (no && !/(?<!\p{L})бр/iu.test(street.v) ? ` бр. ${unq(no.v)}` : '');
    city = unq(field(L, /место|град|населено\s+место/, { next: false })?.v ?? '');
    municipality = unq(field(L, /општина/, { next: false })?.v ?? '');
  } else {
    const seat = field(L, /седиште(?:\s+на\s+(?:субјектот|друштвото))?|адреса(?:\s+на\s+седиште(?:то)?)?|адреса\s+на\s+(?:субјектот|обврзникот)/);
    if (seat) ({ address, city, municipality } = splitSeat(seat.v));
    const muni = field(L, /општина/, { next: false });
    if (muni) municipality = unq(muni.v);
    const place = !city && field(L, /место|град/, { next: false });
    if (place) city = unq(place.v);
  }

  // ---- activity
  const nkdHit = field(L, /приоритетна\s+дејност(?:\s*\/\s*главна\s+приходна\s+шифра)?|претежна\s+дејност|главна\s+приходна\s+шифра|шифра\s+(?:на\s+)?(?:приоритетна\s+)?дејност|дејност(?:\s+на\s+субјектот)?/);
  let nkd = '', activity = '';
  const nm = nkdHit ? NKD_RE.exec(nkdHit.v) ?? NKD_RE.exec(L[nkdHit.i + 1] ?? '') : null;
  if (nm) { nkd = codeNorm(nm[1]!); activity = unq((nm[2] ?? '').split(/\s{2,}/)[0]!); }
  else if (nkdHit) activity = unq(nkdHit.v);
  const otherNkd = [...new Set([...text.matchAll(NKD_ALL)].map((m) => codeNorm(m[1]!)))].filter((c) => c !== nkd);

  // ---- dates
  const regHit = field(L, /датум\s+на\s+(?:основање|упис|регистрација|запишување)|основан[оа]?\s+на|датум\s+на\s+основањето/);
  let regDate = regHit ? firstDate(regHit.v) : '';
  const noHit = field(L, /(?:деловоден\s+)?број(?:\s+на\s+(?:решението|предметот|потврдата))?|бр\.|дел\.?\s*бр\.?|број\s+на\s+барање/, { to: 25, next: false });
  const docNumber = noHit ? (/^([\p{L}\d][\p{L}\d/.\-]*)/u.exec(noHit.v.replace(/^од\s+/iu, ''))?.[1] ?? '').replace(/[.,]$/, '') : '';
  const dateHit = field(L, /датум(?:\s+на\s+(?:решението|издавање|изготвување|потврдата))?/, { to: 40 });
  let docDate = dateHit && !/основање|упис|регистрација/iu.test(L[dateHit.i]!) ? firstDate(dateHit.v) : '';
  if (!docDate) {
    // „Скопје, 12.03.2026 година“ / „од 12.03.2026“ in the header
    for (const l of L.slice(0, 20)) { if (/основање|упис\s+на|ДДВ/iu.test(l)) continue; const d = firstDate(l); if (d) { docDate = d; break; } }
  }

  if (!regDate && docType === 'upis') regDate = docDate;

  // ---- capital
  const capHit = field(L, /основна\s+главнина|вкупна\s+главнина|главнина|паричен\s+влог/);
  let capital = 0, capitalCur = '';
  if (capHit) {
    const m = /(\d[\d.,\s]*\d|\d)\s*(ЕУР|EUR|евра|ден(?:ари)?\.?|МКД|MKD)?/iu.exec(capHit.v);
    if (m) {
      capital = parseNumAuto(m[1]!.replace(/\s/g, ''), 'mk') ?? 0;
      capitalCur = /ЕУР|EUR|евр/iu.test(m[2] ?? capHit.v) ? 'EUR' : /ден|МКД|MKD/iu.test(m[2] ?? capHit.v) ? 'MKD' : '';
    }
  }

  // ---- bank, contact
  const accHit = field(L, /жиро\s+сметка|трансакциска\s+сметка|број\s+на\s+сметка|сметка/);
  let bank = accHit ? accountOf(accHit.v) : '';
  if (!bank) { const m = /(?:жиро|трансакциска)\s+сметка[^\d\n]{0,30}([\d\s-]{15,21})/iu.exec(text); if (m) bank = accountOf(m[1]!); }
  const bankName = unq(field(L, /банка|носител\s+на\s+платен\s+промет|депонент/, { next: false })?.v.split(/\s{2,}/)[0] ?? '');
  const email = (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text) ?? [''])[0];
  const phoneHit = field(L, /телефон|тел\.?|контакт\s+телефон/, { next: false });
  const phone = phoneHit ? sp((/\+?\d[\d\s/().-]{5,}\d/.exec(phoneHit.v) ?? [''])[0]) : '';

  // ---- ДДВ
  let vatFrom = '';
  if (docType === 'ddv') {
    const h = field(L, /(?:датум\s+на\s+)?регистрација\s+за\s+ДДВ|регистриран\s+за\s+ДДВ\s+од|обврзник\s+за\s+ДДВ\s+од|важи\s+од|почнувајќи\s+од|ДДВ\s+обврзник\s+од/);
    vatFrom = h ? firstDate(h.v) : '';
    if (!vatFrom) {
      const m = /(?:се\s+регистрира|регистриран[оа]?|обврзник)[^]{0,160}?(?:од|почнувајќи\s+од|со\s+состојба\s+на)\s+(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}|\d{1,2}\s+\p{L}+\s+\d{4})/iu.exec(text);
      if (m) vatFrom = firstDate(m[1]!);
    }
    if (!vatFrom) warnings.push('Не се најде датумот од кој е ДДВ обврзник');
  }

  const managers = managersOf(L);
  const founders = foundersOf(L);
  if (!name && !embs && !edb) return null;
  if (docType === 'other' && !(embs && name) && !(edb && name)) return null;

  const r = normalizeResh({
    docType: docType === 'other' ? 'upis' : docType, docNumber, docDate, name, short, legalForm, embs, edb, address, city, nkd, otherNkd, activity,
    regDate, capital, capitalCur, managers, founders, bank, bankName, vatFrom, phone, email,
  });
  if (r.embs && !embsValid(r.embs)) warnings.push(`ЕМБС ${r.embs} не е 7 цифри`);
  if (r.edb && !edbValid(r.edb)) warnings.push(`ЕДБ ${r.edb} не е 13 цифри`);
  for (const m of reshMissing(r)) warnings.push(`Не се најде: ${m}`);
  return { ...r, noai: true, note: RESH_NOAI_NOTE, municipality, warnings };
}

/** Required fields the free read must have, otherwise AI is used (when available). */
export function reshMissing(r: Pick<ReshData, 'name' | 'embs' | 'edb' | 'docType' | 'vatFrom'>): string[] {
  const out: string[] = [];
  if (!r.name) out.push('назив');
  if (r.docType === 'ddv' || r.docType === 'edb') { if (!edbValid(r.edb)) out.push('ЕДБ'); }
  else if (!embsValid(r.embs) && !edbValid(r.edb)) out.push('ЕМБС / ЕДБ');
  if (r.docType === 'ddv' && !r.vatFrom) out.push('ДДВ од датум');
  return out;
}

/** Several documents of one firm read together (e.g. Тековна состојба + ДДВ решение): empty fields filled from the next. */
export function mergeResh(A: readonly ReshFree[]): ReshFree | null {
  if (!A.length) return null;
  const base = { ...A.find((x) => x.docType !== 'ddv' && x.docType !== 'edb') ?? A[0]! } as ReshFree;
  for (const x of A) {
    if (x === base) continue;
    for (const [k, v] of Object.entries(x) as [keyof ReshFree, unknown][]) {
      const cur = base[k];
      if (k === 'warnings' || k === 'noai' || k === 'note' || k === 'docType') continue;
      if ((cur === '' || cur === 0 || (Array.isArray(cur) && !cur.length)) && v) (base as unknown as Record<string, unknown>)[k] = v;
    }
    if (x.ddv) { base.ddv = true; base.vatFrom ||= x.vatFrom; }
  }
  base.warnings = reshMissing(base).map((m) => `Не се најде: ${m}`).concat(A.flatMap((x) => x.warnings.filter((w) => !w.startsWith('Не се најде:'))));
  return base;
}
