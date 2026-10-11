'use server';
/** Legacy `efSet` / change handler 15211: per-firm e-invoice readiness fields (EUJP-ID, certificate, valid to, status) in `firms.settings.ef`. */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { can, EF_STATUS_KEYS } from './status';
import { audit, firms } from '@wise/db';
import { actionError, type ActionState } from '@/lib/books';
import { requireCan, requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';

const CERT = ['', 'token', 'p12', 'none'];

export async function saveEfAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const ids = f.getAll('fid').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    let n = 0;
    await db().transaction(async (tx) => {
      for (const fid of ids) {
        if (!can(u.principal, 'office', fid)) continue;
        const ef = {
          id: String(f.get('efId_' + fid) ?? '').trim().slice(0, 60),
          cert: CERT.includes(String(f.get('efCert_' + fid))) ? String(f.get('efCert_' + fid)) : '',
          certTo: isDate(f.get('efCertTo_' + fid)) ? String(f.get('efCertTo_' + fid)) : '',
          st: EF_STATUS_KEYS.includes(String(f.get('efSt_' + fid))) ? String(f.get('efSt_' + fid)) : 'no',
        };
        const [x] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, fid)).for('update');
        if (!x) continue;
        const S = (x.settings ?? {}) as Record<string, unknown>;
        const old = (S.ef ?? {}) as Record<string, string>;
        if (old.id === ef.id && old.cert === ef.cert && old.certTo === ef.certTo && (old.st ?? 'no') === ef.st) continue;
        await tx.update(firms).set({ settings: { ...S, ef } }).where(eq(firms.id, fid));
        await audit(tx, { userId: u.id, firmId: fid, action: 'efSet', entityType: 'firm', entityId: fid, data: ef });
        n++;
      }
    });
    revalidatePath('/efPrep');
    return { ok: n ? `Зачувано (${n} фирми).` : 'Нема промени.' };
  } catch (e) { return actionError(e); }
}
