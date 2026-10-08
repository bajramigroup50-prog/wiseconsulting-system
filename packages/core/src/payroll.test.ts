import { describe, expect, it } from 'vitest';
import {
  assertPayParams,
  decodeCp1251,
  empCalc,
  encodeCp1251,
  mkHolidays,
  monthEnd,
  monthHours,
  monthSplit,
  mpinParse,
  orthEaster,
  PAY_DEF,
  paramsFor,
  payrollEntries2,
  resolvePayParams,
  resolvePayScheme,
  workingDays,
  type PayEmp,
} from './payroll';

const P = resolvePayParams({ hours: 176 }, '2026-09');

describe('payroll params', () => {
  it('2026 rates are PIO 19.9 / health 7.5 / additional 0.5 / unemployment 0.1 / PIT 10', () => {
    for (const r of PAY_DEF) expect([r.pio, r.zdr, r.dop, r.vrab, r.tax]).toEqual([19.9, 7.5, 0.5, 0.1, 10]);
    expect(P).toMatchObject({ pio: 19.9, vrab: 0.1, minGross: 38507, minNet: 26046, maxBase: 1106256, exempt: 10932, hours: 176 });
  });

  it('dated rows: minimum wage changes in March 2026', () => {
    expect(paramsFor('2026-02').minGross).toBe(36037);
    expect(paramsFor('2026-03').minGross).toBe(38507);
    expect(paramsFor('2025-06').from).toBe('2026-01');
  });

  it('explicit values win, missing keys come from the table, overrides apply per call', () => {
    const r = resolvePayParams({ pio: '19.9', exempt: 11000 }, '2026-09', [{ from: '2026-09', avg: 70000 }]);
    expect(r.exempt).toBe(11000);
    expect(r.avg).toBe(70000);
    expect(r.minBase).toBe(34571);
  });

  it('incomplete params are rejected — no silent 18.8 / 1.2 fallback', () => {
    expect(() => assertPayParams({ pio: 19.9 })).toThrow(/avg/);
    const e: PayEmp = { empId: 'x', name: 'X', netBase: 30000, lines: [{ type: 'Редовно работење', hours: 176 }] };
    expect(() => empCalc(e, { ...P, vrab: undefined } as never)).toThrow(/vrab/);
  });
});

describe('payroll calendar', () => {
  it('Orthodox Easter', () => {
    expect(orthEaster(2026).toISOString().slice(0, 10)).toBe('2026-04-12');
    expect(orthEaster(2027).toISOString().slice(0, 10)).toBe('2027-05-02');
  });

  it('2026 holidays incl. Easter Monday, Bajram and the Sunday → Monday shift', () => {
    const d = mkHolidays(2026).map((h) => h.date);
    expect(d).toContain('2026-04-13');
    expect(d).toContain('2026-03-20');
    expect(d).toContain('2026-08-02');
    expect(d).toContain('2026-08-03'); // Илинден on Sunday
    expect(d).toEqual([...d].sort());
  });

  it('working days / hour fund', () => {
    expect(monthHours('2026-09')).toBe(176);
    expect(workingDays('2026-09')).toBe(21); // 8 Sept is a holiday
    expect(monthSplit('2026-09')).toMatchObject({ work: 168, hol: 8 });
    expect(workingDays('2026-09', [{ date: '2026-09-30', n: 'Одлука на Владата' }])).toBe(20);
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });
});

describe('payroll journal', () => {
  const emps: PayEmp[] = [
    { empId: 'a', name: 'A B', netBase: 26046, lines: [{ type: 'Редовно работење', hours: 176 }] },
    { empId: 'b', name: 'C D', netBase: 51234.5, stazY: 4, lines: [{ type: 'Редовно работење', hours: 160 }, { type: 'Прекувремена работа', hours: 7, pct: 135 }, { type: 'Синдикална членарина', amt: 300 }] },
    { empId: 'c', name: 'E F', netBase: 2_000_000, lines: [{ type: 'Редовно работење', hours: 176 }] },
  ];

  it('balances for every scheme variant', () => {
    for (const sch of [undefined, { pay_via: '-' }, { pay_ePio: '4211', pay_eTax: '4212' }, { pay_net: '2400' }]) {
      const L = payrollEntries2({ month: '2026-09', params: P, emps }, resolvePayScheme(sch));
      const d = L.reduce((s, l) => s + Math.round(l.debit * 100), 0);
      const c = L.reduce((s, l) => s + Math.round(l.credit * 100), 0);
      expect(d).toBe(c);
      expect(L.every((l) => typeof l.account === 'string' && l.account.length > 0)).toBe(true);
    }
  });

  it('empty payroll → no lines', () => {
    expect(payrollEntries2({ month: '2026-09', params: P, emps: [] })).toEqual([]);
  });
});

describe('MPIN helpers', () => {
  it('cp1251 Macedonian letters', () => {
    expect([...encodeCp1251('ЃЌЉЊЏЅЈѓќљњџѕјАЯая')]).toEqual([0x81, 0x8d, 0x8a, 0x8c, 0x8f, 0xbd, 0xa3, 0x83, 0x9d, 0x9a, 0x9c, 0x9f, 0xbe, 0xbc, 0xc0, 0xdf, 0xe0, 0xff]);
    expect(decodeCp1251(encodeCp1251('Плата МПИН №5'))).toBe('Плата МПИН №5');
    expect(encodeCp1251('漢')[0]).toBe(0x3f);
  });

  it('mpinParse reads header lines, employees, default codes and version', () => {
    const row = ['1', '0101990455001', 'ПЕТРОВСКА', 'АНА', '001', '4061', '179', ...Array(19).fill(''), '0050', ...Array(15).fill(''), '1', '', '', '300000000000123', ''];
    const t = mpinParse(['a;b', '09;2026;101;110;1;100.00;', '4030000000001;x', row.join(';'), '****', '101;110;1;100.00;', '1.0.1.2', ''].join('\r\n'));
    expect(t.l1[2]).toBe('101');
    expect(t.edb).toBe('4030000000001');
    expect(t.emp['0101990455001']).toMatchObject({ c2: 'ПЕТРОВСКА', c5: '4061', c6: '179', c26: '0050', c42: '1', bank: '300000000000123' });
    expect(t.def).toEqual(['001', '4061', '179', '0050', '1']);
    expect(t.ver).toBe('1.0.1.2');
  });
});
