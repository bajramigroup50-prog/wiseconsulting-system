/**
 * Travel orders — legacy parity helpers (legacy 9223–9488): odometer (`pnOdo`), service status (`pnSvc`), document
 * deadlines, fuel per month and alerts (`pnFuelRows` / `pnFuelAlerts`), Google Maps route (`pnRoute`), duration text
 * (`pnHM`), barcode loading (`pnScanCode`), per diems (`pnDnevRows`), new-order defaults (`pnNew`), the delivery
 * confirmation (`pnPodHTML`) and its e-mail text (`pnMail`).
 */
import { dayDiff, num, r2 } from './common';
import { fuelByVehicle, travelPerDiem, type TransportConfig, type TravelEvent, type TravelGood, type TravelStop } from './transport';

export interface FleetLike {
  id: string; plate: string; name?: string | null; odo?: number | null; fuelNorm?: number | string | null; capKg?: number | null;
  oilEvery?: number | null; oilLastKm?: number | null; tyreEvery?: number | null; tyreLastKm?: number | null;
  regExp?: string | null; insExp?: string | null; techExp?: string | null;
}
type OrderKm = { vehicleId?: string | null; depKm?: number | string | null; retKm?: number | string | null };

/** Legacy `pnOdo`: the largest km of the vehicle's orders, or its own odometer. */
export function vehicleOdo(vehicleId: string, orders: readonly OrderKm[], odo0?: number | null): number {
  let m = 0;
  for (const x of orders) if (x.vehicleId === vehicleId) m = Math.max(m, num(x.retKm), num(x.depKm));
  return Math.max(m, num(odo0));
}

export interface ServiceStatus { t: 'oil' | 'tyre'; n: string; due: number; left: number; odo: number; st: '' | 'bad' | 'warn' | 'good' }
/** Legacy `pnSvc`: oil / tyre service due — `warn` within 1000 km, `bad` when passed, '' without an odometer. */
export function vehicleService(v: FleetLike | null | undefined, odo: number): ServiceStatus[] {
  if (!v) return [];
  const L: Omit<ServiceStatus, 'st'>[] = [];
  if (num(v.oilEvery)) { const due = num(v.oilLastKm) + num(v.oilEvery); L.push({ t: 'oil', n: 'Сервис (масло и филтри)', due, left: due - odo, odo }); }
  if (num(v.tyreEvery)) { const due = num(v.tyreLastKm) + num(v.tyreEvery); L.push({ t: 'tyre', n: 'Гуми', due, left: due - odo, odo }); }
  return L.map((s) => ({ ...s, st: !odo ? '' : s.left < 0 ? 'bad' : s.left < 1000 ? 'warn' : 'good' }));
}
export const serviceDue = (v: FleetLike | null | undefined, odo: number) => vehicleService(v, odo).filter((s) => s.st === 'bad' || s.st === 'warn');
/** Legacy text: „поминат пред N км“ / „за N км“ (the list callout uses „поминат пред“, the service tab „поминат“). */
export const serviceLeftText = (left: number, fq: (n: number) => string, before = true) => (left < 0 ? `поминат ${before ? 'пред ' : ''}${fq(-left)} км` : `за ${fq(left)} км`);

/** Legacy `osDays`: days from `today` to `d` (negative = passed); null without a date. */
export const daysTo = (d: string | null | undefined, today: string): number | null => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? dayDiff(today, d) : null);

export const VEHICLE_DOCS = [['regExp', 'регистрација'], ['insExp', 'осигурување'], ['techExp', 'технички преглед']] as const;
/** Legacy list callout: registration / insurance / technical check expiring within `within` days (or expired). */
export function vehicleDocAlerts(v: FleetLike, today: string, within = 30): { n: string; d: string; days: number }[] {
  const out: { n: string; d: string; days: number }[] = [];
  for (const [k, n] of VEHICLE_DOCS) { const days = daysTo(v[k], today); if (days != null && days <= within) out.push({ n, d: v[k]!, days }); }
  return out;
}
/** Legacy editor callout: documents already expired (the vehicle must not leave). */
export const vehicleExpired = (v: FleetLike | null | undefined, today: string): string[] =>
  v ? VEHICLE_DOCS.map(([k]) => v[k]).filter((d): d is string => { const n = daysTo(d, today); return n != null && n < 0; }) : [];

/** Legacy `pnHM`: „5 ч 07 мин“. */
export function hoursMinutes(hrs: number | null | undefined): string {
  if (hrs == null) return '—';
  const mm = Math.round(hrs * 60);
  return `${Math.floor(mm / 60)} ч ${String(mm % 60).padStart(2, '0')} мин`;
}

/** Km driven of an order (0 without both readings). */
export const orderKm = (x: OrderKm): number => (num(x.retKm) && num(x.depKm) ? num(x.retKm) - num(x.depKm) : 0);
/** l/100 km of an order. */
export const orderL100 = (x: OrderKm & { fuelL?: number | string | null }): number => { const km = orderKm(x); return km > 0 && num(x.fuelL) ? r2((num(x.fuelL) / km) * 100) : 0; };

/** Legacy `pnRoute`: Google Maps directions through the open stops and back (split per 9 legs). */
export function travelRoute(x: { from?: string | null; stops: readonly TravelStop[] }, fromHere = false): string[] {
  const place = (s: TravelStop) => s.addr || s.partner || '';
  const open = x.stops.filter((s) => s.status !== 'done' && place(s));
  const P = [fromHere ? '' : x.from || '', ...open.map(place), x.from || ''];
  if (P.length < 2 || !open.length) return [];
  const out: string[] = [];
  for (let i = 0; i < P.length - 1; i += 9) out.push('https://www.google.com/maps/dir/' + P.slice(i, i + 10).map((p) => encodeURIComponent(p)).join('/'));
  return out;
}

/* ------------------------------------------------------------------ fuel */

export interface FuelMonth { mo: string; n: number; km: number; l: number; amt: number; avg: number; ckm: number; bad: boolean }
/** Legacy `pnFuelRows` with the vehicle's norm and name, sorted by plate. */
export function fuelRows(orders: Parameters<typeof fuelByVehicle>[0], vehicles: readonly FleetLike[]) {
  return fuelByVehicle(orders).map((r) => {
    const v = vehicles.find((y) => y.id === r.vehicleId);
    const norm = num(v?.fuelNorm);
    const months: FuelMonth[] = Object.entries(r.mo).sort(([a], [b]) => a.localeCompare(b)).map(([mo, m]) => {
      const avg = m.km && m.l ? r2((m.l / m.km) * 100) : 0;
      return { mo, n: m.n, km: m.km, l: r2(m.l), amt: r2(m.amt), avg, ckm: m.km && m.amt ? r2(m.amt / m.km) : 0, bad: !!(norm && avg && m.km >= 200 && avg > norm * 1.15) };
    });
    return { ...r, name: v?.name ?? '', norm, dev: norm && r.avg ? r2((r.avg / norm - 1) * 100) : null, months };
  }).sort((a, b) => String(a.plate).localeCompare(String(b.plate)));
}
/** Legacy `pnFuelAlerts`: months with ≥ 200 km and consumption more than 15% over the norm. */
export function fuelAlerts(rows: ReturnType<typeof fuelRows>): { plate: string; mo: string; avg: number; norm: number; dev: number }[] {
  const A: { plate: string; mo: string; avg: number; norm: number; dev: number }[] = [];
  for (const r of rows) {
    if (!r.norm) continue;
    for (const m of r.months) {
      if (m.km < 200 || !m.l) continue;
      const avg = r2((m.l / m.km) * 100);
      const dev = r2((avg / r.norm - 1) * 100);
      if (dev > 15) A.push({ plate: r.plate, mo: m.mo.slice(5) + '/' + m.mo.slice(0, 4), avg, norm: r.norm, dev });
    }
  }
  return A;
}

/* ------------------------------------------------------------------ per diems */

type DnevOrder = { id: string; status: string; dnev: boolean; date: string; number: string; driver?: string | null; plate?: string | null; events: readonly TravelEvent[] };
/** Legacy `pnDnevRows`: finished orders marked as business trips, by date, with departure / return time. */
export function perDiemRows<T extends DnevOrder>(orders: readonly T[], cfg: Pick<TransportConfig, 'dnevAmt'>) {
  return orders.filter((x) => x.status === 'done' && x.dnev).map((x) => {
    const d = travelPerDiem({ dnev: true, events: x.events }, cfg)!;
    const dep = x.events.find((e) => e.k === 'dep')?.at ?? null;
    const ret = [...x.events].reverse().find((e) => e.k === 'ret')?.at ?? null;
    return { x, d, dep, ret };
  }).sort((a, b) => String(a.x.date).localeCompare(String(b.x.date)));
}
/** Legacy „Збир по возач и месец (за пресметка на плата)“. */
export function perDiemByDriverMonth(rows: ReturnType<typeof perDiemRows>): { dr: string; mo: string; n: number; amt: number }[] {
  const by = new Map<string, { dr: string; mo: string; n: number; amt: number }>();
  for (const { x, d } of rows) {
    const dr = x.driver || '—', mo = String(x.date).slice(0, 7);
    const r = by.get(dr + '|' + mo) ?? { dr, mo, n: 0, amt: 0 };
    by.set(dr + '|' + mo, r);
    r.n++;
    r.amt = r2(r.amt + d.amt);
  }
  return [...by.values()].sort((a, b) => (a.dr + a.mo).localeCompare(b.dr + b.mo));
}

/* ------------------------------------------------------------------ new order (pnNew) */

/** Legacy `pnNew`: vehicle default → last order → first; driver default → last → the only one; assignee default → last; km from the odometer or the last return km. */
export function newTravelOrderDefaults(o: {
  cfg: Pick<TransportConfig, 'vehicleId' | 'driverId' | 'assignee' | 'dnevOn'>;
  last?: { vehicleId?: string | null; driverId?: string | null; assigneeId?: string | null; retKm?: number | null } | null;
  vehicles: readonly { id: string }[]; drivers: readonly { id: string }[]; odoOf: (vid: string) => number;
}) {
  const L = o.last ?? {};
  const vehicleId = o.cfg.vehicleId || L.vehicleId || o.vehicles[0]?.id || '';
  const driverId = o.cfg.driverId || L.driverId || (o.drivers.length === 1 ? o.drivers[0]!.id : '');
  const odo = vehicleId ? o.odoOf(vehicleId) : 0;
  return { vehicleId, driverId, assigneeId: o.cfg.assignee || L.assigneeId || '', depKm: odo || L.retKm || null, dnev: !!o.cfg.dnevOn };
}

/* ------------------------------------------------------------------ loading */

/** Goods loaded / total (legacy mojpn card „натоварено x/y“). */
export function loadedCount(stops: readonly TravelStop[]): { done: number; total: number } {
  const G = stops.flatMap((s) => s.goods ?? []);
  return { done: G.filter((g) => g.loaded).length, total: G.length };
}
/** Legacy `pnDep` confirmation: items not loaded, asked only when some goods were scanned. */
export function departureCheck(stops: readonly TravelStop[]): { notLoaded: number; scanned: boolean } {
  const G = stops.flatMap((s) => s.goods ?? []).filter((g) => g.qty !== '');
  return { notLoaded: G.filter((g) => !g.loaded).length, scanned: stops.some((s) => (s.goods ?? []).some((g) => num(g.lq) > 0)) };
}

/**
 * Legacy `pnScanCode`: the first good of an open stop whose barcodes (`codesOf`) contain the code and that is not yet
 * fully loaded; `full` names a matching good that is already loaded.
 */
export function scanFind(stops: readonly TravelStop[], code: string, codesOf: (g: TravelGood) => readonly string[]): { hit: { i: number; k: number } | null; full: string | null } {
  const c = String(code).trim();
  let full: string | null = null;
  for (const [i, s] of stops.entries()) {
    if (s.status === 'done') continue;
    for (const [k, g] of (s.goods ?? []).entries()) {
      if (!codesOf(g).map(String).includes(c)) continue;
      if (g.loaded) { full = g.name; continue; }
      return { hit: { i, k }, full };
    }
  }
  return { hit: null, full };
}
/** One scan of good (i,k): +1, loaded when the quantity is reached. Returns a new stops array. */
export function scanAdd(stops: readonly TravelStop[], i: number, k: number, all = false): TravelStop[] {
  return stops.map((s, si) => si !== i ? s : {
    ...s, goods: s.goods.map((g, gk) => {
      if (gk !== k) return g;
      const q = num(g.qty);
      const lq = all ? q : num(g.lq) + 1;
      return lq >= q ? { ...g, lq: q, loaded: true } : { ...g, lq };
    }),
  });
}

/* ------------------------------------------------------------------ delivery confirmation (pnPodHTML / pnMail) */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const h = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);
const fq = (n: number) => { const [i, d = ''] = String(Math.round(Math.abs(n) * 1000) / 1000).split('.') as [string, string?]; return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : ''); };
const fmt = (n: number) => { const [i, d] = Math.abs(n).toFixed(2).split('.') as [string, string]; return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };

/** „YYYY-MM-DD HH:MM“ in Skopje time (legacy sliced the ISO string). */
export function skDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Skopje', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Returned quantity of good k of a stop. */
export const returnedQty = (s: TravelStop, k: number): number => num((s.ret ?? []).find((r) => r.k === k)?.qty);

/**
 * Legacy `pnPodHTML`: „ПОТВРДА ЗА ИСПОРАКА“ — buyer, time, GPS, vehicle / driver, cash, receiver, goods (qty, returned,
 * received), signature and photo (`img(fileId)` → src).
 */
export function podHtml(o: {
  firm: { name: string; edb?: string | null; address?: string | null };
  order: { number: string; plate?: string | null; driver?: string | null };
  stop: TravelStop & { geo?: { lat: number; lon: number; acc?: number | null } | null };
  img: (fileId: string) => string;
}): string {
  const { firm: f, order: x, stop: s } = o;
  const geo = s.geo ? `${s.geo.lat}, ${s.geo.lon}${s.geo.acc != null ? ` (±${s.geo.acc} м)` : ''}` : '—';
  return `<div class="ph"><div><div class="pt">ПОТВРДА ЗА ИСПОРАКА</div><div class="ps">${h(s.doc)} · патен налог ${h(x.number)}</div></div></div>`
    + `<p><b>${h(f.name)}</b> · ЕДБ ${h(f.edb ?? '')}${f.address ? ' · ' + h(f.address) : ''}</p>`
    + `<table><tbody><tr><td style="width:30%">Купувач</td><td><b>${h(s.partner)}</b>${s.addr ? '<br>' + h(s.addr) : ''}</td></tr><tr><td>Испорачано на</td><td>${h(skDateTime(s.at))}</td></tr>`
    + `<tr><td>Локација (GPS)</td><td>${h(geo)}</td></tr><tr><td>Возило / возач</td><td>${h(x.plate ?? '')} · ${h(x.driver ?? '')}</td></tr>`
    + (num(s.cash) ? `<tr><td>Наплатено во готово</td><td><b>${fmt(num(s.cash))}</b> ден.</td></tr>` : '')
    + `<tr><td>Примил</td><td>${h(s.recv ?? '')}</td></tr></tbody></table>`
    + `<h2>Стока</h2><table><thead><tr><th>Артикл</th><th class="n">Количина</th><th class="n">Вратено</th><th class="n">Примено</th></tr></thead><tbody>`
    + s.goods.map((g, k) => { const r = returnedQty(s, k); return `<tr><td>${h(g.name)}</td><td class="n">${fq(num(g.qty))} ${h(g.unit ?? '')}</td><td class="n">${r ? fq(r) : ''}</td><td class="n">${fq(num(g.qty) - r)}</td></tr>`; }).join('')
    + `</tbody></table><div style="display:flex;gap:16px;margin-top:14px;align-items:flex-start">`
    + (s.sig ? `<div><div style="font-size:9pt">Потпис на примачот:</div><img src="${h(o.img(s.sig))}" style="height:90px;border-bottom:1px solid #000"></div>` : '')
    + (s.photo ? `<div><div style="font-size:9pt">Слика при испорака:</div><img src="${h(o.img(s.photo))}" style="height:150px;border:1px solid #999"></div>` : '')
    + `</div>`;
}

/** Legacy `pnMail`: subject and text of the „Испорачано“ notice to the buyer. */
export function podMailText(o: { firm: { name: string; phone?: string | null }; stop: TravelStop }): { subject: string; body: string } {
  const s = o.stop;
  const ret = (s.ret ?? []).filter((r) => num(r.qty));
  const body = `Почитувани,\n\nВе известуваме дека стоката по ${s.doc} е испорачана на ${skDateTime(s.at)}${s.recv ? ' и ја прими ' + s.recv : ''}.`
    + (num(s.cash) ? `\nНаплатено во готово: ${fmt(num(s.cash))} ден.` : '')
    + (ret.length ? `\nВратена стока: ${ret.map((r) => (s.goods[r.k]?.name ?? '') + ' ' + fq(num(r.qty))).join(', ')} – ќе добиете одобрение.` : '')
    + `\nВо прилог е потврдата за испорака.\n\nСо почит,\n${o.firm.name}${o.firm.phone ? '\nТел.: ' + o.firm.phone : ''}`;
  return { subject: `Испорачано: ${s.doc} – ${o.firm.name}`, body };
}
/** Stops of an order the bulk „✉ Извести ги купувачите“ sends to: delivered, not mailed, with an e-mail. */
export const mailableStops = (stops: readonly TravelStop[], emailOf: (s: TravelStop) => string | null | undefined): number[] =>
  stops.map((s, i) => ({ s, i })).filter(({ s }) => s.status === 'done' && s.kind !== 'pick' && !s.mailed && !!emailOf(s)).map(({ i }) => i);

