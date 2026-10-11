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
}

export interface ArchFilter { q?: string; kind?: string; from?: string; to?: string; year?: number }

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
export const archFileLabel = (f: ArchFile) => `${/pdf/.test(f.mime) ? 'PDF' : /image/.test(f.mime) ? 'Слика' : 'Датотека'} · ${f.name.slice(0, 26)}`;
