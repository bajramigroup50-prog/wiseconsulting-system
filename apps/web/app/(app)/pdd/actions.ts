'use server';
/**
 * Legacy `pddSave` / `pddDel` / `pddTypesSave` (8366–8380): ПДД payment (rent, bonuses, services from natural persons)
 * saved and booked in one transaction (journal kind `pdd`, source `pdd`), its deletion, and the firm's income types.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { pddCalc, pddEntries, pddTotal, pddTypes, type PddRow, type PddType } from '@wise/core/finance';
import { audit, firms, pddPayments, postJournal, unpostSource, type PddPaymentRow } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';

const typesOf = (settings: unknown) => pddTypes(((settings ?? {}) as { pddTypes?: Partial<PddType>[] }).pddTypes);

export interface PddInput { id?: string; date: string; note: string; rows: PddRow[] }

export async function savePddAction(v: PddInput): Promise<ActionState> {
  let id = v.id ?? '';
  try {
    const { u, firm } = await firmAction('pddSave');
    if (!isDate(v.date)) return { error: 'Внесете датум на исплата.' };
    const T = typesOf(firm.settings);
    const R = (v.rows ?? []).filter((r) => r.name || +r.amt);
    if (!R.length) return { error: 'Внесете барем еден примач.' };
    if (R.some((r) => !(+r.amt > 0))) return { error: 'Внесете износ за секој примач.' };
    if (R.some((r) => !T.some((t) => t.id === r.tid))) return { error: 'Непознат вид приход.' };
    const rows: PddPaymentRow[] = R.map((r) => {
      const t = T.find((x) => x.id === r.tid)!;
      const c = pddCalc(r, t);
      return { tid: r.tid, mode: r.mode === 'g' ? 'g' : 'n', amt: Math.round(+r.amt), name: String(r.name ?? '').trim(), embg: String(r.embg ?? '').replace(/\D/g, ''), acct: String(r.acct ?? '').replace(/\D/g, ''), pid: r.pid && /^[0-9a-f-]{36}$/i.test(r.pid) ? r.pid : null, ...c };
    });
    const tot = pddTotal(rows, T);
    await db().transaction(async (tx) => {
      const head = { date: v.date, note: v.note?.trim() || null, rows, gross: String(tot.G), deductions: String(tot.ded), tax: String(tot.tax), net: String(tot.net) };
      if (id) {
        const [x] = await tx.update(pddPayments).set(head).where(and(eq(pddPayments.id, id), eq(pddPayments.firmId, firm.id))).returning({ id: pddPayments.id });
        if (!x) throw new Error('Книжењето не постои.');
      } else {
        id = (await tx.insert(pddPayments).values({ ...head, firmId: firm.id, createdBy: u.id }).returning({ id: pddPayments.id }))[0]!.id;
      }
      await postJournal(tx, {
        firmId: firm.id, date: v.date, kind: 'pdd', description: v.note?.trim() || 'Закупнина / бонуси ' + v.date.split('-').reverse().join('.'),
        sourceType: 'pdd', sourceId: id, userId: u.id, auditAction: 'pddPost',
        lines: pddEntries(rows, T).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, note: l.note, partnerId: l.partnerId ?? null })),
        requirePartner: false,
      });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pddSave', entityType: 'pdd_payment', entityId: id, data: { date: v.date, rows: rows.length, ...tot } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'Книжењето не постои.') return { error: e.message };
    return actionError(e);
  }
  revalidatePath('/pdd');
  redirect('/pdd');
}

export async function deletePddAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction(async (tx) => {
      const [x] = await tx.select().from(pddPayments).where(and(eq(pddPayments.id, id), eq(pddPayments.firmId, firm.id))).limit(1);
      if (!x) throw new Error('Книжењето не постои.');
      await unpostSource(tx, { firmId: firm.id, sourceType: 'pdd', sourceId: id, userId: u.id });
      await tx.delete(pddPayments).where(eq(pddPayments.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pddDel', entityType: 'pdd_payment', entityId: id, data: { date: x.date } });
    });
    revalidatePath('/pdd');
    return { ok: 'Избришано.' };
  } catch (e) {
    if (e instanceof Error && e.message === 'Книжењето не постои.') return { error: e.message };
    return actionError(e);
  }
}

const KONTO = /^\d{3,10}$/;

/** Firm income types (legacy `pddTypesSave`, needs `settings`). */
export async function savePddTypesAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    const ids = form.getAll('id').map(String);
    const g = (f: string, i: number) => String(form.getAll(f)[i] ?? '').trim();
    const T: PddType[] = ids.map((id, i) => ({
      id: id !== 'new' && /^[a-z0-9_]{1,40}$/i.test(id) ? id :'u' + Date.now().toString(36) + i,
      sh: g('sh', i), vid: g('vid', i), pod: g('pod', i), ded: +g('ded', i).replace(',', '.') || 0, tax: +g('tax', i).replace(',', '.') || 0,
      kExp: g('kExp', i), kLiab: g('kLiab', i), kTax: g('kTax', i),
    })).filter((t) => t.sh || t.pod);
    for (const t of T) {
      if (![t.kExp, t.kLiab, t.kTax].every((k) => KONTO.test(k))) return { error: `„${t.sh || t.pod}“: контата мора да имаат 3–10 цифри.` };
      if (t.ded < 0 || t.ded > 100 || t.tax < 0 || t.tax > 100) return { error: `„${t.sh || t.pod}“: процентите мора да се 0–100.` };
    }
    await db().transaction(async (tx) => {
      const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).for('update');
      await tx.update(firms).set({ settings: { ...(f?.settings ?? {}), pddTypes: T } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pddTypesSave', entityType: 'firm', entityId: firm.id, data: { types: T.length } });
    });
    revalidatePath('/pdd');
    return { ok: 'Видовите приход се зачувани.' };
  } catch (e) { return actionError(e); }
}
