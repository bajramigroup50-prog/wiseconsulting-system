'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { partnerUsage } from '@/lib/sales-parity';
import { z } from 'zod';
import { audit, journalLines, partners } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { nextCode } from '@/lib/codes';
import { db } from '@/lib/db';

const opt = z.string().trim().max(300).transform((s) => s || null);
const PartnerInput = z.object({
  code: opt,
  name: z.string().trim().min(1, 'Внесете назив.').max(300),
  edb: opt, embs: opt, address: opt, city: opt, country: opt, email: opt, phone: opt, contact: opt,
  bankAccount: opt, bankName: opt,
  vatRegistered: z.boolean(), foreign: z.boolean(), active: z.boolean(),
});
const TEXT = ['code', 'name', 'edb', 'embs', 'address', 'city', 'country', 'email', 'phone', 'contact', 'bankAccount', 'bankName'] as const;

/** Legacy `saveS('partners')` 7401 + base `save` auto-code (3296). Guarded by `write`, audited. */
export async function savePartner(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get('id') ?? '') || null;
  try {
    const { u, firm } = await firmAction('write');
    const parsed = PartnerInput.safeParse({
      ...Object.fromEntries(TEXT.map((k) => [k, String(form.get(k) ?? '')])),
      vatRegistered: form.get('vatRegistered') === 'on', foreign: form.get('foreign') === 'on', active: form.get('active') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = parsed.data;
    await db().transaction(async (tx) => {
      const codes = await tx.select({ code: partners.code }).from(partners).where(eq(partners.firmId, firm.id));
      if (!v.code) v.code = nextCode(codes.map((c) => c.code));
      const [dup] = await tx.select({ name: partners.name }).from(partners)
        .where(and(eq(partners.firmId, firm.id), eq(partners.code, v.code), id ? ne(partners.id, id) : undefined)).limit(1);
      if (dup) throw new DupError(`Шифрата ${v.code} веќе ја има „${dup.name}“. Следна слободна: ${nextCode(codes.map((c) => c.code))}`);
      if (id) {
        const [before] = await tx.select().from(partners).where(and(eq(partners.id, id), eq(partners.firmId, firm.id))).limit(1);
        if (!before) throw new DupError('Комитентот не постои.');
        await tx.update(partners).set(v).where(eq(partners.id, id));
        const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => before[k as keyof typeof before] !== x));
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveS', entityType: 'partner', entityId: id, data: changed });
      } else {
        const [p] = await tx.insert(partners).values({ ...v, firmId: firm.id }).returning({ id: partners.id });
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'newS', entityType: 'partner', entityId: p!.id, data: { name: v.name, code: v.code } });
      }
    });
  } catch (e) {
    if (e instanceof DupError) return { error: e.message };
    return actionError(e);
  }
  revalidatePath('/partneri');
  redirect('/partneri');
}

class DupError extends Error {}

/** Legacy `rowDelS` / `delS`: refuse when the partner is used in the books (legacy `usedIn`). Needs `del`. */
export async function deletePartner(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    const msg = await db().transaction(async (tx) => {
      const n = (await partnerUsage(firm.id)).get(id) ?? 0;
      if (n) return `Не може да се избрише – се користи во ${n} документи.`;
      const [p] = await tx.delete(partners).where(and(eq(partners.id, id), eq(partners.firmId, firm.id))).returning();
      if (p) await audit(tx, { userId: u.id, firmId: firm.id, action: 'delS', entityType: 'partner', entityId: id, data: { name: p.name, code: p.code } });
      return null;
    });
    if (msg) return { error: msg };
  } catch (e) { return actionError(e); }
  revalidatePath('/partneri');
  return { ok: 'Избришано.' };
}

/** Legacy `actS`: mark active / inactive. */
export async function setPartnerActive(id: string, active: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    await db().transaction(async (tx) => {
      await tx.update(partners).set({ active }).where(and(eq(partners.id, id), eq(partners.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'actS', entityType: 'partner', entityId: id, data: { active } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/partneri');
  return { ok: active ? 'Активиран.' : 'Означен како неактивен – нема да се нуди во изборот.' };
}

/** Legacy `autoCodes` (7005): the next numeric code for every partner without one, in name order. */
export async function autoCodesAction(): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const n = await db().transaction(async (tx) => {
      const all = await tx.select({ id: partners.id, name: partners.name, code: partners.code }).from(partners).where(eq(partners.firmId, firm.id));
      const codes = all.map((x) => x.code);
      const L = all.filter((x) => !String(x.code ?? '').trim()).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
      for (const x of L) { const c = nextCode(codes); codes.push(c); await tx.update(partners).set({ code: c }).where(eq(partners.id, x.id)); }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'autoCodes', entityType: 'partner', data: { count: L.length } });
      return L.length;
    });
    revalidatePath('/partneri');
    return { ok: 'Доделени шифри: ' + n };
  } catch (e) { return actionError(e); }
}

/** Legacy `slDel` (16942): admin bulk delete — partners used in documents are skipped (they can be made inactive). */
export async function deletePartnersAction(ids: string[]): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    if (u.role !== 'admin') return { error: 'Бришење може само администраторот.' };
    const use = await partnerUsage(firm.id);
    const L = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const free = L.filter((x) => !use.get(x));
    if (!free.length) return { error: 'Сите избрани се користат во документи – не може да се избришат.' };
    await db().transaction(async (tx) => {
      await tx.delete(partners).where(and(eq(partners.firmId, firm.id), inArray(partners.id, free)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'slDel', entityType: 'partner', data: { text: 'Масовно бришење (partners): ' + free.length } });
    });
    revalidatePath('/partneri');
    const rest = L.length - free.length;
    return { ok: 'Избришани ' + free.length + ' од ' + L.length + '.' + (rest ? ' ' + rest + ' се користат во документи и не се избришани.' : '') };
  } catch (e) { return actionError(e); }
}
