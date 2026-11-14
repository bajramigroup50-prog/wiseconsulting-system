/**
 * „✉ Е-пошта → WISE“ (pure): the office mailbox (info@…) read by the worker (`mail.in`); every attachment of a client's
 * mail goes to „📥 Пристигнати документи“ (`incoming_docs`, source `mail`) of the firm it belongs to.
 *
 * The firm is found, in this order:
 *   1. the sender learned from the office (the office once gave a mail from this address to a firm),
 *   2. the sender is the firm's e-mail or a client user's e-mail of exactly one firm,
 *   3. exactly one firm's ЕДБ in the subject, the text or the file name,
 *   4. exactly one firm's name (without ДООЕЛ / ДОО / Скопје…) in the subject.
 * Before all that, the attachment's own text (PDF text layer, `content`) is read: a document for one of our firms can
 * come from anyone (a supplier, the bank, the client's client). One firm's ЕДБ in it (else one firm's bank account)
 * decides; with several, the sender's firm when it is one of them, else the sender rules apply.
 * Several or none → it waits in the office inbox („изберете фирма“), never guessed.
 */

export const MAILIN_JOB = 'mail.in';
/** Mails older than this are never read on the first run (the office can change it). */
export const MAILIN_DEFAULT_DAYS = 30;
/** Files larger than this are skipped (a note on the log). */
export const MAILIN_MAX_BYTES = 25 * 1024 * 1024;

export type MailMatchHow = 'learned' | 'email' | 'edb' | 'name' | 'doc' | 'account';
export const MAILIN_HOW: Record<MailMatchHow, string> = {
  learned: 'испраќачот (запаметен)', email: 'е-поштата на фирмата', edb: 'ЕДБ во пораката', name: 'името на фирмата во насловот',
  doc: 'ЕДБ во самиот документ', account: 'жиро-сметката во документот',
};

export interface MailFirm { id: string; name: string; edb: string | null; email: string | null; short?: string | null; accounts?: readonly string[] }

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

/** A Macedonian account as 15 digits (`270-0706421701-96`, `MK07 2700 7064 2170 196` → `270070642170196`); '' otherwise. */
export function acctDigits(v: string | null | undefined): string {
  let d = String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^MK\d{17}$/.test(d)) d = d.slice(4);
  return /^\d{15}$/.test(d) ? d : '';
}

/** Every account number of a text (15 digits, with or without dashes / spaces, or an MK IBAN). */
export function mailAccounts(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text).matchAll(/(?:MK\s?\d{2}[\s-]?)?\d[\d\s-]{13,22}\d/gi)) {
    const a = acctDigits(m[0]); if (a) out.add(a);
    const d = m[0].replace(/\D/g, ''); if (d.length === 15) out.add(d);
  }
  return [...out];
}

/** How much of a document's text is its head (the account holder of a statement). */
export const DOC_HEAD = 2000;

/** The firms a document's own text names: by ЕДБ (never the office's own), else by bank account. */
export function docFirms(content: string, firms: readonly MailFirm[], ownEdb?: string | null): { ids: string[]; how: 'doc' | 'account' } {
  const own = edbDigits(ownEdb);
  const E = new Set(mailEdbs(content).filter((d) => d !== own));
  const byEdb = [...new Set(firms.filter((f) => { const d = edbDigits(f.edb); return !!d && E.has(d); }).map((f) => f.id))];
  if (byEdb.length === 1) return { ids: byEdb, how: 'doc' };
  // the account in the head of the document (a statement lists the other side's accounts further down)
  const A = new Set(mailAccounts(content.slice(0, DOC_HEAD)));
  const byAcc = [...new Set(firms.filter((f) => (f.accounts ?? []).some((a) => A.has(acctDigits(a)))).map((f) => f.id))];
  if (byAcc.length === 1 || !byEdb.length) return { ids: byAcc, how: 'account' };
  return { ids: byEdb, how: 'doc' };
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

/**
 * The real sender of a forwarded mail: a mail from one of the office's own addresses (Hotmail → info@ forwarding) or
 * with „Fw:/Fwd:/Пр:“ carries the client's address in its text („From: …“, „Од: …“, „Gönderen: …“, „Nga: …“).
 * Returns that address, or the sender itself.
 */
export function mailOrigin(from: string, subject: string, text: string, office: readonly string[]): string {
  const f = mailAddr(from);
  const O = new Set(office.map((x) => mailAddr(x)).filter(Boolean));
  const fwd = /^\s*((re|aw|odg)\s*:\s*)*(fw|fwd|tr|wg|пр|препрати)\s*:/i.test(subject);
  if (!O.has(f) && !fwd) return f;
  for (const m of String(text).matchAll(/^[>\s*]*(?:from|од|oд|gönderen|nga|von|de)\s*:[^\n]*?([^\s<>"',;:]+@[^\s<>"',;]+\.[a-z]{2,})/gimu)) {
    const a = m[1]!.toLowerCase();
    if (!O.has(a)) return a;
  }
  return f;
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
  /** the attachment's own text (PDF text layer), when it has one */
  content?: string;
}

export type MailMatch = { firmId: string; how: MailMatchHow } | { firmId: null; candidates: string[] };

export function mailMatch(a: MailMatchIn): MailMatch {
  const bySender = senderMatch(a);
  if (a.content?.trim()) {
    const D = docFirms(a.content, a.firms, a.ownEdb);
    // the sender's firm is named in the document (a client sends its supplier's invoice): keep it
    if (bySender.firmId && D.ids.includes(bySender.firmId)) return bySender;
    if (D.ids.length === 1) return { firmId: D.ids[0]!, how: D.how };
    if ('candidates' in bySender && D.ids.length > 1) return { firmId: null, candidates: [...new Set([...D.ids, ...bySender.candidates])] };
    // a document for the office itself (a supplier's invoice to БАЈРАМИ ГРОУП): only its ЕДБ, no client's
    const own = edbDigits(a.ownEdb);
    const ownFirm = own ? a.firms.find((f) => edbDigits(f.edb) === own) : undefined;
    if ('candidates' in bySender && !bySender.candidates.length && !D.ids.length && ownFirm && mailEdbs(a.content).includes(own)) return { firmId: ownFirm.id, how: 'doc' };
  }
  return bySender;
}

function senderMatch(a: MailMatchIn): MailMatch {
  const from = mailAddr(a.from);
  const ids = new Set(a.firms.map((f) => f.id));
  const one = (L: Iterable<string>) => { const s = [...new Set([...L].filter((x) => ids.has(x)))]; return s; };
  if (from && a.learned[from] && ids.has(a.learned[from]!)) return { firmId: a.learned[from]!, how: 'learned' };
  if (from) {
    const byMail = one([...a.firms.filter((f) => firmAddrs(f.email).includes(from)).map((f) => f.id), ...(a.userFirms.get(from) ?? [])]);
    if (byMail.length === 1) return { firmId: byMail[0]!, how: 'email' };
  }
  // the office itself (WISE = БАЈРАМИ ГРОУП) is a firm too: its ЕДБ is on every letter the office sends, so it is
  // only chosen when no client's ЕДБ is in the mail, and never by its name (the signature)
  const own = edbDigits(a.ownEdb);
  const ownFirm = own ? a.firms.find((f) => edbDigits(f.edb) === own) ?? null : null;
  const all = mailEdbs([a.subject, a.text, ...a.fileNames].join(' \n '));
  const E = new Set(all.filter((d) => d !== own));
  const byEdb = one(a.firms.filter((f) => { const d = edbDigits(f.edb); return !!d && d !== own && E.has(d); }).map((f) => f.id));
  if (byEdb.length === 1) return { firmId: byEdb[0]!, how: 'edb' };
  const subj = ` ${mailToCyr(a.subject).replace(/[^А-ЯЃЌЉЊЏЅЈ0-9]+/gu, ' ')} `;
  const byName = one(a.firms.filter((f) => {
    if (f.id === ownFirm?.id) return false;
    const k = firmKey(f.short || f.name);
    return !!k && subj.includes(` ${k} `);
  }).map((f) => f.id));
  if (byName.length === 1) return { firmId: byName[0]!, how: 'name' };
  if (ownFirm && !byEdb.length && !byName.length && all.includes(own)) return { firmId: ownFirm.id, how: 'edb' };
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
