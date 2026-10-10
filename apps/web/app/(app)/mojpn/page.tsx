/** Legacy `VIEWS.mojpn` 9384 — Мои патни налози: the field user's open travel orders (all firms) with the trip flow. */
import { inArray } from 'drizzle-orm';
import { firms, ordersOfAssignee } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { TravelOrderFlow } from '@/components/travel-order-flow';
import { LiveTracker } from '@/components/live-tracker';
import { TRAVEL_ORDER_STATUS } from '@wise/core/industry';

export default async function MojPn() {
  const u = await requireUser();
  const L0 = await ordersOfAssignee(db(), u.id);
  const F = L0.length ? await db().select({ id: firms.id, name: firms.name, mods: firms.mods }).from(firms).where(inArray(firms.id, [...new Set(L0.map((x) => x.firmId))])) : [];
  // FIX LEGACY-MAP 10.4 item 9: `mojpn` belongs to the travel-order module — orders of firms with the module off are hidden.
  const L = L0.filter((x) => F.find((f) => f.id === x.firmId)?.mods.includes('pn'));
  return (
    <>
      <Hd t="Мои патни налози" sub={`${L.length} отворени`} />
      <LiveTracker orderIds={L.filter((x) => x.status === 'onroad').map((x) => x.id)} />
      {L.map((x) => (
        <div key={x.id}>
          <h2 style={{ fontSize: 16 }}>{x.number} · {dmy(x.date)} · {x.plate} · {F.find((f) => f.id === x.firmId)?.name} <span className={`pill ${TRAVEL_ORDER_STATUS[x.status][1]}`}>{TRAVEL_ORDER_STATUS[x.status][0]}</span></h2>
          <TravelOrderFlow x={x} />
        </div>
      ))}
      {!L.length && <div className="card empty">Немате отворени патни налози.</div>}
    </>
  );
}
