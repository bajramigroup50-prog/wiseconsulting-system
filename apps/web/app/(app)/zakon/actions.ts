'use server';
/** „Законска усогласеност“: processing register (ЗЗЛП чл. 34) and data-subject requests of the current firm. */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { DSR_ANSWER_MONTHS, deadlineFrom, dsrVerdict, DSR_TYPES, isDsrType, RETENTION, type RetentionKind } from '@wise/core/compliance';
import { audit, gdprRecords, seedProcessingActivities } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, officeAction, officeError, today } from '@/lib/office';

export async function seedRopa(): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const n = await db().transaction((tx) => seedProcessingActivities(tx, firm.id, u.id, today()));
    revalidatePath('/zakon');
    return { ok: n ? `Додадени ${n} стандардни активности.` : 'Сите стандардни активности веќе се евидентирани.' };
  } catch (e) { return officeError(e); }
}

export async function saveActivity(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const name = fv(f, 'name');
    if (!name) return { error: 'Внесете назив на активноста.' };
    const ret = fv(f, 'retention');
    const data = {
      key: `custom-${Date.now()}`, name, purpose: fv(f, 'purpose') ?? '', basis: fv(f, 'basis') ?? '', subjects: fv(f, 'subjects') ?? '', data: fv(f, 'data') ?? '',
      recipients: fv(f, 'recipients') ?? '', retention: ret && ret in RETENTION ? ret : 'books', security: fv(f, 'security') ?? '', special: f.get('special') === 'on',
    };
    await db().transaction(async (tx) => {
      const [r] = await tx.insert(gdprRecords).values({ kind: 'activity', firmId: firm.id, subject: name, date: today(), status: 'signed', data, createdBy: u.id }).returning({ id: gdprRecords.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'ropaSave', entityType: 'gdpr_record', entityId: r!.id, data: { name } });
    });
    revalidatePath('/zakon');
    return { ok: 'Активноста е евидентирана.' };
  } catch (e) { return officeError(e); }
}

/** A data-subject request: due in one month (ЗЗЛП чл. 16); the reply respects the retention periods. */
export async function saveDsr(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const type = fv(f, 'type');
    if (!isDsrType(type)) return { error: 'Изберете вид на барање.' };
    const person = fv(f, 'person');
    if (!person) return { error: 'Внесете го лицето што бара.' };
    const received = fdate(f, 'received') ?? today();
    const cats = (Object.keys(RETENTION) as RetentionKind[]).filter((k) => f.get(`cat_${k}`) === 'on').map((k) => ({ kind: k, lastDate: fdate(f, `last_${k}`) ?? received }));
    const v = dsrVerdict(type, cats, today());
    const due = deadlineFrom(received, DSR_ANSWER_MONTHS, 'months');
    await db().transaction(async (tx) => {
      const [r] = await tx.insert(gdprRecords).values({
        kind: 'request', firmId: firm.id, subject: `${DSR_TYPES[type]} – ${person}`, date: received, due, status: 'open',
        data: { type, person, cats, outcome: v.outcome, reply: v.text, keep: v.keep, note: fv(f, 'note') }, createdBy: u.id,
      }).returning({ id: gdprRecords.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'dsrNew', entityType: 'gdpr_record', entityId: r!.id, data: { type, outcome: v.outcome, due } });
    });
    revalidatePath('/zakon');
    return { ok: `Евидентирано. Рок за одговор: ${due.split('-').reverse().join('.')}. Предлог-одговор: ${v.text}` };
  } catch (e) { return officeError(e); }
}

export async function closeDsr(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      const [r] = await tx.update(gdprRecords).set({ status: 'closed' }).where(and(eq(gdprRecords.id, id), eq(gdprRecords.firmId, firm.id))).returning({ id: gdprRecords.id });
      if (!r) throw new Error('not found');
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'dsrClose', entityType: 'gdpr_record', entityId: id });
    });
    revalidatePath('/zakon');
    return { ok: 'Затворено.' };
  } catch (e) { if (e instanceof Error && e.message === 'not found') return { error: 'Записот не е пронајден.' }; return officeError(e); }
}
