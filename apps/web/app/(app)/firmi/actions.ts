'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit, firms, type NewFirm } from '@wise/db';
import { requireCan } from '@/lib/auth';
import { db } from '@/lib/db';
import { selectFirm } from '../actions';

const opt = z.string().trim().max(300).transform((s) => s || null);
const FirmInput = z.object({
  code: opt,
  name: z.string().trim().min(2, 'Внесете назив на фирмата.').max(300),
  legalForm: opt,
  address: opt, city: opt, phone: opt, email: opt, activity: opt,
  edb: opt.refine((s) => !s || /^(MK)?\d{13}$/i.test(s.replace(/\s/g, '')), 'Даночниот број има 13 цифри (со или без MK).'),
  embs: opt.refine((s) => !s || /^\d{7,8}$/.test(s), 'Матичниот број има 7 цифри.'),
  vatRegistered: z.boolean(),
  vatPeriod: z.enum(['quarter', 'month']),
  lockDate: opt.refine((s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s), 'Неважечки датум.'),
});

export interface FirmFormState { error?: string }

export async function saveFirm(_prev: FirmFormState, form: FormData): Promise<FirmFormState> {
  const id = String(form.get('id') ?? '') || null;
  const u = await requireCan(id ? 'saveFirm' : 'newFirm', id);
  const parsed = FirmInput.safeParse({
    ...Object.fromEntries(['code', 'name', 'legalForm', 'address', 'city', 'phone', 'email', 'activity', 'edb', 'embs', 'lockDate', 'vatPeriod']
      .map((k) => [k, String(form.get(k) ?? '')])),
    vatRegistered: form.get('vatRegistered') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
  const v: Partial<NewFirm> = parsed.data;

  const newId = await db().transaction(async (tx) => {
    if (id) {
      const [before] = await tx.select().from(firms).where(eq(firms.id, id)).limit(1);
      if (!before) throw new Error('Фирмата не постои.');
      await tx.update(firms).set(v).where(eq(firms.id, id));
      const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => before[k as keyof typeof before] !== x));
      await audit(tx, { userId: u.id, firmId: id, action: 'saveFirm', entityType: 'firm', entityId: id, data: changed });
      return id;
    }
    const [f] = await tx.insert(firms).values({ ...v, name: parsed.data.name, ownerId: u.id }).returning({ id: firms.id });
    await audit(tx, { userId: u.id, firmId: f!.id, action: 'newFirm', entityType: 'firm', entityId: f!.id, data: { name: parsed.data.name } });
    return f!.id;
  });

  revalidatePath('/firmi');
  if (!id) await selectFirm(newId);
  redirect('/firmi');
}
