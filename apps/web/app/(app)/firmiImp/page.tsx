/** Legacy `VIEWS.firmiImp` (8865) — Увоз на фирми од Excel (the firm list with the import box on top). */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { firms } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { Hd } from '@/components/hd';
import { ImportBox } from './import-box';

export default async function FirmiImpPage() {
  const { u } = await officePage('firmiImp');
  if (!can(u.principal, 'firms')) notFound();
  const [c] = await db().select({ n: sql<number>`count(*)::int` }).from(firms);
  return (
    <>
      <Hd t="Увоз на фирми од Excel" sub={`${c?.n ?? 0} фирми во програмата`}>
        <Link className="btn" href="/firmi">Фирми</Link>
        <Link className="btn" href="/firmiResh">📷 Нова фирма од решение</Link>
      </Hd>
      <ImportBox canProfiles={can(u.principal, 'users')} />
    </>
  );
}
