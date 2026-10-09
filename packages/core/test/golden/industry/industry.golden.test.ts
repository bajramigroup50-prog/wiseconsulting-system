/**
 * Golden tests for the Phase 10 industry helpers against legacy/index.html: hotel stay and tourist tax (`htCalc`),
 * rent-a-car days / season / rent / extras (`rcCalc` + the `pDay` patch), construction situations (`sitCalc`),
 * travel-arrangement result (`taCalc`), appointment clashes (`aptClash`), travel-order load and per diem
 * (`pnLoad`, `pnDnev`) and freight per diems abroad (`frSegAuto`, `frDnev`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  apptClash, arrangementResult, frPerDiems, htCalc, hotelConfig, rcCalc, rentConfig, situationCalc, travelConfig, travelLoad, travelPerDiem,
  type Arrangement, type Booking, type FreightSegment, type TravelStop,
} from '../../../src/industry';

const SRC = readFileSync(fileURLToPath(new URL('../../../../../legacy/index.html', import.meta.url)), 'utf8').split('\n');
const PARTS: [number, number, string][] = [
  [3267, 3268, 'const r2='],
  [9245, 9246, 'function pnKgOf('],
  [9248, 9249, 'function pnDur('],
  [9492, 9497, 'const bzPad='],
  [9511, 9511, 'const HT='],
  [9515, 9517, 'const htNights='],
  [9749, 9749, 'const RC='],
  [9754, 9761, 'const rcDT='],
  [10047, 10049, 'const boqVal='],
  [10113, 10113, 'const tMin='],
  [10116, 10116, 'function aptClash('],
  [11660, 11661, 'const _rcCalc0='],
  [11846, 11846, 'const TU='],
  [11848, 11848, "const TA_OWN="],
  [11850, 11857, 'const tbTot='],
  [14450, 14450, 'function frRate('],
  [14458, 14465, 'const frUnitsH='],
];
const FR_CTRY = "const FR_CTRY=[['AT','Австрија',94,'EUR'],['DE','Германија',87,'EUR'],['RS','Србија',48,'EUR'],['CH','Швајцарија',130,'CHF']];";

function legacy(st: Record<string, unknown>) {
  const code = PARTS.map(([a, b, start]) => {
    const t = SRC.slice(a - 1, b).join('\n');
    if (!t.startsWith(start)) throw new Error(`legacy/index.html drifted: line ${a} should start with "${start}"`);
    return t;
  }).join('\n');
  const ctx: Record<string, any> = { ...st, fq: (n: number) => String(n), sch: () => '2220', today: () => '2026-07-01' };
  vm.createContext(ctx);
  vm.runInContext(`${FR_CTRY}\n${code}\nObject.assign(globalThis,{htCalc,rcCalc,sitCalc,taCalc,aptClash,pnLoad,pnDnev,frSegAuto,frDnev});`, ctx);
  return ctx;
}

describe('hotel', () => {
  const hot = { tax: 50, freeAge: 7, halfAge: 12, rate: 5 };
  const L = legacy({ firm: () => ({ hot }) });
  const C = hotelConfig(hot);
  const cases = [
    { from: '2026-07-01', to: '2026-07-05', price: 3200, adults: 2, children: 1, guests: [], charges: [], advance: 1000 },
    { from: '2026-07-01', to: '2026-07-04', price: 2950.5, adults: 2, children: 2, charges: [{ date: '2026-07-02', name: 'Вечера', qty: 3, price: 650, rate: 10 }],
      guests: [{ name: 'A', birth: '1980-02-02' }, { name: 'B', birth: '2020-07-02' }, { name: 'C', birth: '2015-06-30' }, { name: 'D', birth: '2014-07-01' }] },
    { from: '2026-07-10', to: '2026-07-11', price: 4000, adults: 1, children: 0, noTax: true, guests: [], charges: [] },
  ];
  it('htCalc matches', () => {
    for (const r of cases) {
      const a = htCalc(r, C), b = L.htCalc(r);
      expect({ ...a, tu: { ...a.tu } }).toEqual(JSON.parse(JSON.stringify(b)));
    }
  });
});

describe('rent-a-car', () => {
  const rent = { grace: 2, sPct: 20, sFrom: '07-01', sTo: '07-10', fuel8: 500 };
  const veh = { id: 'v1', rDay: 2500, rWeek: 2100, rKm: 200, rKmX: 12 };
  const L = legacy({ firm: () => ({ rent }), S: { data: { assets: [veh] } } });
  const C = rentConfig(rent);
  const cases = [
    { veh: 'v1', from: '2026-06-28T09:00', to: '2026-07-03T10:30', out: { km: 1000, fuel: 8 }, ret: { km: 2400, fuel: 5, at: '2026-07-03T12:00' }, extras: [{ name: 'Детско седиште', qty: 5, price: 200 }] },
    { veh: 'v1', from: '2026-07-05T09:00', to: '2026-07-14T09:00', out: { km: '', fuel: 8 }, ret: { km: '', fuel: '' }, extras: [] },
    { veh: 'v1', from: '2026-08-01T09:00', to: '2026-08-03T08:00', pDay: 1800, out: { km: 10, fuel: 8 }, ret: { km: 300, fuel: 8, at: '2026-08-03T11:30' }, extras: [] },
  ];
  it('rcCalc matches (days, season, weekly price, km, fuel, agreed price)', () => {
    for (const r of cases) {
      const a = rcCalc(r as never, veh, C), b = L.rcCalc(r);
      expect([a.days, a.rent, a.km, a.allow, a.xKm, a.fuelD, a.exT, a.tot]).toEqual([b.days, b.rent, b.km, b.allow, b.xKm, b.fuelD, b.exT, b.tot]);
    }
  });
});

describe('construction situations', () => {
  const boq = [{ pos: '1', desc: 'Ископ', unit: 'м3', qty: 100, price: 450 }, { pos: '2', desc: 'Бетон', unit: 'м3', qty: 40.5, price: 6200 }, { pos: '3', desc: 'Арматура', unit: 'кг', qty: 3000, price: 72.35 }];
  const sits = [
    { id: 's1', proj: 'p', no: '1', date: '2026-03-31', cum: { 0: 60, 1: 10 } },
    { id: 's2', proj: 'p', no: '2', date: '2026-04-30', cum: { 0: 100, 1: 25.25, 2: 1200 } },
    { id: 's3', proj: 'p', no: '3', date: '2026-05-31', cum: { 0: 104, 1: 40.5, 2: 2999.5 } },
  ];
  const L = legacy({ csits: () => sits });
  it('sitCalc matches for every situation and a new one', () => {
    const P = { id: 'p', boq };
    for (const s of [...sits, { proj: 'p', no: '4', date: '2026-06-30', cum: { 0: 104, 1: 41, 2: 3000 } }]) {
      const a = situationCalc(boq, sits, s), b = L.sitCalc(P, s);
      expect([a.cur, a.cum, a.pct, a.L.map((l) => [l.c, l.p, l.d, l.amt])]).toEqual([b.cur, b.cum, b.pct, b.L.map((l: any) => [l.c, l.p, l.d, l.amt])]);
    }
  });
});

describe('travel arrangement result', () => {
  const own: Arrangement & { id: string } = { id: 'A', kind: 'own', price: 25000, priceCh: 18000, seats: 40, costs: [
    { cat: 'Сместување (хотел)', amt: 9000, cur: 'EUR', fx: 61.5 }, { cat: 'Превоз (автобус)', amt: 120000 }, { cat: 'Сопствена услуга на агенцијата (не е претходна)', amt: 15000 },
    { cat: 'Водич', purchaseId: 'p1' },
  ] };
  const agent: Arrangement = { id: 'B', kind: 'agent', price: 40000, comm: 12, costs: [] };
  const books: (Booking & { arr: string })[] = [
    { arr: 'A', adults: 2, children: 1, extra: 1500, disc: 500, pays: [{ date: '2026-05-01', amt: 20000, how: 'cash' }] },
    { arr: 'A', adults: 1, children: 0, priceTot: 23000, pax: [{ name: 'X' }, { name: 'Y' }] },
    { arr: 'B', adults: 3, children: 0 },
  ];
  const purchases = [{ id: 'p1', tot: 23600 }];
  const L = legacy({
    firm: () => ({ ddv: true }), tarrs: () => [own, agent], tbooks: (id: string) => books.filter((b) => b.arr === id),
    S: { data: { purchases: purchases.map((p) => ({ ...p, tarr: '' })) } }, purTotal: (p: { tot: number }) => p.tot,
  });
  // legacy taCost reads `c.pid`
  for (const c of own.costs) if (c.purchaseId) (c as { pid?: string }).pid = c.purchaseId;
  it('taCalc matches for own and intermediary arrangements', () => {
    for (const A of [own, agent]) {
      const a = arrangementResult(A, books.filter((b) => b.arr === A.id), (id) => purchases.find((p) => p.id === id)?.tot, travelConfig({}), true);
      const b = L.taCalc(A);
      expect([a.rev, a.paid, a.pax, a.cost, a.margin, a.vat, a.net, a.fill]).toEqual([b.rev, b.paid, b.pax, b.cost, b.margin, b.vat, b.net, b.fill]);
    }
  });
});

describe('appointments', () => {
  const L0 = [{ id: '1', date: '2026-07-01', time: '09:00', dur: 45, res: 'r1' }, { id: '2', date: '2026-07-01', time: '10:30', dur: 30, res: 'r1' }];
  const L = legacy({ appts: () => L0 });
  it('aptClash matches', () => {
    for (const t of ['08:30', '08:15', '09:30', '09:45', '10:00', '10:15', '10:59', '11:00']) {
      for (const dur of [15, 30, 60]) {
        const a = { date: '2026-07-01', time: t, dur, res: 'r1' };
        expect(apptClash(L0, a)?.id ?? null, `${t} ${dur}`).toBe(L.aptClash(a)?.id ?? null);
      }
    }
  });
});

describe('transport', () => {
  const W: Record<string, number> = { a: 25, b: 0.5 };
  const L = legacy({ item: (id: string) => ({ weight: W[id] }), firm: () => ({ pnDef: { dnevAmt: 900 } }), frCfg: () => ({ rates: { RS: [55, 'EUR'] } }), getFx: (c: string) => (c === 'EUR' ? 61.5 : c === 'CHF' ? 65.2 : 0) });
  it('pnLoad matches', () => {
    const stops: TravelStop[] = [
      { kind: 'pick', doc: 'В1', partner: 'Д', goods: [{ itemId: 'a', name: 'А', qty: 40 }], status: 'open' },
      { kind: 'deliv', doc: 'Ф1', partner: 'К', goods: [{ itemId: 'a', name: 'А', qty: 10 }, { itemId: 'b', name: 'Б', qty: 300 }, { name: 'X', qty: 2, kg: 0 }], status: 'open' },
      { kind: 'deliv', doc: 'Ф2', partner: 'К2', goods: [{ itemId: 'a', name: 'А', qty: 30 }], status: 'open' },
    ];
    const legacyStops = stops.map((s) => ({ ...s, goods: s.goods.map((g) => ({ ...g, item: g.itemId })) }));
    const a = travelLoad(stops, (g) => (W[g.itemId ?? ''] || num(g.kg)) * num(g.qty));
    expect(a).toEqual(JSON.parse(JSON.stringify(L.pnLoad({ stops: legacyStops }))));
  });
  it('pnDnev matches', () => {
    for (const ret of ['2026-07-01T15:00:00Z', '2026-07-01T17:30:00Z', '2026-07-01T21:00:00Z', '2026-07-02T01:00:00Z']) {
      const x = { dnev: true, events: [{ k: 'dep' as const, txt: '', at: '2026-07-01T09:00:00Z' }, { k: 'ret' as const, txt: '', at: ret }] };
      expect(travelPerDiem(x, { dnevAmt: 900 })).toEqual(L.pnDnev(x));
    }
  });
  it('frDnev matches (automatic split, manual units, reduction, overrides)', () => {
    const tours: { red: number; segs: FreightSegment[] }[] = [
      { red: 100, segs: [{ c: 'RS', in: '2026-07-01T06:00', out: '2026-07-01T20:00' }, { c: 'AT', in: '2026-07-01T20:00', out: '2026-07-03T09:00' }, { c: 'DE', in: '2026-07-03T09:00', out: '2026-07-05T23:00' }] },
      { red: 50, segs: [{ c: 'CH', in: '2026-07-01T06:00', out: '2026-07-02T03:00' }, { c: 'DE', in: '2026-07-02T03:00', out: '2026-07-02T13:00', units: 1 }] },
    ];
    for (const t of tours) {
      const a = frPerDiems(t, (c) => (c === 'EUR' ? 61.5 : c === 'CHF' ? 65.2 : 0), { RS: [55, 'EUR'] });
      const b = L.frDnev(t);
      expect([a.mkd, a.totH, a.totU, a.by, a.rows.map((r) => [r.u, r.v, r.m])]).toEqual([b.mkd, b.totH, b.totU, { ...b.by }, b.rows.map((r: any) => [r.u, r.v, r.m])]);
    }
  });
});

const num = (v: unknown) => Number(v) || 0;
