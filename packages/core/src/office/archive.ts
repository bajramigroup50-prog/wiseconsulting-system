/**
 * Document archive (legacy `archRows` 6600 + fiscal-report patch 13137, `VIEWS.arhiva` 6606 + 12783, `arXlsx`):
 * every document of the firm with attached files, one row per document — purchases (Влезна фактура /
 * Фискална сметка / Увозна калкулација), outgoing invoices (Излезна фактура / Одобрение), dossier documents
 * (their category), fixed assets, employees, fiscal reports, cash vouchers. Server addition: files not linked to any
 * document appear as „Датотека“ so nothing uploaded is invisible.
 */

export interface ArchFile { id: string; name: string; mime: string }
export interface ArchRow {
  /** `<entityType>:<entityId>` or `file:<id>`. */
  key: string;
  date: string;
  kind: string;
  no: string;
  pn: string;
  /** Amount as a decimal string (money stays out of float), or null. */
  amt: string | null;
  files: ArchFile[];
  /** Screen that opens the document (legacy `arOpen`). */
  href?: string;
  /** Dossier doc id — deletable from the archive (legacy `arDel`). */
  archId?: string;
  /** Journal number of the document (legacy `nalogMap`). */
  nalog?: string;
  /** Server addition: a file attached to nothing (`file:<id>` row) — may be deleted or moved to another firm. */
  loose?: boolean;
  /** A read waiting for approval: its file can be deleted (with the unsaved read) to upload it again. */
  pend?: boolean;
  /**
   * A file attached to no document but known from its read: `archived` — the user chose „📁 Само за архива“ (not
   * posted: cancelled, a work order, a blank page…); `pending` — read, waiting for approval („За физичка проверка“);
   * `bank` — a read bank statement whose statement is not in the books (import it again); `opening` — the opening
   * balance document.
   */
  folder?: 'archived' | 'pending' | 'bank' | 'opening';
  /** Why (the read's note). */
  note?: string;
}

export interface ArchFilter { q?: string; kind?: string; from?: string; to?: string; year?: number }

/**
 * Keeping periods (law as stored in the program): invoices and the other documents — at least 5 years after the end of
 * their calendar year (ЗДДВ чл. 56 ст. 1, ЗДП чл. 48 ст. 1 – „другите документи“, дневен готовински промет); business
 * books and records (дневник, главна книга, налози, евиденции) — 10 years (ЗДП чл. 48 ст. 1). Electronic invoices are
 * kept in the form they were issued / received, authentic, intact and readable (ЗДДВ чл. 56 ст. 2–3).
 */
export const ARCH_DOC_YEARS = 5;
export const ARCH_BOOKS_YEARS = 10;
/** „Чувај до“ of a document row (31.12. of its year + 5); null for rows without a date, loose files and personnel files. */
export function archKeepUntil(r: Pick<ArchRow, 'date' | 'kind' | 'loose'>): string | null {
  if (!r.date || r.loose || r.kind === 'Вработен' || r.kind === 'Лого / потпис / печат') return null;
  return `${Number(r.date.slice(0, 4)) + ARCH_DOC_YEARS}-12-31`;
}

/** Legacy AK — kinds offered when archiving a new document. */
export const ARCH_KINDS = ['Договор', 'Анекс / одлука', 'Решение', 'Извод', 'Фискална сметка', 'Влезна фактура', 'Излезна фактура', 'Царинска декларација', 'Пописна листа', 'Даночна пријава', 'Друго'] as const;

const inYear = (d: string, y?: number) => !y || !d || d.slice(0, 4) === String(y);

/** Legacy filter: year (rows without a date always shown), kind, date range, free text over number/partner/kind/file names. */
export function archFilter(R: readonly ArchRow[], f: ArchFilter): ArchRow[] {
  let L = R.filter((r) => inYear(r.date, f.year));
  if (f.kind) L = L.filter((r) => r.kind === f.kind);
  if (f.from) L = L.filter((r) => r.date >= f.from!);
  if (f.to) L = L.filter((r) => r.date <= f.to!);
  if (f.q) {
    const q = f.q.toLowerCase();
    L = L.filter((r) => `${r.no} ${r.pn} ${r.kind} ${r.files.map((x) => x.name).join(' ')}`.toLowerCase().includes(q));
  }
  return L;
}

export const archSort = (R: ArchRow[]) => R.sort((a, b) => String(b.date).localeCompare(String(a.date)));

/** Kinds present in the year (legacy: the „Вид“ filter lists only kinds that exist). */
export const archKinds = (R: readonly ArchRow[], year?: number) => [...new Set(R.filter((r) => inYear(r.date, year)).map((r) => r.kind))].sort((a, b) => a.localeCompare(b, 'mk'));

/** Legacy `arXlsx`: oldest first. */
export function archXlsxRows(R: readonly ArchRow[]): (string | number)[][] {
  return [['Датум', 'Вид', 'Број', 'Комитент', 'Износ', 'Датотеки'],
    ...[...R].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((r) => [r.date, r.kind, r.no, r.pn, r.amt == null ? '' : Number(r.amt), r.files.map((x) => x.name).join(', ')])];
}

/** Label of a file button (legacy: PDF / Слика / Датотека · first 26 characters). */
/** How the in-page viewer shows a file: PDF / text in a frame, images inline, anything else only open / download. */
export const archPreviewKind = (mime: string, name = ''): 'frame' | 'img' | 'none' =>
  /^image\//.test(mime) && !/tiff/.test(mime) ? 'img'
    : /pdf|^text\/|^application\/(xml|json)$/.test(mime) || /\.(pdf|txt|csv|xml)$/i.test(name) ? 'frame' : 'none';

export const archFileLabel = (f: ArchFile) => `${/pdf/.test(f.mime) ? 'PDF' : /image/.test(f.mime) ? 'Слика' : 'Датотека'} · ${f.name.slice(0, 26)}`;

/**
 * Деловодник (the archive register, Уредба за канцелариско и архивско работење): every document of the year once, under
 * a serial number per book – 01 примени (влезни) документи, 02 испратени (излезни), 03 други / внатрешни – as
 * `<book>-<serial>/<yy>`, in the order of the documents' dates (the same date: by the document's key, so the numbers
 * do not move between two openings). Loose files and the firm's logo / stamp are not documents and are not entered.
 */
export type RegBook = 'in' | 'out' | 'other';
export const REG_BOOKS: Record<RegBook, string> = { in: '01 · Примени (влезни) документи', out: '02 · Испратени (излезни) документи', other: '03 · Други / внатрешни документи' };
const REG_PREFIX: Record<RegBook, string> = { in: '01', out: '02', other: '03' };
const OUT_KINDS = new Set(['Излезна фактура', 'Одобрение', 'Испратница', 'Профактура']);
const IN_KINDS = new Set(['Влезна фактура', 'Увозна калкулација', 'Фискална сметка', 'Извод', 'Извод – не е увезен', 'Архивирано – не се книжи', 'Чека одобрување']);
export const regBookOf = (r: Pick<ArchRow, 'kind'>): RegBook => OUT_KINDS.has(r.kind) ? 'out' : IN_KINDS.has(r.kind) ? 'in' : 'other';
/** `sign` – the архивски (класификационен) знак of the document's category; `keepUntil` – kept until (null = трајно). */
export interface RegRow extends ArchRow { book: RegBook; rb: number; regNo: string; sign: string; keepUntil: string | null }
export function delovodnik(R: readonly ArchRow[], year: number): RegRow[] {
  const L = R.filter((r) => !!r.date && r.date.slice(0, 4) === String(year) && !r.loose && r.kind !== 'Лого / потпис / печат')
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const n: Record<RegBook, number> = { in: 0, out: 0, other: 0 };
  return L.map((r) => {
    const book = regBookOf(r);
    const rb = ++n[book];
    const sign = archSignOf(r.kind);
    return { ...r, book, rb, regNo: `${REG_PREFIX[book]}-${rb}/${String(year).slice(2)}`, sign, keepUntil: archCategoryKeep(sign, r.date) };
  });
}

/* ---------------- Листа на категории на документарен материјал (Закон за архивски материјал, Уредба) ---------------- */

/**
 * One category of the „Листа на категории на документарен материјал со рокови на чување“: the архивски
 * (класификационен) знак – group-subgroup – the name, the keeping period in years (null = трајно), from when it runs,
 * and the legal basis. The list is the office's own act and is approved by the State Archive (Државен архив).
 */
export interface ArchCategory { sign: string; group: string; n: string; years: number | null; from: 'year' | 'end'; basis: string; archival: boolean }
export const ARCH_GROUPS: Record<string, string> = {
  '01': 'Основање, организација и управување', '02': 'Работни односи', '03': 'Финансиско-материјално и сметководствено работење',
  '04': 'Договори и деловна кореспонденција', '05': 'Спречување перење пари и заштита на лични податоци', '06': 'Канцелариско и архивско работење', '07': 'Информатички систем',
};
const C = (sign: string, n: string, years: number | null, basis: string, from: 'year' | 'end' = 'year'): ArchCategory => ({ sign, group: sign.slice(0, 2), n, years, from, basis, archival: years == null });
/** The categories of an accounting office (its own material and the clients' material it keeps). */
export const ARCH_CATEGORIES: readonly ArchCategory[] = [
  C('01-01', 'Основачки акти, решенија и акти од Централен регистар, одлуки на основачот и управителот', null, 'Закон за трговските друштва; Закон за архивски материјал'),
  C('01-02', 'Општи и интерни акти: систематизација, правилници, политики и постапки на системот за управување (ISO)', null, 'Закон за архивски материјал'),
  C('01-03', 'Записници од преглед од раководството и од внатрешни и надворешни (сертификациски) проверки', 10, 'ISO 9001 §9.2–9.3'),
  C('02-01', 'Персонални досиеја: договори за вработување, анекси, решенија, М1/М2 пријави', null, 'Закон за евиденции во областа на трудот; Закон за работните односи'),
  C('02-02', 'Плати: рекапитулари, пресметки, МПИН, платни листи', null, 'Закон за евиденции во областа на трудот (пензиски стаж) – трајно'),
  C('02-03', 'Евиденција на работно време, отсуства, годишни одмори, боледувања', 5, 'Закон за евиденции во областа на трудот; ЗРО'),
  C('02-04', 'Безбедност и здравје при работа: изјава за безбедност, обуки, прва помош, заштита од пожар', 10, 'Закон за безбедност и здравје при работа'),
  C('02-05', 'Евиденција за повреди на работа и професионални болести', null, 'Закон за безбедност и здравје при работа'),
  C('03-01', 'Деловни книги: дневник, главна книга, аналитички евиденции, налози за книжење', 10, 'Закон за сметководство; ЗДП чл. 48'),
  C('03-02', 'Годишни сметки и финансиски извештаи', null, 'Закон за сметководство; Закон за архивски материјал'),
  C('03-03', 'Излезни фактури, одобренија, профактури, испратници', 5, 'ЗДДВ чл. 56; ЗДП чл. 48'),
  C('03-04', 'Влезни фактури, фискални сметки, увозни калкулации', 5, 'ЗДДВ чл. 56; ЗДП чл. 48'),
  C('03-05', 'Банкарски изводи, благајнички документи, налози за плаќање', 5, 'ЗДП чл. 48'),
  C('03-06', 'Пописни листи, основни средства, амортизација', 10, 'Закон за сметководство'),
  C('03-07', 'Даночни пријави и биланси (ДДВ, данок на добивка, персонален данок)', 10, 'ЗДП чл. 48'),
  C('03-08', 'Царински документи', 5, 'Царински закон; ЗДП'),
  C('04-01', 'Договори со клиенти за сметководствени услуги и анекси', 10, 'Закон за облигационите односи – по престанок на договорот', 'end'),
  C('04-02', 'Договори со добавувачи и деловни партнери, договори за обработка на лични податоци', 10, 'Закон за облигационите односи – по престанок', 'end'),
  C('04-03', 'Деловна кореспонденција, понуди, барања', 5, 'Уредба за канцелариско и архивско работење'),
  C('04-04', 'Решенија и записници од инспекциски органи (УЈП, ДИТ, АЗЛП…), жалби', 10, 'ЗДП; Закон за инспекциски надзор'),
  C('05-01', 'Анализа на клиент (АМЛ досие) и документи за мерките', 10, 'ЗСПППФТ – по престанок на деловниот однос', 'end'),
  C('05-02', 'Евиденција на обработки, барања од субјекти, повреди на безбедноста на личните податоци', 5, 'ЗЗЛП'),
  C('05-03', 'Записници за уништување на документарен материјал и носачи на податоци', null, 'Закон за архивски материјал; ЗЗЛП'),
  C('06-01', 'Деловодник (книги 01 примени, 02 испратени, 03 внатрешни)', null, 'Уредба за канцелариско и архивско работење'),
  C('06-02', 'Архивска книга', null, 'Закон за архивски материјал'),
  C('06-03', 'Листа на категории, записници за предавање во архива и за излачување', null, 'Закон за архивски материјал'),
  C('07-01', 'Дневник на промени и пристап во програмата', 10, 'ISO 27001 A.8.15; ЗДП (следливост на книжењата)'),
  C('07-02', 'Записи за тестови на враќање, инциденти, преглед на пристап', 5, 'ISO 27001 A.5.24, A.8.13'),
];
export const archCategory = (sign: string) => ARCH_CATEGORIES.find((c) => c.sign === sign);
export const archKeepLabel = (c: Pick<ArchCategory, 'years' | 'from'>) => (c.years == null ? 'трајно' : `${c.years} години${c.from === 'end' ? ' по престанок' : ''}`);
const KIND_SIGN: Record<string, string> = {
  'Излезна фактура': '03-03', 'Одобрение': '03-03', 'Профактура': '03-03', 'Испратница': '03-03',
  'Влезна фактура': '03-04', 'Фискална сметка': '03-04', 'Увозна калкулација': '03-04', 'Архивирано – не се книжи': '03-04', 'Чека одобрување': '03-04',
  'Извод': '03-05', 'Извод – не е увезен': '03-05', 'Благајна': '03-05', 'Пописна листа': '03-06', 'Основно средство': '03-06',
  'Даночна пријава': '03-07', 'Царинска декларација': '03-08', 'Решение': '01-01', 'Договор': '04-02', 'Анекс / одлука': '04-02', 'Вработен': '02-01',
};
/** The архивски знак of a document by its kind (unknown kinds: correspondence 04-03). */
export const archSignOf = (kind: string) => KIND_SIGN[kind] ?? '04-03';
/** Kept until 31.12. of (the document's year + the years); null = трајно or a period that runs from the end of a contract. */
export function archCategoryKeep(sign: string, date: string): string | null {
  const c = archCategory(sign);
  if (!c || c.years == null || c.from === 'end' || !date) return null;
  return `${Number(date.slice(0, 4)) + c.years}-12-31`;
}
