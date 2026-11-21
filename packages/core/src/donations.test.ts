import { describe, expect, it } from 'vitest';
import { npoCompute } from './yearend/npo';
import { yeBalanceSet } from './yearend/balances';
import { donAssetKonto, donChart, donEntries, donKonto, donKontoKind, donMovesFromBank, donTotals, nextDonNo } from './donations';

describe('donations & sponsorships', () => {
  it('default kontos: recipient on the company / NPO chart, donor', () => {
    expect(donKonto('donation', 'received')).toBe('7673');
    expect(donKonto('donation', 'received', 'co', true)).toBe('7672');
    expect(donKonto('sponsorship', 'received')).toBe('7694');
    expect(donKonto('sponsorship', 'received', 'npo')).toBe('731');
    expect(donKonto('donation', 'given')).toBe('4433');
    expect(donKonto('sponsorship', 'given')).toBe('4430');
  });
  it('NPO chart only for a non-profit whose chart has 730', () => {
    expect(donChart(true, { '100': {}, '730': {}, '731': {} })).toBe('npo');
    expect(donChart(true, { '1000': {}, '7673': {} })).toBe('co');
    expect(donChart(false, { '730': {} })).toBe('co');
    expect(donChart(true, null)).toBe('co');
  });
  it('NPO chart: the NPO as donor books 450, in-kind goods 310, money through 100', () => {
    expect(donKonto('donation', 'given', 'npo')).toBe('450');
    expect(donKonto('sponsorship', 'given', 'npo')).toBe('450');
    expect(donAssetKonto('received', 'npo')).toBe('310');
    expect(donAssetKonto('given', 'npo')).toBe('310');
    expect(donAssetKonto('received')).toBe('3100');
    expect(donAssetKonto('given')).toBe('6600');
    expect(donKontoKind('451', 'npo')).toEqual({ role: 'given', kind: 'donation' });
    expect(donKontoKind('450')).toBeNull();
    expect(donMovesFromBank([{ id: 'x', date: '2026-03-01', amount: -2000, desc: 'помош', konto: '450' }], 'npo').map((m) => m.role)).toEqual(['given']);
    expect(donEntries({ kind: 'donation', role: 'received', amount: 10, inKind: true, konto: '731', chart: 'npo' })).toMatchObject([{ account: '310', debit: 10 }, { account: '731', credit: 10 }]);
    expect(donEntries({ kind: 'donation', role: 'received', amount: 10, inKind: false, konto: '731', chart: 'npo' })[0]!.account).toBe('100');
  });
  it('numbering n/yyyy per year', () => {
    expect(nextDonNo([], '2026')).toBe('1/2026');
    expect(nextDonNo([{ no: '3/2026', date: '2026-03-01' }, { no: '9/2025', date: '2025-12-01' }, { no: 'П-4/2026', date: '2026-05-01' }], '2026')).toBe('5/2026');
  });
  it('statement lines that are donations: by konto or text, direction by sign', () => {
    const M = donMovesFromBank([
      { id: 'a', date: '2026-02-01', amount: 50000, desc: 'донација за спортска опрема', partnerId: 'p1' },
      { id: 'b', date: '2026-02-02', amount: -12000, desc: 'спонзорство турнир', konto: null },
      { id: 'c', date: '2026-02-03', amount: 3000, desc: 'плаќање фактура 12', konto: '1200' },
      { id: 'd', date: '2026-02-04', amount: 8000, desc: 'уплата', konto: '7694' },
      { id: 'e', date: '2026-02-05', amount: -8000, desc: 'уплата', konto: '7673' },
    ]);
    expect(M.map((m) => [m.id, m.role, m.kind, m.amt])).toEqual([
      ['a', 'received', 'donation', 50000], ['b', 'given', 'sponsorship', 12000], ['d', 'received', 'sponsorship', 8000],
    ]);
    expect(donKontoKind('44330')).toEqual({ role: 'given', kind: 'donation' });
    expect(donKontoKind('4431')).toEqual({ role: 'given', kind: 'sponsorship' });
  });
  it('booking proposal is balanced on both sides', () => {
    const R = donEntries({ kind: 'donation', role: 'received', amount: 1000, inKind: false, konto: '7673', bankKonto: '100005' });
    expect(R).toMatchObject([{ account: '100005', debit: 1000 }, { account: '7673', credit: 1000, partner: true }]);
    const G = donEntries({ kind: 'donation', role: 'given', amount: 500.555, inKind: true, konto: '4433', assetKonto: '6600' });
    expect(G).toMatchObject([{ account: '4433', debit: 500.56 }, { account: '6600', credit: 500.56 }]);
  });
  it('totals per donor and year', () => {
    const T = donTotals([
      { id: '1', kind: 'donation', role: 'received', partnerId: 'p1', partnerName: 'A', date: '2026-01-05', amount: 100, realized: 100 },
      { id: '2', kind: 'sponsorship', role: 'received', partnerId: 'p1', partnerName: 'A', date: '2026-04-05', amount: 50, realized: 0 },
      { id: '3', kind: 'donation', role: 'received', partnerId: 'p1', partnerName: 'A', date: '2025-04-05', amount: 70 },
      { id: '4', kind: 'donation', role: 'received', partnerId: 'p2', partnerName: 'B', date: '2026-04-05', amount: 500 },
    ]);
    expect(T.map((t) => [t.year, t.name, t.n, t.amount, t.realized])).toEqual([['2026', 'B', 1, 500, 0], ['2026', 'A', 2, 150, 100], ['2025', 'A', 1, 70, 0]]);
  });
  it('an NPO on the company chart: donations 7673 and sponsorships 7694 are AOP 244, not 247, and not economic activity', () => {
    const B = yeBalanceSet([
      { account: '1000', debit: 1500, credit: 0 },
      { account: '7673', debit: 0, credit: 1000 },
      { account: '7694', debit: 0, credit: 400 },
      { account: '7699', debit: 0, credit: 100 },
    ]);
    const R = npoCompute({ pre: B.pre, all: B.all, closed: false, chart: 'co' });
    expect(R.V['244']).toBe(1400);
    expect(R.V['247']).toBe(100);
    expect(R.econ).toBe(0);
  });
});
