'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { audit, partners } from '@wise/db';
import { firmAction } from '@/lib/books';
import { db } from '@/lib/db';

const FIELDS = ['name', 'address', 'city'] as const;
type F = (typeof FIELDS)[number];

/**
 * „Поправка на кирилица“: the reviewed Cyrillic name / address / city of the ticked partners of the current firm,
 * in one transaction, audited once with every partner's old and new values. Guarded by `write`.
 */
export async function applyPartnerCyr(form: FormData): Promise<void> {
  const { u, firm } = await firmAction('write');
  const ids = [...new Set(form.getAll('pick').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  let n = 0;
  if (ids.length) {
    await db().transaction(async (tx) => {
      const L = await tx.select({ id: partners.id, name: partners.name, address: partners.address, city: partners.city }).from(partners)
        .where(and(eq(partners.firmId, firm.id), inArray(partners.id, ids)));
      const changes: { id: string; before: Partial<Record<F, string | null>>; after: Partial<Record<F, string>> }[] = [];
      for (const p of L) {
        const after: Partial<Record<F, string>> = {};
        const before: Partial<Record<F, string | null>> = {};
        for (const k of FIELDS) {
          const v = String(form.get(`${k}.${p.id}`) ?? '').trim().slice(0, 300);
          if (v && v !== (p[k] ?? '')) { after[k] = v; before[k] = p[k]; }
        }
        if (!Object.keys(after).length) continue;
        await tx.update(partners).set({ ...after, updatedAt: new Date() }).where(eq(partners.id, p.id));
        changes.push({ id: p.id, before, after });
      }
      if (changes.length) await audit(tx, { userId: u.id, firmId: firm.id, action: 'partnersToCyrillic', entityType: 'partner', data: { count: changes.length, changes } });
      n = changes.length;
    });
  }
  revalidatePath('/partneri');
  redirect(`/partneri/kirilica?done=${n}`);
}
