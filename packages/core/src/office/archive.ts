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
export interface RegRow extends ArchRow { book: RegBook; rb: number; regNo: string }
export function delovodnik(R: readonly ArchRow[], year: number): RegRow[] {
  const L = R.filter((r) => !!r.date && r.date.slice(0, 4) === String(year) && !r.loose && r.kind !== 'Лого / потпис / печат')
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const n: Record<RegBook, number> = { in: 0, out: 0, other: 0 };
  return L.map((r) => {
    const book = regBookOf(r);
    const rb = ++n[book];
    return { ...r, book, rb, regNo: `${REG_PREFIX[book]}-${rb}/${String(year).slice(2)}` };
  });
}
