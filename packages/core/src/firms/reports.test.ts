import { describe, expect, it } from 'vitest';
import { agingByPartner, ageBucket, bankRecon, liabilitiesByMonth, monthlyControl, pnlByMonth } from './reports';

describe('Усогласување банка', () => {
  it('statement closing vs ledger per month; breaks between statements', () => {
    const [R] = bankRecon([{ id: 'a', name: 'Халк', konto: '100005' }],
      [{ acct: 'a', date: '2026-01-10', number: '1', opening: 0, closing: 500 }, { acct: 'a', date: '2026-02-05', number: '2', opening: 500, closing: 300 }, { acct: 'a', date: '2026-03-01', number: '4', opening: 250, closing: 250 }],
      [{ account: '100005', month: 1, debit: 500, credit: 0 }, { account: '100005', month: 2, debit: 0, credit: 200 }, { account: '100005', month: 3, debit: 0, credit: 50 }], 2026);
    expect(R!.months.slice(0, 4).map((m) => [m.izv, m.book, m.diff])).toEqual([[500, 500, 0], [300, 300, 0], [250, 250, 0], [250, 250, 0]]);
    expect(R!.breaks).toEqual([{ date: '2026-03-01', number: '4', diff: -50 }]);
    expect(R!.last).toBe('2026-03-01');
  });
});

describe('Контролен извештај', () => {
  it('missing statements, negative bank, 2349, missing payroll months; cash in plus is fine', () => {
    const C = monthlyControl({
      today: '2026-10-31', year: 2026, banks: [{ name: 'Халк', konto: '100005', last: '2026-06-18' }],
      draftStatements: 0, openBankLines: 2, draftDocs: 0,
      saldo: new Map([['100005', -100], ['2349', 32398], ['1020', 50]]), payrollMonths: new Set([1, 2, 3, 5, 6, 7, 8, 9]),
    });
    expect(C.filter((c) => c.lvl === 'bad').map((c) => c.cat)).toEqual(['Банка', 'Банка', 'Плати']);
    expect(C.find((c) => c.cat === 'Плати' && c.lvl === 'bad')!.txt).toContain('04/2026');
    expect(C.some((c) => c.txt.includes('2349'))).toBe(true);
    expect(C.some((c) => c.txt.includes('1020'))).toBe(false);
  });
});

describe('Старосна структура', () => {
  it('buckets by days overdue, per partner, biggest debt first', () => {
    expect([0, -5, 1, 30, 31, 60, 61, 90, 91].map(ageBucket)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    const A = agingByPartner([
      { partnerId: 'A', date: '2026-01-10', due: '2026-01-20', total: 100000, paid: 0 }, // 1000, 102 days late on 02.05
      { partnerId: 'A', date: '2026-04-20', due: '2026-05-10', total: 50000, paid: 20000 }, // 300 in time
      { partnerId: 'B', date: '2026-04-01', due: null, total: 20000, paid: 0 }, // 200, 31 days (no due → date)
      { partnerId: 'B', date: '2026-03-01', due: '2026-03-10', total: 10000, paid: 10000 }, // paid – out
    ], '2026-05-02');
    expect(A.rows.map((r) => [r.partnerId, r.b, r.total, r.docs])).toEqual([['A', [300, 0, 0, 0, 1000], 1300, 2], ['B', [0, 0, 200, 0, 0], 200, 1]]);
    expect([A.tot, A.total]).toEqual([[300, 0, 200, 0, 1000], 1500]);
  });
});

describe('Обврски кон УЈП и фондови', () => {
  it('пресметано / платено / салдо per konto and month; analytics under their konto; idle kontos left out', () => {
    const R = liabilitiesByMonth([
      { account: '2340', month: 1, debit: 0, credit: 1502 }, { account: '2340', month: 2, debit: 1502, credit: 1502 },
      { account: '23410', month: 1, debit: 0, credit: 6775 }, { account: '2341', month: 2, debit: 6775, credit: 0 },
    ]);
    expect(R.map((r) => r.k)).toEqual(['2340', '2341']);
    expect(R[0]!.saldo.slice(0, 3)).toEqual([1502, 1502, 1502]);
    expect([R[1]!.calcY, R[1]!.paidY, R[1]!.saldo[11]]).toEqual([6775, 6775, 0]);
  });
});

describe('Биланс на успех по месеци', () => {
  it('приходи, расходи по групи и резултат per month, the year and the year before', () => {
    const P = pnlByMonth(
      [{ account: '7414', month: 1, debit: 0, credit: 1000 }, { account: '4210', month: 1, debit: 400, credit: 0 }, { account: '4410', month: 2, debit: 100, credit: 0 }, { account: '1200', month: 1, debit: 1000, credit: 0 }],
      [{ account: '7400', month: 3, debit: 0, credit: 500 }],
    );
    const by = Object.fromEntries(P.map((l) => [l.key, l]));
    expect(by.rev!.m.slice(0, 2)).toEqual([1000, 0]);
    expect([by.e42!.y, by.e44!.y, by.exp!.y]).toEqual([400, 100, 500]);
    expect(by.res!.m.slice(0, 2)).toEqual([600, -100]);
    expect([by.res!.y, by.res!.py, by.rev!.py]).toEqual([500, 500, 500]);
  });
});
