import { describe, expect, it } from 'vitest';
import {
  daysTo, departureCheck, fuelAlerts, fuelRows, hoursMinutes, loadedCount, mailableStops, newTravelOrderDefaults, perDiemByDriverMonth, perDiemRows,
  podHtml, podMailText, scanAdd, scanFind, serviceDue, skDateTime, travelRoute, vehicleDocAlerts, vehicleExpired, vehicleOdo, vehicleService,
  type TravelStop,
} from './industry';

const stop = (o: Partial<TravelStop>): TravelStop => ({ kind: 'deliv', doc: 'Фактура 1', partner: 'Купувач', goods: [], status: 'open', ...o });

describe('travel orders — vehicles (pnOdo / pnSvc / documents)', () => {
  it('odometer is the largest order km or the vehicle odometer', () => {
    expect(vehicleOdo('v', [{ vehicleId: 'v', depKm: 1000, retKm: 1200 }, { vehicleId: 'w', retKm: 9000 }], 1100)).toBe(1200);
    expect(vehicleOdo('v', [], 500)).toBe(500);
  });
  it('service status: warn within 1000 km, bad when passed, none without odometer', () => {
    const v = { id: 'v', plate: 'SK', oilEvery: 15000, oilLastKm: 10000, tyreEvery: 40000, tyreLastKm: 0 };
    const S = vehicleService(v, 24500);
    expect(S.map((s) => [s.t, s.due, s.left, s.st])).toEqual([['oil', 25000, 500, 'warn'], ['tyre', 40000, 15500, 'good']]);
    expect(vehicleService(v, 26000)[0]!.st).toBe('bad');
    expect(vehicleService(v, 0)[0]!.st).toBe('');
    expect(serviceDue(v, 24500).length).toBe(1);
  });
  it('documents within 30 days and expired', () => {
    const v = { id: 'v', plate: 'SK', regExp: '2026-10-20', insExp: '2026-09-30', techExp: '2027-05-01' };
    expect(vehicleDocAlerts(v, '2026-10-10').map((x) => [x.n, x.days])).toEqual([['регистрација', 10], ['осигурување', -10]]);
    expect(vehicleExpired(v, '2026-10-10')).toEqual(['2026-09-30']);
    expect(daysTo(null, '2026-10-10')).toBeNull();
  });
});

describe('travel orders — fuel (pnFuelRows / pnFuelAlerts)', () => {
  const O = [
    { status: 'done', date: '2026-03-02', vehicleId: 'v', plate: 'SK-1', depKm: 1000, retKm: 1150, fuelL: 30, fuelAmt: 2400 },
    { status: 'done', date: '2026-03-20', vehicleId: 'v', plate: 'SK-1', depKm: 1150, retKm: 1250, fuelL: 20, fuelAmt: 1600 },
    { status: 'done', date: '2026-04-01', vehicleId: 'v', plate: 'SK-1', depKm: 1250, retKm: 1350, fuelL: 30, fuelAmt: 2400 },
    { status: 'open', date: '2026-04-02', vehicleId: 'v', plate: 'SK-1', depKm: 1350, retKm: null, fuelL: null, fuelAmt: null },
  ];
  it('per vehicle and month with the norm', () => {
    const R = fuelRows(O, [{ id: 'v', plate: 'SK-1', name: 'Iveco', fuelNorm: 15 }]);
    expect(R).toHaveLength(1);
    expect(R[0]!.km).toBe(350);
    expect(R[0]!.avg).toBe(22.86);
    expect(R[0]!.months.map((m) => [m.mo, m.km, m.avg, m.bad])).toEqual([['2026-03', 250, 20, true], ['2026-04', 100, 30, false]]);
    expect(fuelAlerts(R)).toEqual([{ plate: 'SK-1', mo: '03/2026', avg: 20, norm: 15, dev: 33.33 }]);
  });
  it('no alerts without norm', () => {
    expect(fuelAlerts(fuelRows(O, []))).toEqual([]);
  });
});

describe('travel orders — route, duration, per diems, defaults', () => {
  it('route through open stops and back, split per 9 legs', () => {
    const S = Array.from({ length: 10 }, (_, i) => stop({ addr: 'A' + i }));
    const R = travelRoute({ from: 'Магацин', stops: S });
    expect(R).toHaveLength(2);
    expect(R[0]).toBe('https://www.google.com/maps/dir/' + ['Магацин', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].map(encodeURIComponent).join('/'));
    expect(R[1]).toBe('https://www.google.com/maps/dir/A8/A9/' + encodeURIComponent('Магацин'));
    expect(travelRoute({ from: 'M', stops: [stop({ addr: 'X', status: 'done' })] })).toEqual([]);
    expect(travelRoute({ from: 'M', stops: [stop({ addr: 'X' })] }, true)[0]).toBe('https://www.google.com/maps/dir//X/M');
  });
  it('pnHM', () => {
    expect(hoursMinutes(5.12)).toBe('5 ч 07 мин');
    expect(hoursMinutes(null)).toBe('—');
  });
  it('per diem rows and sums per driver and month', () => {
    const ev = (a: string, b: string) => [{ k: 'dep' as const, txt: '', at: a }, { k: 'ret' as const, txt: '', at: b }];
    const O = [
      { id: '1', status: 'done', dnev: true, date: '2026-05-02', number: '002/2026', driver: 'Петко', events: ev('2026-05-02T05:00:00Z', '2026-05-02T18:00:00Z') },
      { id: '2', status: 'done', dnev: true, date: '2026-05-01', number: '001/2026', driver: 'Петко', events: ev('2026-05-01T05:00:00Z', '2026-05-01T14:00:00Z') },
      { id: '3', status: 'done', dnev: false, date: '2026-05-01', number: '003/2026', driver: 'Петко', events: [] },
    ];
    const R = perDiemRows(O, { dnevAmt: 1000 });
    expect(R.map((r) => [r.x.number, r.d.pct, r.d.amt])).toEqual([['001/2026', 50, 500], ['002/2026', 100, 1000]]);
    expect(perDiemByDriverMonth(R)).toEqual([{ dr: 'Петко', mo: '2026-05', n: 2, amt: 1500 }]);
  });
  it('new order defaults (pnNew)', () => {
    const d = newTravelOrderDefaults({ cfg: { vehicleId: '', driverId: '', assignee: '', dnevOn: true }, last: { vehicleId: 'v2', driverId: null, assigneeId: 'u', retKm: 777 }, vehicles: [{ id: 'v1' }, { id: 'v2' }], drivers: [{ id: 'd' }], odoOf: () => 0 });
    expect(d).toEqual({ vehicleId: 'v2', driverId: 'd', assigneeId: 'u', depKm: 777, dnev: true });
    expect(newTravelOrderDefaults({ cfg: { vehicleId: 'v1', driverId: '', assignee: 'x', dnevOn: false }, vehicles: [], drivers: [{ id: 'a' }, { id: 'b' }], odoOf: () => 5000 }))
      .toEqual({ vehicleId: 'v1', driverId: '', assigneeId: 'x', depKm: 5000, dnev: false });
  });
});

describe('travel orders — barcode loading (pnScanCode)', () => {
  const S = [
    stop({ goods: [{ name: 'Брашно', qty: 2, itemId: 'a' }, { name: 'Шеќер', qty: 1, itemId: 'b' }] }),
    stop({ status: 'done', goods: [{ name: 'Брашно', qty: 5, itemId: 'a' }] }),
  ];
  const codes = (g: { itemId?: string | null }) => (g.itemId === 'a' ? ['3870001'] : g.itemId === 'b' ? ['3870002', 'SH'] : []);
  it('finds the first open good, counts scans and marks it loaded', () => {
    const f = scanFind(S, '3870001', codes);
    expect(f.hit).toEqual({ i: 0, k: 0 });
    let T = scanAdd(S, 0, 0);
    expect(T[0]!.goods[0]).toMatchObject({ lq: 1 });
    expect(T[0]!.goods[0]!.loaded).toBeFalsy();
    T = scanAdd(T, 0, 0);
    expect(T[0]!.goods[0]).toMatchObject({ lq: 2, loaded: true });
    expect(scanFind(T, '3870001', codes)).toEqual({ hit: null, full: 'Брашно' });
    expect(scanFind(T, 'XXX', codes)).toEqual({ hit: null, full: null });
    expect(scanAdd(T, 0, 1, true)[0]!.goods[1]).toMatchObject({ lq: 1, loaded: true });
    expect(loadedCount(T)).toEqual({ done: 1, total: 3 });
  });
  it('departure check asks only after scanning', () => {
    expect(departureCheck(S)).toEqual({ notLoaded: 3, scanned: false });
    expect(departureCheck(scanAdd(S, 0, 0))).toEqual({ notLoaded: 3, scanned: true });
  });
});

describe('travel orders — delivery confirmation (pnPodHTML / pnMail)', () => {
  const s = stop({ status: 'done', doc: 'Фактура 12', at: '2026-10-10T08:05:00Z', recv: 'Ана', cash: 1500, sig: 'S1', photo: 'P1', geo: { lat: 42, lon: 21.4 },
    goods: [{ name: 'Брашно', qty: 10, unit: 'вр' }, { name: 'Шеќер <1>', qty: 3, unit: 'кг' }], ret: [{ k: 1, qty: 1 }], email: 'a@b.mk' });
  it('POD html', () => {
    const H = podHtml({ firm: { name: 'Фирма', edb: '4030' }, order: { number: '001/2026', plate: 'SK-1', driver: 'Петко' }, stop: s, img: (id) => '/api/files/' + id });
    expect(H).toContain('ПОТВРДА ЗА ИСПОРАКА');
    expect(H).toContain('2026-10-10 10:05');
    expect(H).toContain('Шеќер &lt;1&gt;');
    expect(H).toContain('<td class="n">1</td><td class="n">2</td>');
    expect(H).toContain('1.500,00');
    expect(H).toContain('src="/api/files/S1"');
  });
  it('mail text and mailable stops', () => {
    const m = podMailText({ firm: { name: 'Фирма', phone: '070' }, stop: s });
    expect(m.subject).toBe('Испорачано: Фактура 12 – Фирма');
    expect(m.body).toContain('испорачана на 2026-10-10 10:05 и ја прими Ана.');
    expect(m.body).toContain('Вратена стока: Шеќер <1> 1 – ќе добиете одобрение.');
    expect(m.body).toContain('Тел.: 070');
    expect(mailableStops([s, { ...s, kind: 'pick' }, { ...s, mailed: 'x' }, { ...s, status: 'open' }], (x) => x.email)).toEqual([0]);
    expect(skDateTime('2026-01-10T08:05:00Z')).toBe('2026-01-10 09:05');
  });
});
