/** Legacy `VIEWS.recon` 12933 (window from „Аналитички картици“, `ACT.recOpen`) — усогласување на картица со комитент. */
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { journals } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { partnerMap } from '@/lib/finance';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { kcQs, kcState, type KcSP } from '../kartici/data';
import { ReconForm } from './recon-client';

export default async function ReconPage({ searchParams }: { searchParams: Promise<KcSP> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('kartici');
  if (!firm) return <NoFirm t="Усогласување на картица" />;
  const s = kcState(sp, year);
  const P = await partnerMap(firm.id);
  const p = P.get(s.pid);
  const Y = await db().selectDistinct({ y: sql<number>`extract(year from ${journals.date})::int` }).from(journals).where(sql`${journals.firmId} = ${firm.id}`);
  const years = [...new Set([...Y.map((r) => Number(r.y)), year])].sort((a, b) => a - b);
  return (
    <>
      <Hd t="Усогласување на картица" sub={p?.name ?? ''}>
        <Link className="btn" href={`/kartici?${kcQs(s)}`}>← Аналитички картици</Link>
      </Hd>
      {p ? (
        <>
          <p className="note">Прикачете ја картицата / ИОС што ја испратил <b>{p.name}</b> (Excel или CSV). Програмот ги споредува ставките со вашата картица (конта {s.kontos.join(', ') || '12/22'}, {dmy(s.from)} – {dmy(s.to)}) – по број на документ, износ и датум – и ги покажува разликите. Нивното „Должи“ е ваше „Побарува“ и обратно. За потврда на салдото користете „📄 Потврда на салдо“ во картицата.</p>
          <ReconForm pid={p.id} k={s.kontos.join(',')} from={s.from} to={s.to} years={years} year={year} />
        </>
      ) : <div className="card empty">Изберете комитент во „Аналитички картици по комитент“.</div>}
    </>
  );
}
