/**
 * Trial balance (бруто биланс) / opening journal from the text layer of a PDF, without AI: the header line with
 * „Конто“ and the saldo / debit / credit columns is found, the lines are cut into those columns and the table goes
 * through the opening-balance importer's own parser (`parseOpeningSheet`, the one used for Excel / CSV, with the row
 * reconstruction of `tb-rows.ts`: amounts on their own line, wrapped names, page headers, totals). The result has the
 * shape of the AI read (`OB_PROMPT`: rows / totals / grand), so the opening-balance screen maps it with `obFromAi`
 * like any read.
 */
import { parseOpeningSheet } from '../ledger';
import { lineText, pdfTable, type PdfLine } from './pdf-lines';

export const isObHeader = (cells: string[]): boolean => {
  const h = cells.join(' | ').toLowerCase();
  return /конто|сметка|konto/.test(h) && /салдо|должи|побарува|dolzi|pobaruva|debit|credit|saldo/.test(h);
};

export function obFromPdf(L: readonly PdfLine[]): { rows: [string, string, string, string, number, number][]; totals: [string, number, number][]; grand: [number, number] } | null {
  const T = pdfTable(L, isObHeader);
  if (!T) return null;
  // the lines above the table go along: when they repeat on the next pages (firm, title, „Страна 2“) they are skipped
  const P = parseOpeningSheet([...L.slice(0, T.at).map((l) => [lineText(l)]), T.header, ...T.rows], 'excel');
  if (!P) return null;
  return { rows: P.rows, totals: P.totals, grand: [0, 0] };
}
