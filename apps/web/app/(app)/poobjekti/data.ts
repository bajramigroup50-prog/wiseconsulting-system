import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { codes } from '@wise/db';
import { inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { today } from '@/lib/finance';

/** Legacy `rangeOf('po')` 4915: from = 1 Jan, to = today (current year) or 31 Dec. */
export function poRange(sp: { from?: string; to?: string }, year: number) {
  const td = today();
  return { from: inYearOr(sp.from, year, `${year}-01-01`), to: inYearOr(sp.to, year, td.startsWith(String(year)) ? td : `${year}-12-31`) };
}

/** Warehouses and stores of the firm (legacy `locs()`), id → name. */
export async function locationNames(firmId: string): Promise<Map<string, string>> {
  const L = await db().select({ id: codes.id, name: codes.name, code: codes.code }).from(codes)
    .where(and(eq(codes.firmId, firmId), inArray(codes.cb, ['warehouse', 'store'])));
  return new Map(L.map((c) => [c.id, (c.code ? c.code + ' ' : '') + c.name]));
}
