import { describe, expect, it } from 'vitest';
import { PAY_SCH0, resolvePayScheme } from './payroll/entries';
import { mpinFirmOf, mpinLastDay, mpinLinesFor, mpinNorm, mpinNum, mpinReady, mpinWarnings, mpinWhat } from './law/mpin-in';

const READ = {
  isMpin: true, edb: 'MK4030999123456', name: 'ТЕСТ ТРЕЈД ДООЕЛ Скопје', period: '09/2026', status: 'ПРИФАТЕНА', subNo: '123456',
  subDate: '08.10.2026', gross: '165,529.00', pio: '30,957.00', zdr: '12,415.00', dop: '828.00', vrab: '1,986.00', staz: 0,
  tax: '11,486.00', total: '57,672.00', insured: 3, due: '15.10.2026', folio: '0012',
};

describe('МПИН од УЈП – reading (legacy mpinNorm / mpinNum / mpinFirmOf)', () => {
  it('parses amounts in both notations', () => {
    expect(mpinNum('165,529.00')).toBe(165529);
    expect(mpinNum('165.529,50')).toBe(165529.5);
    expect(mpinNum(12.5)).toBe(12.5);
    expect(mpinNum('')).toBe(0);
  });
  it('normalises period, dates, totals, net', () => {
    const M = mpinNorm(READ);
    expect(M.period).toBe('2026-09');
    expect(M.subDate).toBe('2026-10-08');
    expect(M.due).toBe('2026-10-15');
    expect(M.edb).toBe('4030999123456');
    expect(M.gross).toBe(165529);
    expect(M.total).toBe(57672);
    expect(M.diff).toBe(0);
    expect(M.net).toBe(r(165529 - 57672));
  });
  it('v453 wrapper: arrays, {declaration}, isMpin false with data', () => {
    expect(mpinNorm([{ ...READ }]).period).toBe('2026-09');
    expect(mpinNorm({ declaration: READ }).gross).toBe(165529);
    expect(mpinNorm({ ...READ, isMpin: false }).isMpin).toBe(true);
    expect(mpinNorm({ isMpin: false }).isMpin).toBe(false);
    expect(mpinNorm({ period: '2026/9' }).period).toBe('2026-09');
  });
  it('total missing → sum; diff > 1 is a warning', () => {
    const M = mpinNorm({ ...READ, total: '' });
    expect(M.total).toBe(57672);
    const B = mpinNorm({ ...READ, total: '57,700.00' });
    expect(mpinWarnings(B, 'f1')).toEqual(['вкупно ≠ збир (28.00)']);
    expect(mpinWarnings(mpinNorm({ ...READ, status: 'ОДБИЕНА' }), null)).toEqual(['изберете фирма', 'статус: ОДБИЕНА']);
  });
  it('finds the firm by ЕДБ suffix, then by name without the legal form', () => {
    const F = [{ id: 'a', name: 'Друга ДОО', edb: '4030000000001' }, { id: 'b', name: 'Тест Трејд ДООЕЛ', edb: '4030999123456' }, { id: 'c', name: 'АЛФА', edb: null }];
    expect(mpinFirmOf(F, '999123456', '')?.id).toBe('b');
    expect(mpinFirmOf(F, '', 'TEST')).toBeNull();
    expect(mpinFirmOf(F, '', 'ТЕСТ ТРЕЈД ДООЕЛ Скопје')?.id).toBe('b'); // the firm name is contained in the read name
    expect(mpinFirmOf(F, '', 'ТЕСТ ТРЕЈД')?.id).toBe('b');
    expect(mpinFirmOf(F, '12', 'Ал')).toBeNull();
  });
  it('ready = ok + firm + period', () => {
    const M = mpinNorm(READ);
    expect(mpinReady({ stat: 'ok', firmId: 'x', M })).toBe(true);
    expect(mpinReady({ stat: 'ok', firmId: null, M })).toBe(false);
    expect(mpinReady({ stat: 'notm', firmId: 'x', M })).toBe(false);
  });
});

const r = (n: number) => Math.round(n * 100) / 100;

describe('МПИН од УЈП – journal from the declaration (legacy mpinLinesFor)', () => {
  const M = mpinNorm(READ);
  it('default scheme: funds + PIT + net credited, gross debited, via pair, balanced', () => {
    const L = mpinLinesFor(M, { ...PAY_SCH0 });
    const d = r(L.reduce((s, l) => s + l.debit, 0)), c = r(L.reduce((s, l) => s + l.credit, 0));
    expect(d).toBe(c);
    expect(L).toEqual([
      { account: '2341', debit: 0, credit: 30957 },
      { account: '2342', debit: 0, credit: 12415 },
      { account: '2343', debit: 0, credit: 828 },
      { account: '2344', debit: 0, credit: 1986 },
      { account: '2340', debit: 0, credit: 11486 },
      { account: '2401', debit: 0, credit: M.net, note: 'Нето плата за исплата' },
      { account: '2400', debit: 0, credit: 165529, note: 'Бруто плата' },
      { account: '2400', debit: 165529, credit: 0, note: 'Распоред на бруто плата' },
      { account: '4210', debit: 165529, credit: 0 },
    ]);
  });
  it('employer split and pay_contrib fallback; same account merged', () => {
    const S = resolvePayScheme({ pay_via: '-', pay_pio: '-', pay_zdr: '-', pay_eTax: '4201', pay_ePio: '42020' });
    const L = mpinLinesFor(mpinNorm({ ...READ, staz: '100', total: '' }), S);
    expect(L.find((l) => l.account === '2349')!.credit).toBe(r(30957 + 100 + 12415));
    expect(L.find((l) => l.account === '4201')!.debit).toBe(11486);
    expect(L.find((l) => l.account === '42020')!.debit).toBe(31057);
    expect(L.find((l) => l.account === '4210')!.debit).toBe(r(165529 - 11486 - 31057));
    expect(r(L.reduce((s, l) => s + l.debit - l.credit, 0))).toBe(0);
  });
  it('last day of month and plan texts', () => {
    expect(mpinLastDay('2026-02')).toBe('2026-02-28');
    expect(mpinLastDay('2028-02')).toBe('2028-02-29');
    expect(mpinWhat(M, { run: { gross: 165529.4 }, journal: false, old: null, book: true }).text).toMatch(/се совпаѓа/);
    expect(mpinWhat(M, { run: { gross: 100000 }, journal: false, old: null, book: true }).warn).toBe(true);
    expect(mpinWhat(M, { run: null, journal: true, old: null, book: true }).text).toMatch(/ќе се замени/);
    expect(mpinWhat(M, { run: null, journal: false, old: null, book: false }).text).toBe('Само во досие (без налог)');
    expect(mpinWhat(M, { run: null, journal: false, old: { no: '9', date: '2026-10-01' }, book: true }).corr).toMatch(/бр\. 9 од 01\.10\.2026/);
  });
});
