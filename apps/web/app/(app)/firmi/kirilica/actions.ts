'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { audit, firms } from '@wise/db';
import { requireCan } from '@/lib/auth';
import { db } from '@/lib/db';

const FIELDS = ['name', 'address', 'city'] as const;

/** Apply the reviewed Cyrillic spellings to the ticked firms (one audited update per firm). */
export async function applyCyr(form: FormData): Promise<void> {
  const u = await requireCan('saveFirm');
  const ids = form.getAll('pick').map(String);
  let n = 0;
  await db().transaction(async (tx) => {
    for (const id of ids) {
      if (!can(u.principal, 'saveFirm', id)) continue;
      const [f] = await tx.select().from(firms).where(eq(firms.id, id)).limit(1);
      if (!f) continue;
      const set: Partial<Record<(typeof FIELDS)[number], string>> = {};
      const before: Record<string, unknown> = {};
      for (const k of FIELDS) {
        const v = String(form.get(`${k}.${id}`) ?? '').trim();
        if (v && v !== (f[k] ?? '')) { set[k] = v; before[k] = f[k]; }
      }
      if (k0(set) && set.name !== undefined && set.name.length < 2) continue;
      if (!k0(set)) continue;
      await tx.update(firms).set({ ...set, updatedAt: new Date() }).where(eq(firms.id, id));
      await audit(tx, { userId: u.id, firmId: id, action: 'saveFirm', entityType: 'firm', entityId: id, data: { cyr: true, before, after: set } });
      n++;
    }
  });
  revalidatePath('/firmi');
  redirect(`/firmi/kirilica?done=${n}`);
}
const k0 = (o: object) => Object.keys(o).length > 0;
