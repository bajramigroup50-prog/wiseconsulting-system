/**
 * Legacy `VIEWS.mojpn` 9384 — Мои патни налози: the field user's open travel orders (all firms) — card per order
 * (number · plate, date · driver · loaded x/y · cash with me), navigation through all stops, barcode loading, the trip
 * flow; the last 5 finished orders; live position while on the road.
 */
import { inArray } from 'drizzle-orm';
import { loadedCount, TRAVEL_ORDER_STATUS, travelRoute } from '@wise/core/industry';
import { doneOrdersOfAssignee, firms, ordersOfAssignee, stopsOf, travelItemInfo } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { TravelOrderFlow } from '@/components/travel-order-flow';
import { LiveTracker } from '@/components/live-tracker';
import { TravelScan, type ScanGood } from '@/components/travel-scan';

export default async function MojPn() {
  const u = await requireUser();
  const L0 = (await ordersOfAssignee(db(), u.id)).filter((x) => x.status !== 'done').sort((a, b) => a.date.localeCompare(b.date));
  const D0 = await doneOrdersOfAssignee(db(), u.id);
  const fids = [...new Set([...L0, ...D0].map((x) => x.firmId))];
  const F = fids.length ? await db().select({ id: firms.id, name: firms.name, mods: firms.mods }).from(firms).where(inArray(firms.id, fids)) : [];
  // FIX LEGACY-MAP 10.4 item 9: `mojpn` belongs to the travel-order module — orders of firms with the module off are hidden.
  const on = (fid: string) => !!F.find((f) => f.id === fid)?.mods.includes('pn');
  const L = L0.filter((x) => on(x.firmId)), D = D0.filter((x) => on(x.firmId));
  const scanOf = async (x: (typeof L)[number]): Promise<ScanGood[]> => {
    const S = stopsOf(x);
    const info = await travelItemInfo(db(), x.firmId, S.flatMap((s) => s.goods.map((g) => g.itemId)));
    return S.flatMap((s, i) => s.goods.map((g, k) => ({
      i, k, name: g.name, partner: s.partner, qty: Number(g.qty) || 0, lq: Number(g.lq) || 0, loaded: !!g.loaded, done: s.status === 'done',
      codes: [...new Set([...(g.bc ?? []), ...(g.itemId ? info.get(g.itemId)?.bc ?? [] : [])].map(String))],
    }))).filter((g) => g.qty > 0);
  };
  const SC = await Promise.all(L.map(scanOf));
  return (
    <>
      <Hd t="Мои патни налози" sub={u.name} exp={false} />
      <LiveTracker orderIds={L.filter((x) => x.status === 'onroad').map((x) => x.id)} />
      {L.map((x, n) => {
        const S = stopsOf(x);
        const cash = S.reduce((a, s) => a + (Number(s.cash) || 0), 0);
        const lc = loadedCount(S);
        const st = TRAVEL_ORDER_STATUS[x.status];
        const route = travelRoute({ from: x.from, stops: S }, x.status === 'onroad');
        return (
          <div key={x.id} className="card" style={{ borderLeft: `4px solid ${x.status === 'onroad' ? '#e08a00' : 'var(--accent)'}` }}>
            <div className="hd"><div><b style={{ fontSize: 16 }}>{x.number} · {x.plate}</b>
              <div className="mini">{dmy(x.date)} · {x.driver}{lc.total ? ` · натоварено ${lc.done}/${lc.total}` : ''}{cash ? ` · 💰 кај мене ${fmt(cash)} ден.` : ''} · {F.find((f) => f.id === x.firmId)?.name}</div></div>
              <span className={`pill ${st[1]}`}>{st[0]}</span></div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
              {route.map((r, i) => <a key={i} className="btn pri" style={{ fontSize: 15, padding: '10px 16px' }} href={r} target="_blank" rel="noopener noreferrer">🗺 {x.status === 'onroad' ? 'Навигација низ сите застанувања' : 'Рута во Google Maps'}{route.length > 1 ? ` (дел ${i + 1}/${route.length})` : ''}</a>)}
              {x.status !== 'done' && <TravelScan id={x.id} goods={SC[n]!} />}
            </div>
            <TravelOrderFlow x={x} events={false} />
          </div>
        );
      })}
      {!L.length && <div className="card empty">Немате отворени патни налози.</div>}
      {L.some((x) => x.status === 'onroad') && <div className="callout">📡 Додека сте на пат, локацијата се праќа во живо (оставете ја страницата отворена).</div>}
      {D.length > 0 && <div className="card"><b>Завршени</b>{D.map((x) => <div key={x.id} className="mini">{x.number} · {dmy(x.date)} · {x.plate}</div>)}</div>}
      <p className="note">При секое копче се бележи време и GPS локација (дозволете „Локација“ и „Камера“ на телефонот). Додека сте на пат, оставете ја оваа страница отворена – канцеларијата ја гледа позицијата на возилото во живо. Наплатата и поврат ги проверува и книжи канцеларијата.</p>
    </>
  );
}
