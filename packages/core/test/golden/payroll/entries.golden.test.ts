import { describe, expect, it } from 'vitest';
import { empCalc, payMatch, payrollEntries2, payTotals, resolvePayScheme, PAY_SCH0, type PayJournalLine } from '../../../src/payroll';
import { EMP_HIGH, MONTH, NORMAL_EMPS, PARAMS } from './fixtures';
import { loadLegacy, plain } from './legacy';

const L = loadLegacy();
const RUN = { month: MONTH, params: PARAMS, emps: NORMAL_EMPS };

const fromLegacy = (lines: { k: string; d: number; p: number; note?: string }[]): PayJournalLine[] =>
  plain(lines).map((l) => ({ account: l.k, debit: l.d, credit: l.p, ...(l.note ? { note: l.note } : {}) }));
const sum = (L: PayJournalLine[], f: 'debit' | 'credit') => Math.round(L.reduce((s, l) => s + l[f], 0) * 100);

const SCHEMES: [string, Record<string, string> | undefined, Record<string, string> | undefined][] = [
  ['defaults', undefined, undefined],
  ['employer-expense split, merged accounts', { pay_eTax: '4212', pay_ePio: '4211', pay_eZdr: '4211', pay_eDop: '4211', pay_eVrab: '4213' }, undefined],
  ['no clearing account, dop/vrab switched off → pay_contrib', { pay_via: '-', pay_dop: '-', pay_vrab: '' }, { pay_vrab: '-' }],
  ['office-wide scheme + firm override', { pay_gross: '4219' }, { pay_net: '2402', pay_tax: '2348', pay_gross: '4218' }],
  ['legacy SCH_OLD values are ignored with the legacy guard', { pay_net: '2400', pay_pio: '2410', pay_gross: '4200' }, undefined],
  ['net on the clearing account', { pay_via: '2409', pay_net: '2409' }, undefined],
];

describe('payrollEntries2 — full payroll month', () => {
  for (const [name, firmSch, gsch] of SCHEMES) {
    it(name, () => {
      L.setState({ firm: { sch: firmSch || {} }, gsch: gsch || {} });
      const legacy = fromLegacy(L.payrollEntries2(RUN));
      const port = payrollEntries2(RUN, resolvePayScheme(firmSch, gsch, { legacyOldGuard: true }));
      expect(port).toEqual(legacy);
      expect(sum(port, 'debit')).toBe(sum(port, 'credit'));
      expect(port.length).toBeGreaterThan(3);
    });
  }

  it('default scheme: contributions, PIT, net, deductions, clearing pair, gross', () => {
    const T = payTotals(NORMAL_EMPS, PARAMS);
    const E = payrollEntries2(RUN);
    const by = (a: string, side: 'debit' | 'credit') => E.filter((l) => l.account === a && l[side]).reduce((s, l) => s + l[side], 0);
    expect(by('2341', 'credit')).toBe(T.pio + T.dPio);
    expect(by('2342', 'credit')).toBe(T.zdr + T.dZdr);
    expect(by('2343', 'credit')).toBe(T.dop + T.dDop);
    expect(by('2344', 'credit')).toBe(T.vrab + T.dVrab);
    expect(by('2340', 'credit')).toBe(T.tax);
    expect(by('2401', 'credit')).toBe(T.net);
    expect(by('2492', 'credit')).toBe(T.ded);
    expect(by('2400', 'credit')).toBe(by('2400', 'debit'));
    expect(by('4210', 'debit')).toBe(by('2400', 'debit'));
  });

  it('FIX: an explicit pay_net = 2400 is honoured (legacy silently posted 2401)', () => {
    L.setState({ firm: { sch: { pay_net: '2400', pay_via: '-' } }, gsch: {} });
    expect(fromLegacy(L.payrollEntries2(RUN)).some((l) => l.account === '2401')).toBe(true);
    const port = payrollEntries2(RUN, resolvePayScheme({ pay_net: '2400', pay_via: '-' }));
    expect(port.some((l) => l.account === '2401')).toBe(false);
    expect(port.find((l) => l.account === '2400' && l.credit)!.credit).toBe(payTotals(NORMAL_EMPS, PARAMS).net);
    expect(sum(port, 'debit')).toBe(sum(port, 'credit'));
  });

  it('FIX: params missing rates are completed from the dated table — every path same source', () => {
    L.setState({ firm: { sch: {} }, gsch: {} });
    const partial = { hours: 176 } as never;
    const port = payrollEntries2({ month: MONTH, params: partial, emps: NORMAL_EMPS });
    expect(port).toEqual(payrollEntries2(RUN));
  });

  it('FIX: month with a high earner — balanced, contributions on the maximum base', () => {
    const run = { month: MONTH, params: PARAMS, emps: [...NORMAL_EMPS, EMP_HIGH] };
    const E = payrollEntries2(run);
    expect(sum(E, 'debit')).toBe(sum(E, 'credit'));
    const hi = empCalc(EMP_HIGH, PARAMS);
    const T = payTotals(NORMAL_EMPS, PARAMS);
    expect(E.find((l) => l.account === '2341')!.credit).toBe(T.pio + T.dPio + Math.round(1106256 * 0.199));
    expect(hi.T.pio).toBe(Math.round(1106256 * 0.199));
    L.setState({ firm: { sch: {} }, gsch: {} });
    const legacy = fromLegacy(L.payrollEntries2(run));
    expect(legacy.find((l) => l.account === '2341')!.credit).toBeGreaterThan(E.find((l) => l.account === '2341')!.credit);
  });
});

describe('resolvePayScheme', () => {
  it('matches legacy sch() with the legacy guard', () => {
    for (const [, firmSch, gsch] of SCHEMES) {
      L.setState({ firm: { sch: firmSch || {} }, gsch: gsch || {} });
      const port = resolvePayScheme(firmSch, gsch, { legacyOldGuard: true });
      for (const k of Object.keys(PAY_SCH0)) expect(port[k as keyof typeof port]).toBe(L.sch(k));
    }
  });
});

describe('payMatch', () => {
  it('matches legacy for net, contributions, PIT, PIO, health and no match', () => {
    const scheme = { pay_dop: '-', pay_vrab: '-' };
    const docs = [
      { id: 'pay-2026-08', v: 2, month: '2026-08', params: PARAMS, emps: NORMAL_EMPS.slice(0, 3) },
      { id: 'pay-2026-09', v: 2, month: MONTH, params: PARAMS, emps: NORMAL_EMPS },
    ];
    L.setState({ firm: { sch: scheme }, gsch: {}, payroll: docs });
    const T = payTotals(NORMAL_EMPS, PARAMS);
    const contr = T.pio + T.dPio + T.zdr + T.dZdr + T.dop + T.dDop + T.vrab + T.dVrab;
    const amounts = [T.net, T.emps[2]!.net, contr + T.tax, contr, T.tax, T.pio + T.dPio, T.zdr + T.dZdr, 12345.67, T.net + 0.5];
    for (const amt of amounts)
      for (const date of [undefined, '2026-10-15', '2026-09-01', '2026-08-20', '2026-07-01']) {
        const port = payMatch(docs, amt, date, resolvePayScheme(scheme, undefined, { legacyOldGuard: true }));
        expect(port).toEqual(plain(L.payMatch(amt, date)) ?? null);
      }
  });
});
