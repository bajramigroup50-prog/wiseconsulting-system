import { describe, expect, it } from 'vitest';
import {
  empCalc,
  grossFromNet,
  g4n,
  HTYPES,
  mpinRows,
  PAY_DEF,
  paramsFor,
  payCatOf,
  payDraft,
  payRows,
  payTotals,
  PCAT,
  PSIF0,
  psifCodes,
  PXTRA,
  resolvePayParams,
  stazFor,
  type EmpCalc,
  type PayEmp,
} from '../../../src/payroll';
import { EMP_HIGH, EMPLOYEES, MONTH, NORMAL_EMPS, PARAMS } from './fixtures';
import { loadLegacy, plain } from './legacy';

const L = loadLegacy();

const portCalc = (e: PayEmp) => {
  const { capK, ...rest } = empCalc(e, PARAMS) as EmpCalc;
  expect(capK).toBe(1);
  return rest;
};
const legacyCalc = (e: PayEmp) => {
  const r = plain(L.empCalc(e, PARAMS));
  return { ...r, raised: !!r.raised };
};

describe('payroll constants match legacy', () => {
  it('PAY_DEF 2026 rows', () => {
    expect(PAY_DEF).toEqual(plain(L.PAY_DEF));
  });
  it('PSIF0 line codes', () => {
    expect(PSIF0.map((r) => [r.code, r.name, r.cat, r.pct, r.payer, r.mpin, r.basis])).toEqual(plain(L.PSIF0));
    expect(psifCodes()).toEqual(plain(L.PSIF()));
  });
  it('HTYPES / PCAT / PXTRA / catOf', () => {
    expect(HTYPES).toEqual(plain(L.HTYPES));
    expect(PCAT).toEqual(plain(L.PCAT));
    expect(PXTRA).toEqual(plain(L.PXTRA));
    for (const t of [...HTYPES.map((h) => h[0]), ...PXTRA.map((x) => x[0]), 'Нешто друго', '', 'Боледување над 30 дена']) expect(payCatOf(t)).toBe(L.catOf(t));
  });
  it('payRows / paramsFor with overrides', () => {
    const U = [{ from: '2026-03', minGross: 40000 }, { from: '2027-01', avg: 72000, minBase: 36000, maxBase: 1152000 }];
    L.setState({ payUser: U });
    expect(payRows(U)).toEqual(plain(L.payRows()));
    for (const m of ['2025-12', '2026-01', '2026-02', '2026-03', '2026-08', '2027-01', '2027-05']) expect(paramsFor(m, U)).toEqual(plain(L.paramsFor(m)));
    L.setState({ payUser: [] });
  });
});

describe('grossFromNet', () => {
  it('matches legacy for nets below the maximum base', () => {
    for (const net of [0, 1000, 9000, 10932, 15000, 24445, 26046, 30000, 42500, 55555.55, 100000, 250000, 700000]) {
      for (const E of [0, 10932, 5466]) expect(grossFromNet(net, E, PARAMS)).toBe(L.grossFromNet(net, E, PARAMS));
    }
    expect(g4n(26046, PARAMS, 10932)).toBe(38507);
    expect(g4n(30000, PARAMS, 10932)).toBe(L.g4n(30000, PARAMS, 10932));
  });

  it('FIX: above the maximum base the contributions are capped', () => {
    const net = 900000;
    const legacy = L.grossFromNet(net, 10932, PARAMS);
    const port = grossFromNet(net, 10932, PARAMS);
    // legacy: contributions on the whole gross; capped: (net − t·E)/(1 − t) + c·maxBase
    expect(legacy).toBe(Math.ceil((900000 - 0.1 * 10932) / (0.72 * 0.9) - 1e-9));
    expect(port).toBe(Math.ceil((900000 - 0.1 * 10932) / 0.9 + 0.28 * 1106256 - 1e-9));
    expect(port).toBeLessThan(legacy);
  });
});

describe('empCalc — golden per employee', () => {
  for (const e of NORMAL_EMPS) {
    it(`${e.no} ${e.name}`, () => {
      expect(portCalc(e)).toEqual(legacyCalc(e));
    });
  }

  it('minimum wage → exactly the statutory minimum gross', () => {
    const c = portCalc(NORMAL_EMPS[0]!);
    expect(c.Gf).toBe(38507);
    expect(c.T.net).toBe(26046);
  });

  it('part-time by coefficient → pro-rated minimum gross', () => {
    const c = portCalc(NORMAL_EMPS.find((e) => e.empId === 'e5')!);
    expect(c.Gf).toBe(Math.round(38507 * 0.5));
  });

  it('top-up to the minimum base is charged to the employer (dPio…)', () => {
    const c = portCalc(NORMAL_EMPS.find((e) => e.empId === 'e7')!);
    expect(c.T.dopl).toBeGreaterThan(0);
  });

  it('FIX: high wage — contributions capped at the maximum base, net still the agreed net', () => {
    const port = empCalc(EMP_HIGH, PARAMS);
    const legacy = plain(L.empCalc(EMP_HIGH, PARAMS));
    expect(port.capK).toBeLessThan(1);
    // legacy charged contributions on the full gross:
    expect(legacy.T.pio).toBe(Math.round(legacy.T.gross * 0.199));
    // port: on the maximum base (one line → exact)
    expect(port.T.pio).toBe(Math.round(1106256 * 0.199));
    expect(port.T.zdr).toBe(Math.round(1106256 * 0.075));
    expect(port.T.dop).toBe(Math.round(1106256 * 0.005));
    expect(port.T.vrab).toBe(Math.round(1106256 * 0.001));
    // gross-from-net with the cap: with 10 % seniority (20 y × 0.5) the net is the agreed net × ~1.1
    const noStaz = empCalc({ ...EMP_HIGH, stazY: 0 }, PARAMS);
    expect(Math.abs(noStaz.T.net - 900000)).toBeLessThanOrEqual(1);
    expect(Math.abs(port.T.net - (port.T.gross - port.T.contr - port.T.tax))).toBeLessThanOrEqual(1);
  });

  it('FIX: params missing PIO / вработување use the dated table (19.9 / 0.1), not 18.8 / 1.2', () => {
    const partial = { ...PARAMS } as Record<string, unknown>;
    delete partial.pio;
    delete partial.vrab;
    const e = NORMAL_EMPS[2]!;
    const legacy = plain(L.empCalc(e, partial));
    expect(() => empCalc(e, partial as never)).toThrow(/pio, vrab|pio/);
    const port = empCalc(e, resolvePayParams(partial, MONTH));
    const full = legacyCalc(e);
    expect(port.T.pio).toBe(full.T.pio); // 19.9 %
    expect(port.T.vrab).toBe(full.T.vrab); // 0.1 %
    expect(legacy.T.pio).not.toBe(port.T.pio); // legacy fell back to 18.8 %
    expect(legacy.T.pio).toBe(legacy.rows.reduce((s: number, r: { gr: number }) => s + Math.round(r.gr * 0.188), 0));
  });
});

describe('payTotals / mpinRows / stazFor / payDraft', () => {
  it('payTotals matches legacy', () => {
    const p = { month: MONTH, params: PARAMS, emps: NORMAL_EMPS };
    const legacy = plain(L.payTotals(p));
    const { ded, ...port } = plain(payTotals(NORMAL_EMPS, PARAMS)); // `ded` is an addition of the port
    expect(port).toEqual(legacy);
    expect(ded).toBe(Math.round(425) + Math.round(3000.4));
  });

  it('mpinRows matches legacy', () => {
    L.setState({ employees: EMPLOYEES });
    const legacy = plain(L.mpinRows({ month: MONTH, params: PARAMS, emps: NORMAL_EMPS }));
    expect(mpinRows(NORMAL_EMPS, PARAMS, EMPLOYEES)).toEqual(legacy);
  });

  it('FIX: mpinRows base for a high earner is capped at maxBase', () => {
    const [r] = mpinRows([EMP_HIGH], PARAMS, EMPLOYEES);
    expect(r!.base).toBe(1106256);
  });

  it('stazFor matches legacy', () => {
    for (const e of [...EMPLOYEES, { start: '2020-09-30', stazPrev: 3 }, { start: '2020-10-01' }, { stazY: 7 }])
      for (const m of ['2026-01', '2026-09', '2026-10', '2030-02']) expect(stazFor(e, m)).toBe(L.stazFor(e, m));
  });

  it('payDraft (incl. v486 part-time wrapper) matches legacy', () => {
    L.setState({ employees: EMPLOYEES, payroll: [] });
    for (const m of ['2026-01', '2026-05', MONTH, '2026-12']) {
      const { kind, ...legacy } = plain(L.payDraft(m));
      expect(kind).toBe('payroll2');
      expect(payDraft(m, EMPLOYEES)).toEqual(legacy);
    }
  });
});
