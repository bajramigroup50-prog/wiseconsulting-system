import 'server-only';
/** Finance parity: helpers for export routes (legacy `xlsx` / `csv` downloads). */
import * as XLSX from 'xlsx';
import { vatAccount } from '@wise/core/vat';
import { loadVatPostingContext, missingAccounts, type Firm } from '@wise/db';
import { db } from './db';
import { getUser } from './auth';
import { currentFirm, currentYear } from './context';
import { toCsv } from './fmt';
import { viewAllowed } from './nav';

export type Cell = string | number | null;

/** Route guard: signed in, allowed to open the view, current firm selected. */
export async function routeFirm(view: string) {
  const u = await getUser();
  if (!u || !viewAllowed(u.role, view)) return null;
  const firm = await currentFirm(u);
  if (!firm) return null;
  return { u, firm, year: await currentYear() };
}

const ascii = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** .xlsx (or `;` CSV with BOM when `csv`) download response. */
export function sheetResponse(name: string, rows: Cell[][], o: { csv?: boolean; sheet?: string } = {}): Response {
  if (o.csv) {
    return new Response(toCsv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${ascii(name)}.csv"` } });
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = (rows[0] ?? []).map((_, i) => ({ wch: Math.min(60, Math.max(8, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (o.sheet ?? 'Лист').slice(0, 31));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${ascii(name)}.xlsx"` },
  });
}

/**
 * Legacy `ACC()` 3278: the firm's VAT kontos (tariffs / schemes, per rate) are part of the chart even when the
 * standard chart has no such analytic konto („Претходен ДДВ r%“ / „Обврски за ДДВ r%“). Here they are added as firm
 * accounts so postings to them pass the chart check.
 */
export async function missingVatAccounts(firm: Firm): Promise<{ code: string; name: string }[]> {
  const ctx = await loadVatPostingContext(db(), firm);
  const want = new Map<string, string>();
  for (const r of [18, 10, 5]) {
    const o = vatAccount(ctx, 'out', r), i = vatAccount(ctx, 'in', r), m = vatAccount(ctx, 'imp', r);
    if (i && !want.has(i)) want.set(i, `Претходен ДДВ ${r}%`);
    if (m && !want.has(m)) want.set(m, `Претходен ДДВ ${r}%`);
    if (o && !want.has(o)) want.set(o, `Обврски за ДДВ ${r}%`);
  }
  const miss = await missingAccounts(db(), firm.id, [...want.keys()]);
  return miss.map((code) => ({ code, name: want.get(code)! }));
}

