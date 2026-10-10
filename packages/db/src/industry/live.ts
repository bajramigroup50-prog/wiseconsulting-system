/**
 * Vehicles live (legacy `pnLiveStart` 9439 → `pnSave(x)` with `x.pos` / `x.track`, `VIEWS.pnLive` 9452).
 *
 * The driver's phone posts its position for every order it drives that is on the road; points are throttled on the
 * phone (40 s / 150 m) and the last {@link LIVE_MAX_POINTS} per order are kept (legacy kept 400 in the order).
 */
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { LIVE_MAX_POINTS, validGeo, type GeoPos } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import { travelOrders, travelPositions, type TravelOrderRow } from '../schema/index';
import { IndustryError } from './context';

const fail = (m: string): never => { throw new IndustryError(m); };

/**
 * Store a position for the orders on the road that the user drives (assignee) or may write (`mayWrite(firmId)`).
 * Returns the number of orders updated; other ids are ignored (an order that just finished is not an error).
 */
export async function recordPosition(tx: Tx, user: { id: string }, orderIds: readonly string[], p: GeoPos, mayWrite: (firmId: string) => boolean): Promise<number> {
  if (!validGeo(p.lat, p.lon)) fail('Неважечка локација.');
  if (!orderIds.length) return 0;
  const O = await tx.select({ id: travelOrders.id, firmId: travelOrders.firmId, assigneeId: travelOrders.assigneeId, status: travelOrders.status })
    .from(travelOrders).where(inArray(travelOrders.id, [...orderIds]));
  const at = /^\d{4}-\d{2}-\d{2}T/.test(p.at) && Math.abs(Date.parse(p.at) - Date.now()) < 36e5 ? new Date(p.at) : new Date();
  let k = 0;
  for (const o of O) {
    if (o.status !== 'onroad' || (o.assigneeId !== user.id && !mayWrite(o.firmId))) continue;
    await tx.insert(travelPositions).values({
      firmId: o.firmId, orderId: o.id, lat: Number(p.lat).toFixed(6), lon: Number(p.lon).toFixed(6), at,
      acc: p.acc == null ? null : Math.round(Number(p.acc)), spd: p.spd == null ? null : Math.round(Number(p.spd)),
    });
    // Keep the newest LIVE_MAX_POINTS points of the order.
    const [cut] = await tx.select({ at: travelPositions.at }).from(travelPositions).where(eq(travelPositions.orderId, o.id)).orderBy(desc(travelPositions.at)).offset(LIVE_MAX_POINTS).limit(1);
    if (cut) await tx.delete(travelPositions).where(and(eq(travelPositions.orderId, o.id), lt(travelPositions.at, cut.at)));
    k++;
  }
  if (k) await audit(tx, { userId: user.id, firmId: O[0]?.firmId ?? null, action: 'pnLivePos', entityType: 'travel_order', entityId: O[0]?.id, data: { orders: k } });
  return k;
}

export interface LivePoint { lat: number; lon: number; acc: number | null; spd: number | null; at: string }
const pt = (r: { lat: string; lon: string; acc: number | null; spd: number | null; at: Date }): LivePoint => ({ lat: Number(r.lat), lon: Number(r.lon), acc: r.acc, spd: r.spd, at: r.at.toISOString() });

/** Orders of the firm on the road with their last position (legacy `VIEWS.pnLive` list). */
export async function liveVehicles(tx: Tx, firmId: string): Promise<{ o: TravelOrderRow; pos: LivePoint | null }[]> {
  const O = await tx.select().from(travelOrders).where(and(eq(travelOrders.firmId, firmId), eq(travelOrders.status, 'onroad')));
  if (!O.length) return [];
  const P = await tx.selectDistinctOn([travelPositions.orderId]).from(travelPositions).where(inArray(travelPositions.orderId, O.map((o) => o.id)))
    .orderBy(travelPositions.orderId, desc(travelPositions.at));
  return O.map((o) => {
    const p = P.find((x) => x.orderId === o.id);
    return { o, pos: p ? pt(p) : null };
  }).sort((a, b) => String(a.o.plate ?? '').localeCompare(String(b.o.plate ?? '')));
}

/** Track of one order (oldest first). */
export async function orderTrack(tx: Tx, firmId: string, orderId: string): Promise<LivePoint[]> {
  const R = await tx.select().from(travelPositions).where(and(eq(travelPositions.firmId, firmId), eq(travelPositions.orderId, orderId))).orderBy(travelPositions.at);
  return R.map(pt);
}

/** Number of points per order (diagnostics on the office screen). */
export async function trackCounts(tx: Tx, orderIds: readonly string[]): Promise<Map<string, number>> {
  if (!orderIds.length) return new Map();
  const R = await tx.select({ id: travelPositions.orderId, n: sql<number>`count(*)::int` }).from(travelPositions).where(inArray(travelPositions.orderId, [...orderIds])).groupBy(travelPositions.orderId);
  return new Map(R.map((r) => [r.id, r.n]));
}
