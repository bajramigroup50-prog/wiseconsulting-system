/**
 * Fiscal device log (audit of what the fiscal printer / cash register confirmed) — `firm_docs` rows of type `fiskr`.
 *
 *   sale / storno  created `pending` together with the POS sale (same transaction), then
 *                  `ok`     only with the receipt number the device returned (never overwritten afterwards), or
 *                  `failed` with the device error (paper out, not connected…) — the cashier can print again;
 *   z / x / cash   created `ok` after the device confirmed the report / cash movement.
 *
 * A sale is "fiscalised" only when its `fiskr` row is `ok` and carries the device's number (see docs/FISKALNI-APARATI.md).
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { fiscalConfirmed, fiscalTotal, type FiscalReceipt, type FiscalResult } from '@wise/core/retail/fiscal';
import { audit, type Tx } from './audit';
import { firmDocs } from './schema/index';
import { StockDocError } from './stock-service';

export type FiscalKind = 'sale' | 'storno' | 'z' | 'x' | 'cashIn' | 'cashOut';
export type FiscalStatus = 'pending' | 'ok' | 'failed';
export interface FiscalDeviceInfo { vendor?: string; model?: string; driver?: string }
export interface FiscalLogData {
  kind: FiscalKind;
  wh?: string | null;
  salesDayId?: string | null;
  receipt?: FiscalReceipt | null;
  total: number;
  /** storno: the original `fiskr` row and its device number */
  refId?: string | null;
  refNumber?: string | null;
  deviceTime?: string | null;
  /** total the device printed (may differ by a cent from `total` through the % discount rounding) */
  deviceTotal?: number;
  device?: FiscalDeviceInfo | null;
  error?: string | null;
  code?: string | null;
  attempts?: number;
  confirmedAt?: string | null;
}
export interface FiscalLogRow { id: string; number: string | null; date: string | null; status: string; data: FiscalLogData; createdAt: Date }

const TYPE = 'fiskr';
const fail = (m: string): never => { throw new StockDocError(m); };
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);
const cleanDevice = (d: FiscalResult['device']): FiscalDeviceInfo | null =>
  d ? { vendor: clip(d.vendor, 20), model: clip(d.model, 40), driver: clip(d.driver, 10) } : null;

async function lockRow(tx: Tx, firmId: string, id: string) {
  const [r] = await tx.select().from(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, firmId), eq(firmDocs.type, TYPE))).for('update').limit(1);
  return r ?? fail('Записот за фискалната сметка не постои.');
}

/** A receipt waiting for the device (status `pending`). Returns the row id. */
export async function createFiscalPending(tx: Tx, a: { firmId: string; userId: string | null }, x: {
  kind: 'sale' | 'storno'; date: string; wh?: string | null; salesDayId?: string | null; receipt: FiscalReceipt; refId?: string | null; refNumber?: string | null;
}): Promise<string> {
  const data: FiscalLogData = {
    kind: x.kind, wh: x.wh ?? null, salesDayId: x.salesDayId ?? null, receipt: x.receipt, total: fiscalTotal(x.receipt),
    refId: x.refId ?? null, refNumber: x.refNumber ?? null, attempts: 0,
  };
  const [r] = await tx.insert(firmDocs).values({ firmId: a.firmId, type: TYPE, date: x.date, status: 'pending', data: data as unknown as Record<string, unknown>, createdBy: a.userId }).returning({ id: firmDocs.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fiskrNew', entityType: 'firm_doc', entityId: r!.id, data: { kind: x.kind, total: data.total, salesDayId: data.salesDayId } });
  return r!.id;
}

/**
 * The device's answer for a pending / failed receipt. Confirmed (ok + number) → `ok` with the number; anything else →
 * `failed` with the error. An `ok` row is final: a second confirmation with another number is refused.
 */
export async function recordFiscalResult(tx: Tx, a: { firmId: string; userId: string | null }, id: string, res: unknown): Promise<{ status: FiscalStatus; number: string | null }> {
  const row = await lockRow(tx, a.firmId, id);
  const data = row.data as unknown as FiscalLogData;
  if (data.kind !== 'sale' && data.kind !== 'storno') fail('Записот не е фискална сметка.');
  const r = (res ?? {}) as FiscalResult;
  if (row.status === 'ok') {
    if (fiscalConfirmed(r) && r.number!.trim() === row.number) return { status: 'ok', number: row.number };
    fail(`Сметката е веќе фискализирана (бр. ${row.number}).`);
  }
  if (fiscalConfirmed(r)) {
    const number = r.number.trim();
    const next: FiscalLogData = {
      ...data, deviceTime: r.time ? clip(r.time, 19) : null, device: cleanDevice(r.device), error: null, code: null,
      attempts: (data.attempts ?? 0) + 1, confirmedAt: new Date().toISOString(),
      ...(typeof r.total === 'number' && Number.isFinite(r.total) ? { deviceTotal: r.total } : {}),
    };
    await tx.update(firmDocs).set({ status: 'ok', number, data: next as unknown as Record<string, unknown> }).where(eq(firmDocs.id, id));
    await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fiskrOk', entityType: 'firm_doc', entityId: id, data: { kind: data.kind, number, total: data.total, device: next.device } });
    return { status: 'ok', number };
  }
  const next: FiscalLogData = { ...data, error: clip(r.error || 'Апаратот не ја потврди сметката.', 300), code: clip(r.code || 'DEVICE_ERROR', 30), attempts: (data.attempts ?? 0) + 1 };
  await tx.update(firmDocs).set({ status: 'failed', data: next as unknown as Record<string, unknown> }).where(eq(firmDocs.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fiskrFail', entityType: 'firm_doc', entityId: id, data: { kind: data.kind, code: next.code } });
  return { status: 'failed', number: null };
}

/** A storno (refund) receipt of a fiscalised sale: same items and payment split, the original number as reference. */
export async function createFiscalStorno(tx: Tx, a: { firmId: string; userId: string | null }, origId: string, date: string): Promise<{ id: string; receipt: FiscalReceipt }> {
  const o = await lockRow(tx, a.firmId, origId);
  const od = o.data as unknown as FiscalLogData;
  if (od.kind !== 'sale') fail('Сторно може само за фискална сметка од продажба.');
  const no = o.status === 'ok' && o.number ? o.number : fail('Сметката не е фискализирана — нема што да се сторнира.');
  const others = await tx.select().from(firmDocs).where(and(eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, TYPE)));
  const prev = others.find((r) => (r.data as unknown as FiscalLogData).kind === 'storno' && (r.data as unknown as FiscalLogData).refId === origId);
  if (prev) {
    if (prev.status === 'ok') fail(`Сметката е веќе сторнирана (сторно бр. ${prev.number}).`);
    return { id: prev.id, receipt: (prev.data as unknown as FiscalLogData).receipt! }; // pending / failed storno → print it again
  }
  const receipt: FiscalReceipt = { ...od.receipt!, ref: no };
  const id = await createFiscalPending(tx, a, { kind: 'storno', date, wh: od.wh ?? null, salesDayId: od.salesDayId ?? null, receipt, refId: origId, refNumber: no });
  return { id, receipt };
}

/** Z / X report or cash in / out that the device already confirmed. */
export async function recordFiscalReport(tx: Tx, a: { firmId: string; userId: string | null }, x: {
  kind: 'z' | 'x' | 'cashIn' | 'cashOut'; date: string; wh?: string | null; result: unknown; amount?: number | null;
}): Promise<string> {
  const r = (x.result ?? {}) as FiscalResult;
  if (!r || r.ok !== true) fail('Апаратот не го потврди извештајот.');
  if (x.kind === 'z' && !fiscalConfirmed(r)) fail('Апаратот не врати број на дневниот извештај.');
  const total = x.kind === 'cashIn' || x.kind === 'cashOut' ? Math.abs(Number(x.amount) || 0) : Number(r.total) || 0;
  const data: FiscalLogData = { kind: x.kind, wh: x.wh ?? null, total, device: cleanDevice(r.device), deviceTime: r.time ? clip(r.time, 19) : null, confirmedAt: new Date().toISOString() };
  const number = r.number ? clip(r.number, 20) : null;
  const [row] = await tx.insert(firmDocs).values({ firmId: a.firmId, type: TYPE, date: x.date, number, status: 'ok', data: data as unknown as Record<string, unknown>, createdBy: a.userId }).returning({ id: firmDocs.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'fiskrReport', entityType: 'firm_doc', entityId: row!.id, data: { kind: x.kind, number, total } });
  return row!.id;
}

/** The fiscal log of a firm for a date range (newest first). */
export async function listFiscalLog(tx: Tx, firmId: string, from: string, to: string): Promise<FiscalLogRow[]> {
  const R = await tx.select().from(firmDocs)
    .where(and(eq(firmDocs.firmId, firmId), eq(firmDocs.type, TYPE), gte(firmDocs.date, from), lte(firmDocs.date, to)))
    .orderBy(desc(firmDocs.createdAt));
  return R.map((r) => ({ id: r.id, number: r.number, date: r.date, status: r.status, data: r.data as unknown as FiscalLogData, createdAt: r.createdAt }));
}

/** One row of the fiscal log (null when it does not exist / belongs to another firm). */
export async function getFiscalLog(tx: Tx, firmId: string, id: string): Promise<FiscalLogRow | null> {
  const [r] = await tx.select().from(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, firmId), eq(firmDocs.type, TYPE))).limit(1);
  return r ? { id: r.id, number: r.number, date: r.date, status: r.status, data: r.data as unknown as FiscalLogData, createdAt: r.createdAt } : null;
}
