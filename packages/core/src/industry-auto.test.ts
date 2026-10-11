import { describe, expect, it } from 'vitest';
import {
  autoConfig, detectFuelColumns, findPartItem, fitsVehicle, fuelByPlate, fuelDate, fuelNum, fuelRowsFromSheet, geoDistance, partAlternatives, partNums,
  plateNorm, reminderText, searchParts, serviceReminders, shouldSendPosition, tourFuel, trackProjection, vehicleLabel, vehicleProblems, viewEnabled,
  waNumber, woCalc, woState, workOrderInvoiceLines,
} from './industry';

describe('auto service (legacy woCalc / woSt / vehLbl)', () => {
  it('totals parts with discount and labour, VAT per line', () => {
    const c = woCalc({
      parts: [{ name: 'Филтер', qty: 2, price: 333.33, disc: 10, rate: 18 }, { name: 'Масло', qty: 4.5, price: 420, rate: 18 }],
      labour: [{ name: 'Замена масло', hrs: 1.5, price: 1000, rate: 18 }],
    });
    // 2·333.33·0.9 = 599.994 → 599.99 ; 4.5·420 = 1890 ; labour 1500
    expect(c).toEqual({ pb: 2489.99, lb: 1500, base: 3989.99, vat: r(108 + 340.2 + 270), tot: r(3989.99 + 108 + 340.2 + 270) });
  });
  it('status: invoiced wins, unknown is open', () => {
    expect(woState({ status: 'work', invoiceId: 'x' })).toBe('inv');
    expect(woState({ status: 'done' })).toBe('done');
    expect(woState({ status: 'zzz' })).toBe('open');
  });
  it('labels and plates', () => {
    expect(vehicleLabel({ plate: 'SK-1234-AB', make: 'VW', model: 'Golf', year: 2008 })).toBe('SK-1234-AB · VW Golf · 2008');
    expect(plateNorm('sk 1234-аб')).toBe('SK1234АБ');
    expect(vehicleProblems({ plate: '' }, [])).toBe('Внесете таблица или VIN.');
    expect(vehicleProblems({ plate: 'sk-1234 ab' }, [{ id: '1', plate: 'SK-1234-AB', make: 'VW' }])).toMatch(/веќе постои/);
    expect(vehicleProblems({ id: '1', plate: 'SK-1234-AB' }, [{ id: '1', plate: 'SK-1234-AB' }])).toBeNull();
  });
  it('invoice lines: parts keep discount, labour in hours on the service konto', () => {
    const L = workOrderInvoiceLines({ parts: [{ itemId: 'i1', name: 'Плочки', qty: 1, price: 2000, disc: 5, rate: 18 }], labour: [{ name: 'Замена плочки', hrs: 1, price: 1000, rate: 18 }] }, () => 'ком', '7410');
    expect(L).toEqual([
      { itemId: 'i1', name: 'Плочки', unit: 'ком', qty: 1, price: 2000, disc: 5, rate: 18, account: null },
      { itemId: null, name: 'Работа: Замена плочки', unit: 'час', qty: 1, price: 1000, disc: 0, rate: 18, account: '7410' },
    ]);
  });
});

const r = (x: number) => Math.round(x * 100) / 100;

describe('parts search (legacy partNums / fitsVeh / delovi)', () => {
  const G = [
    { id: 'a', code: 'F-1', name: 'Филтер масло Mann', oe: '03L 115 562', crossRefs: 'W 719/45', fits: 'VW Golf 5 2004-2008; Škoda Octavia 2 2004-2013' },
    { id: 'b', code: 'F-2', name: 'Филтер масло Bosch', oe: '03L-115-562', fits: 'Audi A4 2008-' },
    { id: 'c', code: 'P-1', name: 'Плочки предни', oe: '1K0698151', fits: 'Mercedes-Benz C 2010-2014' },
  ];
  it('matches part numbers ignoring spaces and dashes', () => {
    expect(partNums(G[0]!)).toEqual(['03L115562', 'W71945']);
    expect(searchParts(G, { q: '03l115562' }).map((x) => x.id)).toEqual(['a', 'b']);
    expect(searchParts(G, { q: 'филтер bosch' }).map((x) => x.id)).toEqual(['b']);
  });
  it('vehicle fit: make aliases, model, year range', () => {
    expect(fitsVehicle(G[0]!.fits, 'Volkswagen', 'Golf', 2006)).toBe(true);
    expect(fitsVehicle(G[0]!.fits, 'VW', 'Golf', 2010)).toBe(false);
    expect(fitsVehicle(G[0]!.fits, 'Skoda', 'Octavia', 2012)).toBe(true);
    expect(fitsVehicle(G[2]!.fits, 'mercedes', '', null)).toBe(true);
    expect(fitsVehicle(G[1]!.fits, 'Audi', 'A4', 2020)).toBe(true);
    expect(searchParts(G, { mk: 'vw', md: 'golf', yr: 2005 }).map((x) => x.id)).toEqual(['a']);
  });
  it('alternatives share a number; field lookup by label, code, number, name', () => {
    expect(partAlternatives(G, G[0]!).map((x) => x.id)).toEqual(['b']);
    const S = G.map((x, i) => ({ ...x, stock: i }));
    expect(findPartItem(S, 'F-1 · Филтер масло Mann')?.id).toBe('a');
    expect(findPartItem(S, 'P-1')?.id).toBe('c');
    expect(findPartItem(S, '03L 115 562')?.id).toBe('b');
    expect(findPartItem(S, 'плочки предни')?.id).toBe('c');
    expect(findPartItem(S, 'xyz')).toBeNull();
  });
});

describe('service reminders (legacy potRows)', () => {
  const cfg = autoConfig({});
  const V = [{ id: 'v1', plate: 'SK-1', make: 'VW', model: 'Golf' }, { id: 'v2', plate: 'SK-2' }, { id: 'v3', plate: 'SK-3', remindAt: '2026-09-20' }];
  const O = [
    { vehicleId: 'v1', date: '2025-01-10', km: 100000, status: 'done' },
    { vehicleId: 'v1', date: '2025-07-10', km: 115000, status: 'done', nextKm: 130000, nextNote: 'Голем сервис' },
    { vehicleId: 'v2', date: '2026-09-01', km: 50000, status: 'done' },
    { vehicleId: 'v2', date: '2026-10-01', km: 51000, status: 'open' },
    { vehicleId: 'v3', date: '2025-01-01', km: 1000, status: 'done' },
  ];
  it('flags by estimated km and by date, hides recently contacted, open orders do not count', () => {
    const R = serviceReminders(V, O, cfg, '2026-01-05');
    // v1: 15 000 km in 181 days → ≈ 129 834 km on 05.01.2026 → within 1 000 km of 130 000 (not yet over)
    expect(R.map((x) => x.v.id)).toEqual(['v1']);
    expect(R[0]!.late).toBe(false);
    expect(serviceReminders(V, O, cfg, '2026-02-01')[0]!.late).toBe(true);
    expect(R[0]!.nKm).toBe(130000);
    const R2 = serviceReminders(V, O, cfg, '2026-10-10');
    expect(R2.map((x) => x.v.id)).toEqual(['v1']);
    expect(serviceReminders(V, O, cfg, '2027-08-20').map((x) => x.v.id)).toEqual(['v1', 'v3', 'v2']);
  });
  it('message and WhatsApp number', () => {
    expect(reminderText(V[0]!, 'Голем сервис', { name: 'Сервис ДОО', phone: '02/111-222' })).toBe('Почитувани, за возилото SK-1 (VW Golf) наскоро е потребен Голем сервис. Закажете термин: 02/111-222 – Сервис ДОО');
    expect(waNumber('070 123 456')).toBe('38970123456');
  });
});

describe('fuel cards (legacy frGRead / frNum / frDate / frTourFuel)', () => {
  const aoa = [['DKV report'], ['Datum', 'Kennzeichen', 'Land', 'Produkt', 'Menge', 'Betrag brutto', 'Währung'], ['05.03.2026', 'SK-1234-AB', 'DE', 'Diesel', '412,50', '1.234,56', 'eur'], ['', '', '', '', '', '', ''], ['2026-03-07', 'sk 1234 ab', 'AT', 'AdBlue', 20, 30, ''], ['bad', 'SK-1', '', '', 1, 0, 'EUR']];
  it('detects header and columns', () => {
    const d = detectFuelColumns(aoa);
    expect(d.hi).toBe(1);
    expect(d.map).toEqual({ d: 0, plate: 1, ctry: 2, prod: 3, qty: 4, amt: 5, cur: 6 });
  });
  it('parses numbers and dates', () => {
    expect(fuelNum('1.234,56')).toBe(1234.56);
    expect(fuelNum('1,234.56')).toBe(1234.56);
    expect(fuelNum('12,5')).toBe(12.5);
    expect(fuelDate('5/3/26')).toBe('2026-03-05');
    expect(fuelDate(46086)).toBe('2026-03-05');
    expect(fuelDate('x')).toBe('');
  });
  it('rows, month table and tour fuel', () => {
    const d = detectFuelColumns(aoa);
    const { rows, error } = fuelRowsFromSheet(aoa.slice(d.hi + 1), d.map, 'MKD');
    expect(error).toBeNull();
    expect(rows).toEqual([
      { d: '2026-03-05', plate: 'SK-1234-AB', ctry: 'DE', prod: 'Diesel', qty: 412.5, amt: 1234.56, cur: 'EUR' },
      { d: '2026-03-07', plate: 'sk 1234 ab', ctry: 'AT', prod: 'AdBlue', qty: 20, amt: 30, cur: 'MKD' },
    ]);
    expect(fuelRowsFromSheet([], {}, 'EUR').error).toMatch(/колоните/);
    const fx = (c: string) => (c === 'EUR' ? 61.5 : 0);
    const m = fuelByPlate([...rows, { d: '2026-03-08', plate: 'SK-9', qty: 1, amt: 10, cur: 'USD' }], '2026-03', fx);
    expect(m.rows[0]).toEqual({ plate: 'SK-1234-AB', l: 432.5, mkd: r(1234.56 * 61.5 + 30), n: 2, by: { EUR: 1234.56, MKD: 30 } });
    expect(m.miss).toEqual(['USD']);
    expect(tourFuel(rows, 'SK 1234 AB', { date: '2026-03-04', unloadDate: '2026-03-05' }, fx)).toEqual({ mkd: r(1234.56 * 61.5), l: 412.5, n: 1 });
    expect(tourFuel(rows, 'SK-1234-AB', { date: '2026-03-04', retDate: '2026-03-09' }, fx).n).toBe(2);
  });
});

describe('vehicles live (legacy pnDist / pnTrackSVG)', () => {
  it('distance and throttle', () => {
    expect(Math.round(geoDistance({ lat: 41.9981, lon: 21.4254 }, { lat: 41.1231, lon: 20.8016 }) / 1000)).toBe(110);
    expect(shouldSendPosition(null, { lat: 1, lon: 1 }, 0)).toBe(true);
    expect(shouldSendPosition({ t: 0, p: { lat: 42, lon: 21 } }, { lat: 42.0001, lon: 21 }, 10000)).toBe(false);
    expect(shouldSendPosition({ t: 0, p: { lat: 42, lon: 21 } }, { lat: 42.0001, lon: 21 }, 41000)).toBe(true);
    expect(shouldSendPosition({ t: 0, p: { lat: 42, lon: 21 } }, { lat: 42.002, lon: 21 }, 1000)).toBe(true);
  });
  it('projects the track inside the box', () => {
    const p = trackProjection([{ lat: 42, lon: 21 }, { lat: 42.1, lon: 21.2 }], [{ lat: 42.05, lon: 21.1, k: 'deliv' }], { lat: 42.1, lon: 21.2 })!;
    for (const q of [...p.line, ...p.marks, p.cur!]) { expect(q.x).toBeGreaterThanOrEqual(20); expect(q.x).toBeLessThanOrEqual(620); expect(q.y).toBeGreaterThanOrEqual(20); expect(q.y).toBeLessThanOrEqual(280); }
    expect(p.line[0]!.y).toBeGreaterThan(p.line[1]!.y);
    expect(trackProjection([], [], null)).toBeNull();
  });
});

describe('module views', () => {
  it('auto service and the new freight views are gated', () => {
    expect(viewEnabled('servis', [], { hasFirm: true, client: true })).toBe(false);
    expect(viewEnabled('servis', [], { hasFirm: true })).toBe(true);
    expect(viewEnabled('delovi', ['auto'], { hasFirm: true, client: true })).toBe(true);
    expect(viewEnabled('frGor', ['pn'], { hasFirm: true, client: true })).toBe(false);
    expect(viewEnabled('frFak', ['frt'], { hasFirm: true, client: true })).toBe(true);
    expect(viewEnabled('pnLive', ['pn'], { hasFirm: true, client: true })).toBe(true);
  });
});
