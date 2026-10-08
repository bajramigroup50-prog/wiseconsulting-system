import 'server-only';
/**
 * Shared server helpers for the Phase 3 screens (Излез, Услуги, Одобренија, Профактури, Испратници, Влез,
 * Повратници, Е-Фактура, Скенирање, Масовно).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { effectiveChart, codes, itemBarcodes, items, type Firm } from '@wise/db';
import type { Actor } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';
import { partnerOptions } from './books';

export const actorOf = (u: SessionUser): Actor => ({ userId: u.id, role: u.role });

export interface ItemOpt { id: string; code: string | null; name: string; unit: string | null; price: number; rate: number; type: string; account: string | null; barcodes: string[]; sp: Record<string, number> }
export interface LocOpt { id: string; code: string | null; name: string; kind: 'warehouse' | 'store' }

export async function itemOptions(firmId: string): Promise<ItemOpt[]> {
  const [I, B] = await Promise.all([
    db().select().from(items).where(and(eq(items.firmId, firmId), eq(items.active, true))).orderBy(asc(items.name)),
    db().select({ itemId: itemBarcodes.itemId, barcode: itemBarcodes.barcode }).from(itemBarcodes).where(eq(itemBarcodes.firmId, firmId)),
  ]);
  return I.map((i) => ({
    id: i.id, code: i.code, name: i.name, unit: i.unit, price: Number(i.price ?? 0), rate: i.vatRate, type: i.type, account: i.revenueAccount,
    barcodes: B.filter((b) => b.itemId === i.id).map((b) => b.barcode),
    sp: ((i.data as Record<string, unknown>).sp as Record<string, number> | undefined) ?? {},
  }));
}

export async function locationOptions(firmId: string): Promise<LocOpt[]> {
  const rows = await db().select().from(codes).where(and(eq(codes.firmId, firmId), inArray(codes.cb, ['warehouse', 'store']))).orderBy(asc(codes.code));
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, kind: r.cb === 'store' ? 'store' : 'warehouse' }));
}

/** Accounts for selects, filtered by a code test. */
export async function accountOptions(firmId: string, test: (code: string) => boolean): Promise<[string, string][]> {
  return (await effectiveChart(db(), firmId)).filter((a) => test(a.code)).map((a) => [a.code, a.name]);
}

export { partnerOptions };

/** Firm settings used by the editors and prints. */
export const firmSetting = (f: Firm, k: string): string => String(((f.settings ?? {}) as Record<string, unknown>)[k] ?? '');

/** Scheme value of the firm (no office override lookup — enough for editor defaults). */
export const firmScheme = (f: Firm, k: string, def: string): string => {
  const s = (((f.settings ?? {}) as Record<string, unknown>).sch ?? {}) as Record<string, unknown>;
  const v = s[k];
  return typeof v === 'string' && v ? v : def;
};

