/** 📥 Прием на документи – the office's receipts (book 01), numbered per year for the whole office, audited. */
import { and, desc, eq, sql } from 'drizzle-orm';
import { priemKeepUntil, type PriemItem } from '@wise/core/office/priem';
import { audit, type Tx } from './audit';
import { docReceipts, firms, users } from './schema/index';

export class PriemError extends Error {}

export interface NewReceipt { firmId: string; period: string; broughtBy?: string | null; items: PriemItem[]; note?: string | null; returnDue?: string | null; at?: Date }

/** Next number of the year under a transaction lock (two people receiving at once never get the same number). */
export async function createReceipt(tx: Tx, r: NewReceipt, userId: string | null): Promise<{ id: string; no: number; year: number }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period)) throw new PriemError('Периодот: месец и година.');
  if (!r.items.length) throw new PriemError('Внесете барем еден вид документ со број.');
  const at = r.at ?? new Date();
  const year = Number(at.toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 4));
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('doc_receipts'), ${year})`);
  const [m] = await tx.select({ n: sql<number>`coalesce(max(${docReceipts.no}), 0)::int` }).from(docReceipts).where(eq(docReceipts.year, year));
  const no = (m?.n ?? 0) + 1;
  const [row] = await tx.insert(docReceipts).values({
    year, no, firmId: r.firmId, period: r.period, receivedAt: at, broughtBy: r.broughtBy?.trim() || null, receivedBy: userId,
    items: r.items, note: r.note?.trim() || null, keepUntil: priemKeepUntil(r.period, r.items), returnDue: r.returnDue || null,
  }).returning({ id: docReceipts.id });
  await audit(tx, { userId, firmId: r.firmId, action: 'priemNew', entityType: 'doc_receipts', entityId: row!.id, data: { no, year, period: r.period, items: r.items } });
  return { id: row!.id, no, year };
}

export async function markReceiptReturned(tx: Tx, id: string, to: string | null, userId: string | null): Promise<void> {
  const [r] = await tx.update(docReceipts).set({ returnedAt: new Date(), returnedBy: userId, returnedTo: to?.trim() || null })
    .where(and(eq(docReceipts.id, id), sql`${docReceipts.returnedAt} is null`)).returning({ firmId: docReceipts.firmId });
  if (!r) throw new PriemError('Приемот не постои или е веќе вратен.');
  await audit(tx, { userId, firmId: r.firmId, action: 'priemReturned', entityType: 'doc_receipts', entityId: id, data: { to } });
}

const COLS = {
  id: docReceipts.id, year: docReceipts.year, no: docReceipts.no, firmId: docReceipts.firmId, period: docReceipts.period, receivedAt: docReceipts.receivedAt,
  broughtBy: docReceipts.broughtBy, items: docReceipts.items, note: docReceipts.note, keepUntil: docReceipts.keepUntil, returnDue: docReceipts.returnDue,
  returnedAt: docReceipts.returnedAt, returnedTo: docReceipts.returnedTo, firmName: firms.name, receivedByName: users.name,
};

export type ReceiptView = Awaited<ReturnType<typeof receiptById>> & object;

export async function receiptList(tx: Pick<Tx, 'select'>, o: { firmIds: string[] | null; year: number; limit?: number }) {
  return tx.select(COLS).from(docReceipts).innerJoin(firms, eq(firms.id, docReceipts.firmId)).leftJoin(users, eq(users.id, docReceipts.receivedBy))
    .where(and(eq(docReceipts.year, o.year), o.firmIds ? sql`${docReceipts.firmId} in ${o.firmIds.length ? o.firmIds : ['00000000-0000-0000-0000-000000000000']}` : undefined))
    .orderBy(desc(docReceipts.no)).limit(o.limit ?? 300);
}

export async function receiptById(tx: Pick<Tx, 'select'>, id: string) {
  const [r] = await tx.select({ ...COLS, edb: firms.edb, embs: firms.embs, address: firms.address }).from(docReceipts)
    .innerJoin(firms, eq(firms.id, docReceipts.firmId)).leftJoin(users, eq(users.id, docReceipts.receivedBy)).where(eq(docReceipts.id, id)).limit(1);
  return r ?? null;
}
