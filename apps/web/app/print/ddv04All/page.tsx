/** Legacy `apClPrint` („🖨 Печати ДДВ-04 (означени)“ in Автопилот › Затворање): the ДДВ-04 form of every selected firm. */
import { notFound } from 'next/navigation';
import { inArray } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { apClPeriodFor } from '@wise/core/office/ap-close';
import { todaySkopje } from '@wise/core/office';
import { computeVatPeriod, firms, firmVatPeriodKind } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { vatSource } from '@/lib/vat-source';
import { Ddv04Form } from '../../(app)/ddv/ddv04-form';

export const metadata = { title: 'ДДВ-04 – означени фирми' };

export default async function PrintDdv04All({ searchParams }: { searchParams: Promise<{ mode?: string; id?: string | string[] }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  if (!can(u.principal, 'office')) notFound();
  const ids = [sp.id ?? []].flat().filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 300);
  const F = ids.length ? (await db().select().from(firms).where(inArray(firms.id, ids))).filter((f) => firmAllowed(u.principal, f.id, f.ownerId)) : [];
  const td = todaySkopje();
  const out: { f: (typeof F)[number]; p: string; fields: Awaited<ReturnType<typeof computeVatPeriod>>['fields'] }[] = [];
  for (const f of F.sort((a, b) => a.name.localeCompare(b.name, 'mk'))) {
    const p = apClPeriodFor(sp.mode ?? 'auto', firmVatPeriodKind(f), td);
    if (!p || !f.vatRegistered) continue;
    out.push({ f, p, fields: (await computeVatPeriod(db(), f, p, vatSource)).fields });
  }
  if (!out.length) notFound();
  return (
    <>
      {out.map(({ f, p, fields }, i) => (
        <div key={f.id} className="pdfdoc" style={i ? { pageBreakBefore: 'always' } : undefined}>
          <Ddv04Form firm={f} period={p} fields={fields} today={td} />
        </div>
      ))}
    </>
  );
}
