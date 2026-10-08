'use server';
/**
 * Fixed assets (legacy ACT `newAsset`/`editAsset`/`saveAsset`/`delAsset` 7231–7238, `runDep` 7239).
 * Depreciation posts `dep-<Y>` through the posting service (per asset group, fix D1).
 */
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit, depreciationRuns, fixedAssets, isIsoDate, runDepreciation, undoDepreciation } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';

const num = z.string().trim().transform((s) => s.replace(/\s/g, '').replace(',', '.')).refine((s) => s === '' || Number.isFinite(Number(s)), 'Неважечки број.');
const date = (req: boolean) => z.string().trim().refine((s) => (!req && s === '') || isIsoDate(s), 'Неважечки датум.');
const Asset = z.object({
  id: z.string().optional().default(''),
  invNo: z.string().trim().max(20).optional().default(''),
  name: z.string().trim().min(1, 'Внесете назив.').max(300),
  konto: z.string().trim().regex(/^0\d{2,7}$/, 'Контото на средството е од класа 0 (на пр. 0120).'),
  rate: num, cost: num, date: date(true), disposed: date(false),
  serial: z.string().trim().max(100).optional().default(''), barcode: z.string().trim().max(100).optional().default(''),
  supplier: z.string().trim().max(200).optional().default(''), invDoc: z.string().trim().max(100).optional().default(''),
  location: z.string().trim().max(200).optional().default(''), note: z.string().trim().max(1000).optional().default(''),
  plate: z.string().trim().max(30).optional().default(''),
});

export async function saveAsset(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = Asset.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')));
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
  const v = p.data;
  if (v.disposed && v.disposed < v.date) return { error: 'Датумот на отпис е пред датумот на набавка.' };
  try {
    const { u, firm } = await firmAction('saveAsset');
    await db().transaction(async (tx) => {
      let invNo = v.invNo;
      if (!invNo) {
        // legacy `osNextInv`: next 4-digit inventory number
        const [{ m }] = (await tx.select({ m: sql<number>`coalesce(max(case when ${fixedAssets.invNo} ~ '^[0-9]+$' then ${fixedAssets.invNo}::int end), 0)::int` })
          .from(fixedAssets).where(eq(fixedAssets.firmId, firm.id))) as [{ m: number }];
        invNo = String(m + 1).padStart(4, '0');
      }
      const row = {
        invNo, name: v.name, konto: v.konto, rate: v.rate || '0', cost: v.cost || '0', date: v.date, disposed: v.disposed || null,
        vehicleOnly: form.get('vehicleOnly') === 'on', serial: v.serial || null, barcode: v.barcode || null, supplier: v.supplier || null,
        invDoc: v.invDoc || null, location: v.location || null, note: v.note || null,
      };
      let id = v.id;
      if (id) {
        const [ex] = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.firmId, firm.id))).limit(1);
        if (!ex) throw new Error('Средството не постои.');
        await tx.update(fixedAssets).set({ ...row, data: { ...ex.data, plate: v.plate || undefined } }).where(eq(fixedAssets.id, id));
      } else {
        const [n] = await tx.insert(fixedAssets).values({ ...row, firmId: firm.id, data: v.plate ? { plate: v.plate } : {}, createdBy: u.id }).returning({ id: fixedAssets.id });
        id = n!.id;
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveAsset', entityType: 'asset', entityId: id, data: { name: v.name, konto: v.konto, cost: v.cost } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'Средството не постои.') return { error: e.message };
    return actionError(e);
  }
  revalidatePath('/os');
  return { ok: 'Средството е зачувано.' };
}

/** Delete an asset (needs `del`); refused once it was part of a posted depreciation run — set a disposal date instead. */
export async function deleteAsset(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    const used = await db().select({ y: depreciationRuns.year }).from(depreciationRuns)
      .where(and(eq(depreciationRuns.firmId, firm.id), sql`${depreciationRuns.rows} @> ${JSON.stringify([{ id }])}::jsonb`));
    if (used.length) return { error: `Средството е амортизирано во ${used.map((x) => x.y).join(', ')} – наместо бришење внесете датум на отпис.` };
    await db().transaction(async (tx) => {
      const n = await tx.delete(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.firmId, firm.id))).returning({ id: fixedAssets.id, name: fixedAssets.name });
      if (n.length) await audit(tx, { userId: u.id, firmId: firm.id, action: 'delAsset', entityType: 'asset', entityId: id, data: { name: n[0]!.name } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/os');
  return { ok: 'Избришано.' };
}

export async function runDepAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('runDep');
    const r = await db().transaction((tx) => runDepreciation(tx, { firmId: firm.id, year, userId: u.id }));
    revalidatePath('/', 'layout');
    return { ok: `Амортизацијата за ${year} е прокнижена (налог ${r.journal.number}): ${fmt(r.total)} ден.` };
  } catch (e) { return actionError(e); }
}

export async function undoDepAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('del');
    await db().transaction((tx) => undoDepreciation(tx, { firmId: firm.id, year, userId: u.id }));
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  return { ok: 'Налогот за амортизација е избришан.' };
}
