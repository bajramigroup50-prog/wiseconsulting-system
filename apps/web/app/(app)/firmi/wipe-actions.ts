'use server';
/**
 * „🗑 Избриши ги сите документи и книжења за годината“ (Фирми → Измени, administrator only): what will go (counts per
 * kind) and the delete itself – the typed firm name must match. The year is the selected working year.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { firms, firmYearWipePlan, FirmWipeError, WIPE_LABELS, wipeFirmYear } from '@wise/db';
import { requireCan } from '@/lib/auth';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';

export interface WipeState { ok?: string; error?: string; plan?: { label: string; n: number }[]; year?: number }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export async function wipePlanAction(firmId: string): Promise<WipeState> {
  const u = await requireCan('delFirm', firmId);
  if (u.role !== 'admin') return { error: 'Само администраторот.' };
  const year = await currentYear();
  const p = await db().transaction((tx) => firmYearWipePlan(tx as never, firmId, year));
  if (p.locked) return { error: `Годината ${year} е заклучена (до ${p.locked.split('-').reverse().join('.')}) – прво отклучете ја.`, year };
  if (!p.total) return { ok: `Во ${year} нема документи ни книжења.`, year, plan: [] };
  return { year, plan: Object.entries(p.counts).map(([t, n]) => ({ label: WIPE_LABELS[t] ?? t, n })) };
}

export async function wipeYearAction(firmId: string, typedName: string): Promise<WipeState> {
  const u = await requireCan('delFirm', firmId);
  if (u.role !== 'admin') return { error: 'Само администраторот.' };
  const year = await currentYear();
  const [f] = await db().select({ name: firms.name }).from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f) return { error: 'Фирмата не постои.' };
  if (norm(typedName) !== norm(f.name)) return { error: 'Името на фирмата не е точно – ништо не е избришано.' };
  try {
    const r = await db().transaction((tx) => wipeFirmYear(tx as never, { firmId, year, userId: u.id }));
    revalidatePath('/', 'layout');
    const n = Object.values(r.deleted).reduce((s, x) => s + x, 0);
    return { ok: `Избришани се сите документи и книжења на ${f.name} за ${year} (${n} записи${r.partners ? `, ${r.partners} комитенти` : ''}${r.items ? `, ${r.items} артикли` : ''}). Фирмата и другите години се зачувани.`, year };
  } catch (e) {
    if (e instanceof FirmWipeError) return { error: e.message, year };
    throw e;
  }
}
