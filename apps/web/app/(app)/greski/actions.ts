'use server';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { appErrors, audit } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';

/** The register is the administrator's (legacy: view and buttons only for `admin`; ACT_NEED `settings`). */
async function adminOnly(action: string) {
  const u = await requireCan('settings');
  if (u.role !== 'admin') throw new Forbidden(action);
  return u;
}

/** Legacy `errFix`. */
export async function markFixed(ids: string[]): Promise<ActionState> {
  try {
    const u = await adminOnly('errFix');
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!ok.length) return {};
    await db().transaction(async (tx) => {
      await tx.update(appErrors).set({ fixed: true, fixedAt: new Date() }).where(and(inArray(appErrors.id, ok), eq(appErrors.fixed, false)));
      await audit(tx, { userId: u.id, action: 'errFix', entityType: 'app_error', entityId: ok.join(','), data: { n: ok.length } });
    });
    revalidatePath('/greski');
    return { ok: 'Означено како решено.' };
  } catch (e) {
    if (e instanceof Forbidden) return { error: e.message };
    throw e;
  }
}

/** Legacy `errDelFixed`: remove the solved errors from the register. */
export async function deleteFixed(): Promise<ActionState> {
  try {
    const u = await adminOnly('errDelFixed');
    const n = await db().transaction(async (tx) => {
      const r = await tx.delete(appErrors).where(eq(appErrors.fixed, true)).returning({ id: appErrors.id });
      await audit(tx, { userId: u.id, action: 'errDelFixed', entityType: 'app_error', data: { n: r.length } });
      return r.length;
    });
    revalidatePath('/greski');
    return { ok: `Избришани ${n} решени грешки.` };
  } catch (e) {
    if (e instanceof Forbidden) return { error: e.message };
    throw e;
  }
}
