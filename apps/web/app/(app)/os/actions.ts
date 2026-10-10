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
import { OS_DOCT, OS_VEH, osParse, type OsDoc } from '@wise/core/yearend/assets-io';
import { isUuid, linkFiles } from '@/lib/office';
import { fileLinks } from '@wise/db';
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
  // Legacy `saveAsset` 7233: name, cost and rate are required.
  if (!v.name || !(Number(v.cost) > 0) || v.rate === '' || !Number.isFinite(Number(v.rate))) return { error: 'Пополнете назив, вредност и стапка.' };
  const veh = form.get('veh') === 'on';
  const vehData: Record<string, unknown> = { veh };
  for (const [k, , t] of OS_VEH) {
    const s = String(form.get('v_' + k) ?? '').trim().slice(0, 40);
    vehData[k] = !s ? undefined : t === 'number' ? (Number.isFinite(Number(s.replace(',', '.'))) ? Number(s.replace(',', '.')) : undefined) : t === 'date' ? (isIsoDate(s) ? s : undefined) : s;
  }
  if (v.plate && !vehData.plate) vehData.plate = v.plate;
  try {
    const { u, firm } = await firmAction('saveAsset');
    await db().transaction(async (tx) => {
      let invNo = v.invNo;
      if (invNo) {
        const [dup] = await tx.select({ id: fixedAssets.id }).from(fixedAssets).where(and(eq(fixedAssets.firmId, firm.id), eq(fixedAssets.invNo, invNo))).limit(1);
        if (dup && dup.id !== v.id) throw new Error(`Инвентарниот број ${invNo} веќе постои.`);
      }
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
        await tx.update(fixedAssets).set({ ...row, data: { ...ex.data, ...vehData } }).where(eq(fixedAssets.id, id));
      } else {
        const [n] = await tx.insert(fixedAssets).values({ ...row, firmId: firm.id, data: JSON.parse(JSON.stringify(vehData)), createdBy: u.id }).returning({ id: fixedAssets.id });
        id = n!.id;
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveAsset', entityType: 'asset', entityId: id, data: { name: v.name, konto: v.konto, cost: v.cost } });
    });
  } catch (e) {
    if (e instanceof Error && (e.message === 'Средството не постои.' || /^Инвентарниот број/.test(e.message))) return { error: e.message };
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

const OS_FILE_ENTITY = 'fixed_asset';

/** Legacy `osUpload`: documents (type, description, valid to) and photos of an asset. */
export async function addAssetFiles(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('saveAsset');
    const id = String(form.get('id') ?? '');
    const kind = form.get('kind') === 'photo' ? 'photo' : 'doc';
    const ids = form.getAll('fileIds').filter(isUuid);
    if (!isUuid(id) || !ids.length) return { error: 'Прикачете датотека.' };
    const type = String(form.get('type') ?? '');
    const doc: Omit<OsDoc, 'fileId'> = { type: OS_DOCT.includes(type) ? type : 'Друго', title: String(form.get('title') ?? '').trim().slice(0, 200) || undefined, validTo: isIsoDate(String(form.get('validTo') ?? '')) ? String(form.get('validTo')) : undefined };
    await db().transaction(async (tx) => {
      const [a] = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.firmId, firm.id))).limit(1);
      if (!a) throw new Error('Средството не постои.');
      const n = await linkFiles(tx, ids, firm.id, OS_FILE_ENTITY, id, kind);
      if (!n) throw new Error('Датотеката не е пронајдена.');
      const data = { ...a.data } as Record<string, unknown>;
      if (kind === 'photo') data.photos = [...((data.photos as string[] | undefined) ?? []), ...ids];
      else data.docs = [...((data.docs as OsDoc[] | undefined) ?? []), ...ids.map((fileId) => ({ fileId, ...doc }))];
      await tx.update(fixedAssets).set({ data }).where(eq(fixedAssets.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: kind === 'photo' ? 'osPhoto' : 'osDoc', entityType: 'asset', entityId: id, data: { files: n, type: kind === 'doc' ? doc.type : undefined } });
    });
    revalidatePath('/os');
    return { ok: kind === 'photo' ? 'Сликите се прикачени.' : 'Документот е прикачен.' };
  } catch (e) {
    if (e instanceof Error && /^(Средството|Датотеката)/.test(e.message)) return { error: e.message };
    return actionError(e);
  }
}

export async function removeAssetFile(id: string, fileId: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('saveAsset');
    await db().transaction(async (tx) => {
      const [a] = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.firmId, firm.id))).limit(1);
      if (!a) return;
      const data = { ...a.data } as Record<string, unknown>;
      data.photos = ((data.photos as string[] | undefined) ?? []).filter((x) => x !== fileId);
      data.docs = ((data.docs as OsDoc[] | undefined) ?? []).filter((x) => x.fileId !== fileId);
      await tx.update(fixedAssets).set({ data }).where(eq(fixedAssets.id, id));
      await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, OS_FILE_ENTITY), eq(fileLinks.entityId, id), eq(fileLinks.fileId, fileId)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'osFileDel', entityType: 'asset', entityId: id, data: { fileId } });
    });
    revalidatePath('/os');
    return { ok: 'Отстрането.' };
  } catch (e) { return actionError(e); }
}

/** Excel import of the register (template = the „⬇ Excel“ export columns). Existing inventory numbers are skipped. */
export async function importAssets(rows: string[][]): Promise<ActionState> {
  try {
    const P = osParse(Array.isArray(rows) ? rows.slice(0, 5001) : []);
    if ('error' in P) return { error: P.error };
    const bad = P.filter((r) => !r.date || !(r.cost > 0) || !/^0\d{2,7}$/.test(r.konto));
    const ok = P.filter((r) => !bad.includes(r));
    if (!ok.length) return { error: 'Нема исправни редови (потребни се назив, конто 0…, датум и набавна вредност).' };
    const { u, firm } = await firmAction('saveAsset');
    const r = await db().transaction(async (tx) => {
      const ex = new Set((await tx.select({ invNo: fixedAssets.invNo }).from(fixedAssets).where(eq(fixedAssets.firmId, firm.id))).map((x) => x.invNo).filter(Boolean));
      let [{ m }] = (await tx.select({ m: sql<number>`coalesce(max(case when ${fixedAssets.invNo} ~ '^[0-9]+$' then ${fixedAssets.invNo}::int end), 0)::int` })
        .from(fixedAssets).where(eq(fixedAssets.firmId, firm.id))) as [{ m: number }];
      let n = 0, skip = 0;
      for (const x of ok) {
        if (x.invNo && ex.has(x.invNo)) { skip++; continue; }
        const invNo = x.invNo || String(++m).padStart(4, '0');
        ex.add(invNo);
        await tx.insert(fixedAssets).values({
          firmId: firm.id, invNo, name: x.name, konto: x.konto, rate: String(x.rate || 0), date: x.date, cost: x.cost.toFixed(2),
          serial: x.serial || null, barcode: x.barcode || null, supplier: x.supplier || null, invDoc: x.invDoc || null, location: x.location || null,
          data: x.plate ? { plate: x.plate, veh: true } : {}, createdBy: u.id,
        });
        n++;
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'osImport', entityType: 'asset', data: { n, skip, bad: bad.length } });
      return { n, skip };
    });
    revalidatePath('/os');
    return { ok: `Увезени ${r.n} средства${r.skip ? ` · ${r.skip} постоечки инв. броеви прескокнати` : ''}${bad.length ? ` · ${bad.length} неисправни редови` : ''}.` };
  } catch (e) { return actionError(e); }
}
