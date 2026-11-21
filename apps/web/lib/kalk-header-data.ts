/** Server data of the Helix header dialog („Податоци за малопродажна калкулација“): partners, objects, earlier calculations. */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { partners, purchases } from '@wise/db';
import { db } from '@/lib/db';
import { locationOptions } from '@/lib/sales';

export interface KalkDialogData {
  partners: { id: string; name: string; edb: string | null }[];
  locations: { id: string; code: string; name: string; kind: 'warehouse' | 'store' }[];
  /** „Посебни“: earlier calculations of the year to link (Број на калкулација · Документ · ИЗНОС) */
  calcs: { id: string; calcNo: string; doc: string; total: number; partner: string; advance: boolean }[];
}

export async function kalkDialogData(firmId: string, year: number): Promise<KalkDialogData> {
  const [P, L, C] = await Promise.all([
    db().select({ id: partners.id, name: partners.name, edb: partners.edb }).from(partners).where(eq(partners.firmId, firmId)).orderBy(partners.name),
    locationOptions(firmId),
    db().select({ id: purchases.id, calcNo: purchases.calcNo, number: purchases.number, total: purchases.total, data: purchases.data, sn: purchases.supplierName, pn: partners.name })
      .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
      .where(and(eq(purchases.firmId, firmId), isNotNull(purchases.calcNo), sql`${purchases.date} between ${year + '-01-01'} and ${year + '-12-31'}`))
      .orderBy(desc(purchases.date)).limit(300),
  ]);
  return {
    partners: P,
    locations: L.map((l) => ({ id: l.id, code: l.code ?? '', name: l.name ?? '', kind: l.kind })),
    calcs: C.map((c) => ({ id: c.id, calcNo: c.calcNo ?? '', doc: c.number ?? '', total: Number(c.total) || 0, partner: c.pn ?? c.sn ?? '', advance: (c.data as Record<string, unknown> | null)?.hxVid === 'av' })),
  };
}
