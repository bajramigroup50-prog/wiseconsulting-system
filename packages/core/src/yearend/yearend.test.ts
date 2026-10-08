import { describe, expect, it } from 'vitest';
import {
  carryForwardAccount,
  clearCrmImport,
  closeYearLines,
  computeAnnualAccount,
  computeVp,
  crmImportPatch,
  dbEdb,
  depAccounts,
  depFor,
  nkd21Aop,
  nkd5,
  npoDb,
  parseCrmXml,
  yeBalanceSet,
  yeSumPref,
  YEAR_RESULT_ACCOUNTS,
  zcOpen,
  ZS_DEF,
  zsCompute,
  zsRules,
} from '../yearend';

describe('balances', () => {
  it('sumPref with exclusions', () => {
    const B = yeBalanceSet([
      { account: '7400', debit: 0, credit: 100 },
      { account: '7450', debit: 0, credit: 30 },
      { account: '7300', debit: 0, credit: 5 },
    ]).pre;
    expect(yeSumPref(B, ['73', '74', '!745'], -1)).toBe(105);
  });
});

describe('result accounts (one mapping)', () => {
  it('close posts to 951/961 and carry-forward maps them to 950/960 unconditionally', () => {
    expect(YEAR_RESULT_ACCOUNTS).toMatchObject({ currentProfit: '951', currentLoss: '961', retainedProfit: '950', retainedLoss: '960', taxPayable: '2330' });
    expect(carryForwardAccount('951')).toBe('950');
    expect(carryForwardAccount('9511')).toBe('950');
    expect(carryForwardAccount('961')).toBe('960');
    expect(carryForwardAccount('9500')).toBe('9500');
  });
  it('close journal balances and books tax to 2330', () => {
    const B = yeBalanceSet([
      { account: '7400', debit: 0, credit: 1000.5 },
      { account: '4100', debit: 400.25, credit: 0 },
      { account: '1000', debit: 600.25, credit: 0 },
    ]).pre;
    const C = closeYearLines(B, 60);
    const d = C.lines.reduce((s, l) => s + l.debit, 0);
    const p = C.lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.round(d * 100)).toBe(Math.round(p * 100));
    expect(C).toMatchObject({ profit: 600.25, tax: 60, net: 540.25 });
    expect(C.lines).toContainEqual({ account: '2330', debit: 0, credit: 60 });
    expect(C.lines).toContainEqual({ account: '951', debit: 0, credit: 540.25 });
  });
});

describe('zsCompute', () => {
  it('ZS_FIX is applied to firm rules unless custom', () => {
    const own = ZS_DEF.filter((x) => x.r === 'bs' && x.aop === '001').map((x) => ({ ...x, f: '002' }));
    expect(zsRules(own).find((x) => x.aop === '001' && x.r === 'bs')!.f).toBe('002+009+020+021+031');
    expect(zsRules(own.map((x) => ({ ...x, custom: true }))).find((x) => x.aop === '001' && x.r === 'bs')!.f).toBe('002');
    expect(zsRules(own)).toHaveLength(205);
  });
  it('more than 20 manual amounts (imported XML) are taken as they are, without rounding', () => {
    const manual = Object.fromEntries(ZS_DEF.slice(0, 25).map((x) => [x.r + x.aop, 10.4]));
    const B = yeBalanceSet([{ account: '1000', debit: 0.4, credit: 0 }]);
    const r = zsCompute({ year: 2025, ...B, manual });
    expect(r.V.bu202).toBe(10.4);
    expect(r.V.bs060).toBe(0.4);
  });
  it('months worked from the registration date and from the first posting', () => {
    const B = yeBalanceSet([]);
    expect(zsCompute({ year: 2025, ...B, regDate: '2025-03-12' }).V.bu258).toBe(10);
    expect(zsCompute({ year: 2025, ...B, regDate: '2026-01-01' }).V.bu258).toBe(0);
    expect(zsCompute({ year: 2025, ...B, firstPostingMonth: '2025-07' }).V.bu258).toBe(6);
    expect(zsCompute({ year: 2025, ...B, firstPostingMonth: '2025-07', hasOpening: true }).V.bu258).toBe(12);
  });
  it('F1: provisional tax before close keeps A = P', () => {
    const r = computeAnnualAccount({
      year: 2025,
      tb: [
        { account: '7400', debit: 0, credit: 500_000 },
        { account: '4100', debit: 100_000, credit: 0 },
        { account: '1000', debit: 400_000, credit: 0 },
      ],
    });
    expect(r.db.tax).toBe(40_000);
    expect(r.zs.V).toMatchObject({ bu250: 400_000, bu252: 40_000, bu255: 360_000, bs077: 360_000, bs101: 40_000, bs063: 400_000, bs111: 400_000 });
  });
});

describe('ДБ / ДБ-ВП helpers', () => {
  it('dbEdb', () => {
    expect(dbEdb('4030001234567')).toBe('МК4030001234567');
    expect(dbEdb('MK4030001234567')).toBe('MK4030001234567');
    expect(dbEdb('')).toBe('');
  });
  it('ДБ-ВП legal form detection works for АД (legacy \\b never matched Cyrillic)', () => {
    expect(computeVp({ V: {} }, null, 0, { name: 'Македонски Телеком АД Скопје' }).form).toBe('АД');
    expect(computeVp({ V: {} }, null, 0, { name: 'Пример ДООЕЛ' }).form).toBe('ДООЕЛ');
    expect(computeVp({ V: { bu201: 4_000_000 } }, null, 0, {}).tax).toBe(40_000);
    expect(computeVp({ V: { bu201: 7_000_000 } }, null, 0, {}).elig).toBe(false);
  });
  it('NPO tax: 1% above 1 000 000', () => {
    expect(npoDb(1_250_000)).toEqual({ r01: 0, econ: 1_250_000, red: 1_000_000, base: 250_000, tax: 2_500 });
    expect(npoDb(900_000).tax).toBe(0);
  });
});

describe('depreciation', () => {
  it('starts the month after acquisition and stops at the disposal month', () => {
    const a = { id: 'x', konto: '0120', rate: 12, date: '2025-01-31', cost: 120_000 };
    expect(depFor([a], 2025).rows[0]).toMatchObject({ year: 13_200, acc: 13_200 });
    expect(depFor([{ ...a, disposed: '2025-06-10' }], 2025).rows[0]!.year).toBe(6_000);
    expect(depFor([{ ...a, disposed: '2025-06-10' }], 2026).rows[0]!.year).toBe(0);
    expect(depFor([{ ...a, date: '' }], 2025).rows[0]!.year).toBe(0);
  });
  it('is capped at cost', () => {
    const a = { id: 'x', konto: '0134', rate: 25, date: '2020-01-15', cost: 1000 };
    expect(depFor([a], 2024).rows[0]).toMatchObject({ year: 20.83, acc: 1000 });
    expect(depFor([a], 2025).rows[0]).toMatchObject({ year: 0, acc: 1000 });
  });
  it('maps asset groups to KONTO_SRC depreciation accounts', () => {
    expect(depAccounts('0110')).toEqual({ expense: '4301', accumulated: '0190' });
    expect(depAccounts('0121')).toEqual({ expense: '4301', accumulated: '0192' });
    expect(depAccounts('01360')).toEqual({ expense: '4302', accumulated: '0193' });
    expect(depAccounts('0141')).toEqual({ expense: '4303', accumulated: '0194' });
    expect(depAccounts('0150')).toEqual({ expense: '4303', accumulated: '0195' });
    expect(depAccounts('0030')).toEqual({ expense: '4300', accumulated: '0092' });
  });
});

describe('ЦРМ helpers', () => {
  it('nkd5 / nkd21Aop', () => {
    expect(nkd5('46.9')).toBe('46.900');
    expect(nkd5('4690')).toBe('46.900');
    expect(nkd21Aop('01.11')).toBe(4000);
    expect(nkd21Aop('46.90')).toBe(4382);
    expect(nkd21Aop('xx')).toBeNull();
  });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AnnualAccount xmlns="http://e-submit.crm.com.mk/aaol" Year="2024" Period="2"><Operation ID="450">
<Form ID="35"><AOP ID="4382" Current="1000"/></Form>
<Form ID="36"><AOP ID="063" Current="5000" Previous="4000"/><AOP ID="111" Current="5000"/></Form>
<Form ID="37"><AOP ID="201" Current="9000.4"/></Form>
<Form ID="38"><AOP ID="722" Current="3" Previous="2"/></Form></Operation></AnnualAccount>`;
  it('parseCrmXml', () => {
    const P = parseCrmXml(xml);
    expect(P).toMatchObject({ year: 2024, period: 2, cur: { bs063: 5000, bs111: 5000, bu201: 9000 }, prev: { bs063: 4000 }, d38: { '722': 3 }, d38p: { '722': 2 }, f35: { '4382': 1000 } });
    expect(() => parseCrmXml('<x/>')).toThrow();
    expect(() => parseCrmXml('<AnnualAccount Year="2024"></AnnualAccount>')).toThrow('нема АОП износи');
  });
  it('C1: clearing an import restores the manual amounts it replaced', () => {
    const firm = { zsMan: { 2024: { bs060: 77 } }, deMan: {}, nkd: '46.90' };
    const patch = crmImportPatch(firm, parseCrmXml(xml), ZS_DEF, false);
    expect(patch.zsMan![2024]!.bs063).toBe(5000);
    expect(patch.zsMan![2024]!.bs060).toBe(0);
    expect(patch.zsMan![2023]).toEqual({ bs063: 4000 });
    expect(patch.nkdAop).toEqual({ '46.900': 4382 });
    const after = { ...firm, ...patch };
    const cleared = clearCrmImport(after, 2024);
    expect(cleared.zsMan).toEqual({ 2024: { bs060: 77 } });
    expect(cleared.deMan).toEqual({});
    expect(cleared.crmImp).toEqual({});
  });
});

describe('phase gate', () => {
  it('zcOpen keeps unacknowledged blocking findings', () => {
    const F = [
      { key: 'a', sev: 'block' as const, area: '', txt: '' },
      { key: 'b', sev: 'block' as const, area: '', txt: '' },
      { key: 'c', sev: 'warn' as const, area: '', txt: '' },
    ];
    expect(zcOpen(F, { b: { note: 'ok' } }).map((x) => x.key)).toEqual(['a']);
  });
});
