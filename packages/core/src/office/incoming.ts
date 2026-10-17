/**
 * „📥 Пристигнати документи“ (UX P7 / P32, docs/ux-rindertim.md): ONE inbox for every file that arrives — uploaded in
 * the inbox, sent by the client (portal / 📷 phone), read on the scan screens, an МПИН. Pure rules, shared by the web
 * screen, the db helpers and the worker job `incoming.detect`:
 *
 *  - the detected type of a file, FREE FIRST (owner policy: AI only when nothing free can do it, on the user's click):
 *    the file format, the XML root, the bank-statement detector (`detectStatementFormat`), the text of a PDF / Word
 *    (`classifyText`) — a photo or a scan without text stays „непрепознаено“ until the user asks the AI;
 *  - where a type goes (the scan review, the bank import, the МПИН list, the dossier);
 *  - which firm a bank statement belongs to by its account / IBAN: the inbox's own firm → imported automatically;
 *    another firm the user may access → only proposed (never imported across firms automatically); none → waits.
 */
import { decodeBankBytes, detectStatementFormat, parseStatementFile, type Statement } from '../bank-parsers';
import { statementAccount } from '../bank/statements';
import { classifyText, classifyUbl } from '../noai/classify';
import type { ClassifyKind } from '../ai/classify';
import type { InboxRoute } from './portal';
import { fileFormatLabel, isDocxFile, isImageFile, isPdfFile, isXmlFile, type IncomingFile } from './file-format';

export { acceptsFile, fileFormatLabel, type IncomingFile } from './file-format';

export const INCOMING_JOB = 'incoming.detect';

/** Detected type of an incoming file. `unknown` = not recognised (yet). */
export const INCOMING_KINDS = {
  in: 'Влезна фактура', out: 'Излезна фактура', bank: 'Извод', mpin: 'МПИН', decision: 'Решение', contract: 'Договор', other: 'Друго', unknown: 'Непрепознаено',
} as const;
export type IncomingKind = keyof typeof INCOMING_KINDS;
export const isIncomingKind = (k: unknown): k is IncomingKind => typeof k === 'string' && Object.hasOwn(INCOMING_KINDS, k);

export const INCOMING_STATUS = { unread: 'непрочитан', read: 'прочитан', done: 'обработен', skipped: 'прескокнат' } as const;
export type IncomingStatus = keyof typeof INCOMING_STATUS;

/** Where a file came from. */
export const INCOMING_SOURCES = {
  upload: '📥 Прикачено', portal: '👥 Портал (клиент)', capture: '📷 Телефон (клиент)', mail: '✉ Е-пошта', scan: '🧾 Скенирање', mpin: '🧮 МПИН',
} as const;
export type IncomingSource = keyof typeof INCOMING_SOURCES;

/** How the type was found. */
export type DetectHow = 'format' | 'xml' | 'bank' | 'text' | 'client' | 'ai' | 'none';
export const DETECT_HOW: Record<DetectHow, string> = {
  format: 'формат на датотеката', xml: 'XML', bank: 'формат на извод', text: 'текст на документот', client: 'според клиентот', ai: 'AI', none: '',
};

export interface StatementBrief { account: string; iban: string; currency: string; no: string; date: string; lines: number }

export interface IncomingDetect {
  kind: IncomingKind;
  how: DetectHow;
  /** Short description („Извод camt.053“, „Влезна е-фактура (UBL)“, „Фотографија“). */
  what: string;
  /** Not recognisable without AI (a photo, a scan, a text without clear words). */
  needsAi: boolean;
  /** Bank statement format (`detectStatementFormat`) when it is a structured statement. */
  format?: string;
  /** The statements a structured statement file holds (parsed, ready for the import). */
  statements?: Statement[];
}


const isImage = isImageFile, isPdf = isPdfFile, isXml = isXmlFile, isDocx = isDocxFile;
const isText = (f: IncomingFile) => /\.(txt|csv)$/i.test(f.name) || f.mime === 'text/plain' || f.mime === 'text/csv';

const FMT_LBL: Record<string, string> = { 'halk-xml': 'XML (Халк)', 'camt.053': 'camt.053', mt940: 'MT940', kb: 'КБ .300', table: 'табела' };

const DECISION = /(?<!\p{L})решение(?!\p{L})/iu;
const CONTRACT = /(?<!\p{L})договор(?!\p{L})/iu;
const MPIN = /мпин|декларација\s+за\s+прием/iu;

/** The kind of the free / AI classification (`ClassifyKind`) as an inbox type. */
export function incomingFromClassify(k: ClassifyKind | null | undefined): IncomingKind {
  switch (k) {
    case 'purchase': return 'in';
    case 'sale': return 'out';
    case 'bank': return 'bank';
    case 'payroll': return 'mpin';
    case 'employee': return 'contract';
    case null: case undefined: return 'unknown';
    default: return 'other';
  }
}

/** The client's „📷 what it is“ (`CAPTURE_KINDS`) as an inbox type. */
export function incomingFromCapture(k: string | null | undefined): IncomingKind {
  return k === 'in' ? 'in' : k === 'out' ? 'out' : k === 'bank' ? 'bank' : k === 'contract' ? 'contract' : k === 'fisk' || k === 'other' ? 'other' : 'unknown';
}

const briefOf = (S: readonly Statement[]): StatementBrief[] => S.map((s) => ({ account: s.account, iban: s.iban ?? '', currency: s.currency || 'MKD', no: s.no, date: s.date, lines: s.lines.length }));
export const statementBriefs = briefOf;

/**
 * Detect the type of one file, without AI. `text` = the text layer of a PDF / Word (extracted by the worker; null =
 * none, e.g. a scan). `ownEdb` decides issued vs received invoices.
 */
export function detectIncoming(file: IncomingFile, bytes: Uint8Array, o: { text?: string | null; ownEdb?: string | null } = {}): IncomingDetect {
  // 1. structured bank statements (XML Халк / camt.053, MT940, КБ, CSV/TXT table) — exact, read as they are
  if (!isPdf(file) && !isImage(file) && !isDocx(file)) {
    const fmt = detectStatementFormat(bytes, file.name);
    if (fmt !== 'ai' && fmt !== 'excel') {
      const S = (parseStatementFile(bytes, file.name) ?? []).filter((s) => s.lines.length || s.opening != null || s.closing != null);
      if (S.length) return { kind: 'bank', how: 'bank', what: `Извод ${FMT_LBL[fmt] ?? fmt}`, needsAi: false, format: fmt, statements: S };
    }
  }
  if (isImage(file)) return { kind: 'unknown', how: 'format', what: 'Фотографија / скен', needsAi: true };
  const dec = () => decodeBankBytes(bytes);
  // 2. XML by its root: a UBL e-invoice (seller ЕДБ → issued / received), else just „XML“
  if (isXml(file)) {
    const x = dec();
    const u = classifyUbl(x, o);
    if (u) return { kind: incomingFromClassify(u.kind), how: 'xml', what: u.what, needsAi: false };
    if (/<(\w+:)?(Invoice|CreditNote)[\s>]/.test(x)) return { kind: 'in', how: 'xml', what: 'Е-фактура (UBL)', needsAi: false };
    const root = /<([A-Za-z_][\w:.-]*)[\s>]/.exec(x.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, ''))?.[1] ?? '';
    return { kind: 'other', how: 'xml', what: root ? `XML (${root})` : 'XML', needsAi: false };
  }
  // 3. the text of a PDF / Word / TXT
  const text = o.text ?? (isText(file) ? dec() : null);
  if (text && text.trim()) {
    const head = text.slice(0, 4000);
    const c = classifyText(text, o);
    if (c && ['payroll', 'bank', 'fiscal'].includes(c.kind)) return { kind: incomingFromClassify(c.kind), how: 'text', what: c.what, needsAi: false };
    if (MPIN.test(head)) return { kind: 'mpin', how: 'text', what: 'МПИН', needsAi: false };
    if (DECISION.test(head)) return { kind: 'decision', how: 'text', what: 'Решение', needsAi: false };
    if (CONTRACT.test(head)) return { kind: 'contract', how: 'text', what: 'Договор', needsAi: false };
    if (c) return { kind: incomingFromClassify(c.kind), how: 'text', what: c.what, needsAi: false };
    return { kind: 'unknown', how: 'none', what: 'Документ со текст – видот не е јасен', needsAi: true };
  }
  if (isPdf(file)) return { kind: 'unknown', how: 'format', what: 'Скениран PDF (без текст)', needsAi: true };
  return { kind: 'unknown', how: 'none', what: `Непознат формат (${fileFormatLabel(file)})`, needsAi: false };
}

/** Where a type goes from the inbox (`INBOX_ROUTES`) and, for the dossier, its category. */
export function incomingRoute(k: IncomingKind): { route: InboxRoute; category?: string } | null {
  switch (k) {
    case 'in': return { route: 'purchase' };
    case 'out': return { route: 'sale' };
    case 'bank': return { route: 'bank' };
    case 'mpin': return { route: 'payroll' };
    case 'decision': return { route: 'dossier', category: 'Решенија и потврди од УЈП / ФЗО / ПИОМ' };
    case 'contract': return { route: 'dossier', category: 'Договори (закуп, соработка, кредит)' };
    case 'other': return { route: 'dossier', category: 'Друго' };
    default: return null;
  }
}

export interface FirmAccounts { id: string; name: string; accounts: readonly { id: string; account: string | null; iban: string | null; cur?: string | null }[] }

export type BankMatch =
  | { mode: 'import'; firmId: string; accountId: string }
  | { mode: 'propose'; firms: { id: string; name: string }[] }
  | { mode: 'wait' };

/**
 * Which firm a statement belongs to, by its account / IBAN (last 10 digits, `statementAccount`). `firmId` = the firm
 * the file arrived in (null = office-wide); `firms` = the firms the user may access (with their bank accounts).
 * Only the arriving firm's own account imports; another accessible firm is proposed; nothing → wait for a decision.
 */
export function bankMatch(st: readonly Pick<Statement, 'account' | 'iban' | 'currency'>[], firmId: string | null, firms: readonly FirmAccounts[]): BankMatch {
  if (!st.length) return { mode: 'wait' };
  const hits = (f: FirmAccounts) => st.map((s) => statementAccount(s, f.accounts.map((a) => ({ ...a, account: a.account ?? '', cur: a.cur ?? 'MKD' }))));
  const own = firmId ? firms.find((f) => f.id === firmId) : undefined;
  if (own) {
    const H = hits(own);
    // every statement of the file must be the firm's own (a file of two firms is never imported automatically)
    if (H.every(Boolean)) return { mode: 'import', firmId: own.id, accountId: H[0]!.id };
  }
  const other = firms.filter((f) => f.id !== firmId && hits(f).some(Boolean));
  if (other.length) return { mode: 'propose', firms: other.map((f) => ({ id: f.id, name: f.name })) };
  return { mode: 'wait' };
}
