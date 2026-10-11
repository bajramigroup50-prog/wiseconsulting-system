'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { isNcStatus, LEGAL_FORMS, NC_CHECK, NF, sharesOk, taskTransition, type Founder } from '@wise/core/office';
import { audit, firms, formationCases, getOfficeProfile, officeTasks } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fnum, fv, isUuid, officeError } from '@/lib/office';

/** Legacy `ncNew` / `ncSave` (ACT_NEED `office`). */
export async function saveFormation(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = fv(f, 'id');
  try {
    const u = await requireCan('office');
    const name = fv(f, 'name');
    if (!name) return { error: 'Внесете назив.' };
    const form = (LEGAL_FORMS as readonly string[]).includes(fv(f, 'form') ?? '') ? fv(f, 'form')! : 'ДООЕЛ';
    const data = Object.fromEntries(NF.map(([k]) => [k, fv(f, `nf_${k}`) ?? '']).filter(([, v]) => v)) as Record<string, string>;
    const founders: Founder[] = [];
    for (let i = 0; i < 3; i++) {
      const n = fv(f, `fo${i}_name`);
      if (n) founders.push({ kind: fv(f, `fo${i}_kind`) === 'ПЛ' ? 'ПЛ' : 'ФЛ', name: n, surname: fv(f, `fo${i}_surname`) ?? undefined, embg: fv(f, `fo${i}_embg`) ?? undefined, idNo: fv(f, `fo${i}_idNo`) ?? undefined, address: fv(f, `fo${i}_address`) ?? undefined, share: fnum(f, `fo${i}_share`), cit: fv(f, `fo${i}_cit`) ?? undefined });
    }
    if (founders.length && !sharesOk(founders)) return { error: 'Уделите на основачите мора да се вкупно 100%.' };
    const manager = fv(f, 'manager');
    const checklist = Object.fromEntries(NC_CHECK.map((c, i) => [c, f.get(`chk${i}`) === 'on']));
    const status = fv(f, 'status');
    const O = await getOfficeProfile(db());
    const eur = fnum(f, 'nf_capital');
    const v = {
      name, form, data, founders: founders as unknown as Record<string, unknown>[], managers: manager ? [{ name: manager }] : [], checklist,
      capItems: eur ? [{ name: 'Паричен влог', eur }] : [], ...(isNcStatus(status) ? { status } : {}),
      eurRate: String(Number(O.eurRate) || 61.5),
    };
    await db().transaction(async (tx) => {
      if (id) {
        await tx.update(formationCases).set(v).where(eq(formationCases.id, id));
        await audit(tx, { userId: u.id, action: 'ncSave', entityType: 'formation_case', entityId: id, data: { name, status } });
      } else {
        const [c] = await tx.insert(formationCases).values({ ...v, createdBy: u.id }).returning({ id: formationCases.id });
        id = c!.id;
        await audit(tx, { userId: u.id, action: 'ncNew', entityType: 'formation_case', entityId: id, data: { name } });
      }
    });
  } catch (e) { return officeError(e); }
  revalidatePath('/osnovanje');
  redirect(`/osnovanje?id=${id}`);
}

/** Legacy `ncTask`: a task for the field worker (submit to ЦРСМ, bank account …). */
export async function formationTask(id: string): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const [c] = await db().select().from(formationCases).where(eq(formationCases.id, id)).limit(1);
    if (!c) return { error: 'Не постои.' };
    await db().transaction(async (tx) => {
      const [t] = await tx.insert(officeTasks).values({
        title: `Основање: ${c.name}`, type: 'Основање фирма', inst: 'ЦРСМ', formationId: c.id, createdBy: u.id,
        hist: taskTransition({ status: 'new', hist: [] }, 'new', u.name).hist,
      }).returning({ id: officeTasks.id });
      await audit(tx, { userId: u.id, action: 'ncTask', entityType: 'office_task', entityId: t!.id, data: { formation: id } });
    });
    revalidatePath('/kanc');
    return { ok: 'Задачата е креирана во Канцеларија.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `ncCreateFirm` (ACT_NEED `office` + firm creation → here `firms`): the registered company becomes a client firm. */
export async function createFirmFromFormation(id: string): Promise<ActionState> {
  try {
    if (!isUuid(id)) return { error: 'Не постои.' };
    const u = await requireCan('firms');
    const msg = await db().transaction(async (tx) => {
      const [c] = await tx.select().from(formationCases).where(eq(formationCases.id, id)).for('update');
      if (!c) return 'Не постои.';
      if (c.firmId) return 'Фирмата е веќе внесена.';
      const d = c.data;
      const [fm] = await tx.insert(firms).values({
        name: c.name, legalForm: c.form, edb: d.edb || null, embs: d.embs || null,
        address: [d.street, d.no].filter(Boolean).join(' ') || null, city: d.city || null, email: d.email || null, phone: d.phone || null,
        activity: [d.nkd, d.activity].filter(Boolean).join(' ') || null, vatRegistered: false,
        settings: { nkd: d.nkd, regDate: fdateStr(d.regDate), manager: (c.managers[0] as { name?: string } | undefined)?.name, short: d.short },
      }).returning({ id: firms.id });
      await tx.update(formationCases).set({ firmId: fm!.id, status: 'created' }).where(eq(formationCases.id, id));
      await audit(tx, { userId: u.id, firmId: fm!.id, action: 'ncCreateFirm', entityType: 'firm', entityId: fm!.id, data: { formation: id, name: c.name } });
      return null;
    });
    if (msg) return { error: msg };
  } catch (e) { return officeError(e); }
  revalidatePath('/osnovanje');
  return { ok: 'Фирмата е внесена во програмата.' };
}

const fdateStr = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
