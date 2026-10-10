'use server';
/**
 * Fiscal reports (рачна каса) — legacy-parity actions:
 * - `fkPost` 11448 (+ wrappers 12996, 13071, 13101): post EVERY row of a read — one record per day, or one summed record
 *   for the period with the daily rows as `days` (default), periodic reports spread over Monday–Saturday (`fkMetgDays`);
 *   VAT as read; the scan is attached; options remembered (`fiskOpt`)
 * - DFI control settings (`dfiHTML` 11501 + 13131): Неработни денови, Благајнички максимум, Полог до (дена)
 * - device register (`devHTML` 11511, ACT 11534–11538)
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { fiskAfterRead, fiskFinish } from '@wise/core/ai/fisk';
import { fiskPostRows } from '@wise/core/fisk-parity';
import { audit, firms, saveSalesDay } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { loadAiResult, markAiReadsSaved } from '@/lib/ai';
import { db } from '@/lib/db';
import { saveFiskOpt } from '@/lib/parity-fin';
import { todayIso } from '@/lib/stock';

const K = z.string().regex(/^\d{3,10}$/).or(z.literal('')).optional().default('');
const PostIn = z.object({
  ai: z.uuid(), wh: z.string().max(40), sc: z.enum(['', 'trg', 'usl', 'trgNoVat']).default(''), rev: K, cardK: K, cashK: K,
  nonVat: z.boolean().default(false), sum: z.boolean().default(true), mg: z.enum(['spread', 'one']).default('spread'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default(''), replace: z.boolean().default(false), checked: z.boolean().default(false),
});

export async function postFiskReadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = PostIn.parse(JSON.parse(String(form.get('payload') ?? '{}')));
    const { u, firm } = await firmAction('fkPost');
    const d = await loadAiResult(firm.id, v.ai, 'fisk');
    if (!d) return { error: 'Извештајот не е прочитан.' };
    const R = fiskFinish(fiskAfterRead(d.result), todayIso());
    const X = fiskPostRows(R, { today: todayIso(), nonVat: v.nonVat, sum: v.sum, date: v.date || undefined, mg: v.mg });
    if (X.checks.some((c) => c.problems.length) && !v.checked) return { error: 'Има разлики во контролите – проверете ги и штиклирајте „ги проверив разликите“.' };
    let n = 0;
    await db().transaction(async (tx) => {
      const a = { firmId: firm.id, userId: u.id };
      for (const r of X.rows) {
        await saveSalesDay(tx, a, {
          kind: 'fisk', date: r.date, wh: v.wh, number: r.z || null, gross: r.gross, vat: r.vat, total: r.total, card: r.card, cardAccount: v.cardK || null,
          count: r.receipts || 0, days: r.days ?? null, replace: v.replace, fileId: d.fileId,
          fisk: {
            ...(v.sc ? { sc: v.sc } : {}), ...(v.rev ? { rev: v.rev } : {}), ...(v.cashK ? { cashK: v.cashK } : {}), ...(v.nonVat ? { nonVat: true } : {}),
            ...(R.device ? { device: R.device } : {}), ...(R.from ? { from: R.from } : {}), ...(R.to ? { to: R.to } : {}), cash: r.cash, storno: r.storno,
          },
        });
        n++;
      }
      await saveFiskOpt(tx, firm.id, { wh: v.wh, sc: v.sc || undefined, cardK: v.cardK || undefined, cashK: v.cashK || undefined, konto: v.rev || undefined });
      await markAiReadsSaved(tx, firm.id, [d.id]);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'fkPost', entityType: 'ai_document', entityId: d.id, data: { records: n, sum: v.sum } });
    });
    revalidatePath('/fiskPer');
    revalidatePath('/kdfi');
    return { ok: `✓ Прокнижени ${n} ${n === 1 ? 'запис' : 'дневни прометa'} во налогот „Каса“${v.nonVat ? '' : ' и во ДДВ-04'}. Следно: излез на стока.` };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Неважечки податоци.' };
    if (e instanceof Error && e.name === 'StockDocError') return { error: e.message };
    return actionError(e);
  }
}

/** DFI control settings (legacy `fiskOpt.offDays/cashMax/depDays`). */
export async function saveDfiSettingsAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('fkPost');
    const offDays = String(form.get('offDays') ?? '').trim().slice(0, 20);
    const cashMax = Number(String(form.get('cashMax') ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
    const depDays = Math.max(0, Math.min(60, Math.round(Number(form.get('depDays')) || 0)));
    await db().transaction(async (tx) => {
      await saveFiskOpt(tx, firm.id, { offDays, cashMax: cashMax || undefined, depDays: depDays || undefined });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'dfiOpt', entityType: 'firm', entityId: firm.id, data: { offDays, cashMax, depDays } });
    });
    revalidatePath('/fiskPer');
    return { ok: 'Зачувано.' };
  } catch (e) { return actionError(e); }
}

/** One fiscal device (legacy `fiskDev` row 11511). */
const Dev = z.object({
  id: z.string().max(40).optional().default(''), serial: z.string().trim().min(1, 'Внесете сериски број.').max(40), wh: z.string().max(40).default(''),
  brand: z.string().max(60).default(''), model: z.string().max(60).default(''), conn: z.string().max(20).default(''), port: z.string().max(60).default(''),
  operator: z.string().max(60).default(''), mode: z.string().max(40).default(''), fiscal: z.string().max(10).default(''), servicer: z.string().max(80).default(''),
  lastSvc: z.string().max(10).default(''), nextSvc: z.string().max(10).default(''),
});
export type FiskDevice = z.infer<typeof Dev>;

export async function saveDeviceAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = Dev.parse(Object.fromEntries([...form.entries()].map(([k, x]) => [k, String(x)])));
    const { u, firm } = await firmAction('fkPost');
    await db().transaction(async (tx) => {
      const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).limit(1);
      const s = (f?.settings ?? {}) as Record<string, unknown>;
      const L = ((s.fiskDev ?? []) as FiskDevice[]).filter((x) => x.id !== v.id);
      const row = { ...v, id: v.id || 'd' + Date.now().toString(36) };
      await tx.update(firms).set({ settings: { ...s, fiskDev: [...L, row] } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'devSave', entityType: 'firm', entityId: firm.id, data: row });
    });
    revalidatePath('/fiskPer');
    return { ok: 'Апаратот е зачуван.' };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? 'Неважечки податоци.' };
    return actionError(e);
  }
}

export async function deleteDeviceAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('fkPost');
    await db().transaction(async (tx) => {
      const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).limit(1);
      const s = (f?.settings ?? {}) as Record<string, unknown>;
      await tx.update(firms).set({ settings: { ...s, fiskDev: ((s.fiskDev ?? []) as FiskDevice[]).filter((x) => x.id !== id) } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'devDel', entityType: 'firm', entityId: firm.id, data: { id } });
    });
    revalidatePath('/fiskPer');
    return { ok: 'Избришано.' };
  } catch (e) { return actionError(e); }
}
