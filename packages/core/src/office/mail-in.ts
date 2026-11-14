/**
 * „✉ Е-пошта → WISE“ (pure): the office mailbox (info@…) read by the worker (`mail.in`); every attachment of a client's
 * mail goes to „📥 Пристигнати документи“ (`incoming_docs`, source `mail`) of the firm it belongs to.
 *
 * The firm is found, in this order:
 *   1. the sender learned from the office (the office once gave a mail from this address to a firm),
 *   2. the sender is the firm's e-mail or a client user's e-mail of exactly one firm,
 *   3. exactly one firm's ЕДБ in the subject, the text or the file name,
 *   4. exactly one firm's name (without ДООЕЛ / ДОО / Скопје…) in the subject.
 * Several or none → it waits in the office inbox („изберете фирма“), never guessed.
 */

export const MAILIN_JOB = 'mail.in';
/** Mails older than this are never read on the first run (the office can change it). */
export const MAILIN_DEFAULT_DAYS = 30;
/** Files larger than this are skipped (a note on the log). */
export const MAILIN_MAX_BYTES = 25 * 1024 * 1024;

export type MailMatchHow = 'learned' | 'email' | 'edb' | 'name';
export const MAILIN_HOW: Record<MailMatchHow, string> = {
  learned: 'испраќачот (запаметен)', email: 'е-поштата на фирмата', edb: 'ЕДБ во пораката', name: 'името на фирмата во насловот',
};

export interface MailFirm { id: string; name: string; edb: string | null; email: string | null; short?: string | null }

/** `"Име" <a@b.mk>` / `a@b.mk` → `a@b.mk` (lower case), '' when there is no address. */
export function mailAddr(v: string | null | undefined): string {
  const s = String(v ?? '');
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(s) ?? /([^\s<>"',;]+@[^\s<>"',;]+\.[a-z]{2,})/i.exec(s);
  return (m?.[1] ?? '').trim().toLowerCase();
}

/** Every address of a firm's e-mail field (`a@x.mk; b@y.mk`). */
export const firmAddrs = (email: string | null | undefined): string[] =>
  String(email ?? '').split(/[;,\s]+/).map((x) => mailAddr(x)).filter(Boolean);

/** ЕДБ digits only (`MK4030000000001` → `4030000000001`); '' unless 13 digits. */
export const edbDigits = (v: string | null | undefined): string => { const d = String(v ?? '').replace(/\D/g, ''); return d.length === 13 ? d : ''; };

/** Every 13-digit number of a text (ЕДБ candidates, `MK` prefix or not). */
export function mailEdbs(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text).matchAll(/(?:MK)?\s?(\d[\d ]{11,16}\d)/gi)) { const d = m[1]!.replace(/ /g, ''); if (d.length === 13) out.add(d); }
  return [...out];
}

/* JS `\b` is ASCII only: Cyrillic word edges by look-around */
const LEGAL = /(?<![\p{L}\d])(ДРУШТВО ЗА ТРГОВИЈА И УСЛУГИ|ДРУШТВО ЗА ТРГОВИЈА|ДРУШТВО ЗА ПРОМЕТ|ДООЕЛ|ДОО|ДОЕЛ|ДПТУ|АД|ТП|ЈП|ЈКП|ЛТД|УВОЗ[- ]?ИЗВОЗ|ЕКСПОРТ[- ]?ИМПОРТ|СКОПЈЕ|СТРУГА|ТЕТОВО|ГОСТИВАР|КУМАНОВО|САРАЈ|АРАЧИНОВО|СТУДЕНИЧАНИ)(?![\p{L}\d])/gu;
/** The distinctive part of a firm name, upper case (`АГРО ФАРМА ЛТД ДООЕЛ` → `АГРО ФАРМА`); '' when too short to trust. */
export function firmKey(name: string): string {
  const k = String(name).toUpperCase().replace(/["„“'.,()&-]/g, ' ').replace(/\s+/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
  return k.length >= 5 ? k : '';
}

/** Latin → Cyrillic (Macedonian) for matching subjects written in Latin („Agro Farma“ = „АГРО ФАРМА“). */
export function mailToCyr(s: string): string {
  const D: [string, string][] = [['dzh', 'Џ'], ['dž', 'Џ'], ['gj', 'Ѓ'], ['kj', 'Ќ'], ['lj', 'Љ'], ['nj', 'Њ'], ['zh', 'Ж'], ['ch', 'Ч'], ['sh', 'Ш'], ['dz', 'Ѕ'], ['ž', 'Ж'], ['č', 'Ч'], ['š', 'Ш'], ['ć', 'Ќ'], ['đ', 'Ѓ'], ['ë', 'Е'], ['ç', 'Ч']];
  const S: Record<string, string> = { a: 'А', b: 'Б', c: 'Ц', d: 'Д', e: 'Е', f: 'Ф', g: 'Г', h: 'Х', i: 'И', j: 'Ј', k: 'К', l: 'Л', m: 'М', n: 'Н', o: 'О', p: 'П', q: 'К', r: 'Р', s: 'С', t: 'Т', u: 'У', v: 'В', w: 'В', x: 'КС', y: 'И', z: 'З' };
  let t = s.toLowerCase();
  for (const [a, b] of D) t = t.split(a).join(b);
  return t.replace(/[a-z]/g, (c) => S[c] ?? c).toUpperCase();
}

export interface MailMatchIn {
  from: string; subject: string; text: string; fileNames: readonly string[];
  /** learned sender → firm id */
  learned: Readonly<Record<string, string>>;
  /** client users: address → their firm ids */
  userFirms: ReadonlyMap<string, readonly string[]>;
  firms: readonly MailFirm[];
  /** the office's own ЕДБ (never a client match: it is on every letter of the office) */
  ownEdb?: string | null;
}

export type MailMatch = { firmId: string; how: MailMatchHow } | { firmId: null; candidates: string[] };

export function mailMatch(a: MailMatchIn): MailMatch {
  const from = mailAddr(a.from);
  const ids = new Set(a.firms.map((f) => f.id));
  const one = (L: Iterable<string>) => { const s = [...new Set([...L].filter((x) => ids.has(x)))]; return s; };
  if (from && a.learned[from] && ids.has(a.learned[from]!)) return { firmId: a.learned[from]!, how: 'learned' };
  if (from) {
    const byMail = one([...a.firms.filter((f) => firmAddrs(f.email).includes(from)).map((f) => f.id), ...(a.userFirms.get(from) ?? [])]);
    if (byMail.length === 1) return { firmId: byMail[0]!, how: 'email' };
  }
  const own = edbDigits(a.ownEdb);
  const E = new Set(mailEdbs([a.subject, a.text, ...a.fileNames].join('\n')).filter((d) => d !== own));
  const byEdb = one(a.firms.filter((f) => { const d = edbDigits(f.edb); return !!d && E.has(d); }).map((f) => f.id));
  if (byEdb.length === 1) return { firmId: byEdb[0]!, how: 'edb' };
  const subj = ` ${mailToCyr(a.subject).replace(/[^А-ЯЃЌЉЊЏЅЈ0-9]+/gu, ' ')} `;
  const byName = one(a.firms.filter((f) => {
    const k = firmKey(f.short || f.name);
    return !!k && subj.includes(` ${k} `);
  }).map((f) => f.id));
  if (byName.length === 1) return { firmId: byName[0]!, how: 'name' };
  return { firmId: null, candidates: [...new Set([...byEdb, ...byName])] };
}

/** An attachment worth keeping: not a signature / logo picture, not a calendar invite, not empty. */
export function mailFileWanted(a: { name: string; mime: string; size: number; inline?: boolean }): boolean {
  if (!a.size || a.size > MAILIN_MAX_BYTES) return false;
  if (/\.(ics|vcf|p7s|asc|sig)$/i.test(a.name) || /pkcs7-signature|calendar|vcard/i.test(a.mime)) return false;
  if (/^winmail\.dat$/i.test(a.name)) return false;
  // logos / signature pictures: small images, or images shown inside the text
  if (/^image\//i.test(a.mime) && (a.size < 30_000 || (a.inline && a.size < 120_000))) return false;
  return true;
}
