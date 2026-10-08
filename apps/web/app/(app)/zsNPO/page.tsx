/**
 * Legacy `VIEWS.zsNPO` 10463 (+ `npoCompute`, `npoTable`, ACT `npoClose`/`npoUnclose`) — Годишна сметка –
 * непрофитни организации (Сл. весник 117/05). The close is the common year close (`/mbyllja`), which uses the NPO
 * scheme for NPOs (FIX P8 #12, #16: the NPO close journal carries `net`).
 * FIX(P8 #12): the screen is shown by entity type (`yeEntityOf`), not by "the chart contains 730"; the chart only
 * decides which accounts the forms read.
 * Gap: the "small NPO" cash book and installing the NPO chart (`npoPlan`) are not ported yet.
 */
import Link from 'next/link';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { NpoTables } from '@/components/yearend/entity-tables';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';

export default async function ZsNpoPage() {
  const c = await yePage('zsNPO', 'zsNPO');
  if (!c) return <NoFirm t="Годишна сметка – НПО" />;
  const { L, firm, year } = c;
  return (
    <>
      <ZsHead id="zsNPO" t="Годишна сметка – непрофитна организација" year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn pri" href="/pecati/npo" target="_blank">🖨 Печати / PDF</Link>
        <Link className="btn" href="/mbyllja">Затворање</Link>
      </ZsHead>
      <NotClosedNote closed={L.Y.closed} year={year} />
      <div className="callout">Сметковен план: <b>{L.Y.npoChart === 'npo' ? 'за непрофитни организации (Сл. весник 117/05)' : 'за трговски друштва (контата се распоредуваат во образците за НПО)'}</b>.</div>
      <div className="card"><NpoTables N={L.Y.npo!} firm={firm} year={year} /></div>
    </>
  );
}
