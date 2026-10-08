/** Legacy `VIEWS.izvestuvanja` **8552** (`alMatrixHTML`) — notifications for all firms: firm × category matrix. */
import Link from 'next/link';
import { and, desc, inArray, isNull } from 'drizzle-orm';
import { AL_CATS, AL_DESC } from '@wise/core/office';
import { autopilotFindings, autopilotRuns } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, officePage } from '@/lib/office';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { runNow } from '../autop/actions';

export default async function IzvestuvanjaPage() {
  const { u } = await officePage('izvestuvanja', { perm: 'office' });
  const F = await allowedFirms(u);
  const ids = F.map((f) => f.id);
  const [find, [run]] = await Promise.all([
    ids.length ? db().select().from(autopilotFindings).where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt))) : Promise.resolve([]),
    db().select().from(autopilotRuns).orderBy(desc(autopilotRuns.startedAt)).limit(1),
  ]);
  const cats = AL_CATS.filter((c) => find.some((x) => x.cat === c));
  const rows = F.map((f) => ({ f, L: find.filter((x) => x.firmId === f.id) })).filter((r) => r.L.length)
    .sort((a, b) => b.L.filter((x) => x.lvl === 'bad').length - a.L.filter((x) => x.lvl === 'bad').length);
  const cell = (L: typeof find, c: string) => {
    const x = L.filter((y) => y.cat === c);
    if (!x.length) return <td key={c} />;
    const lvl = x.some((y) => y.lvl === 'bad') ? 'bad' : x.some((y) => y.lvl === 'warn') ? 'warn' : 'info';
    return <td key={c} title={x.map((y) => y.txt).join('\n')}><span className={`pill ${lvl}`}>{x.length}</span></td>;
  };
  return (
    <>
      <Hd t="🔔 Известувања за сите фирми" sub={run ? `проверено ${dmyHm(run.finishedAt ?? run.startedAt)}` : ''}>
        <RowAction className="btn" action={runNow} label="↻ Провери сега" /><Link className="btn" href="/autop">🤖 Автопилот</Link>
      </Hd>
      {rows.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th>{cats.map((c) => <th key={c} title={AL_DESC[c]}>{c}</th>)}</tr></thead>
          <tbody>{rows.map(({ f, L }) => <tr key={f.id}><td>{f.name}</td>{cats.map((c) => cell(L, c))}</tr>)}</tbody>
        </table></div>
      ) : <div className="card empty">Нема известувања. 👍</div>}
    </>
  );
}
