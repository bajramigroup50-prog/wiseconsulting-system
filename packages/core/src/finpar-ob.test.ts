import { describe, expect, it } from 'vitest';
import { obBankRows, obDiag, obFromAi } from './finpar-ob';

describe('opening balance AI read (legacy obAi + obNetZero + 951→950)', () => {
  it('maps rows, inherits the konto, drops net-zero kontos and remaps 951/961', () => {
    const r = obFromAi({
      rows: [['1200', 'Купувачи', 'А ДОО', '4030', 100, 0], ['', '', 'Б ДОО', '', 50, 0], ['230018', '', 'X', '', 10, 0], ['230018', '', 'Y', '', 0, 10],
        ['951', 'Добивка', '', '', 0, 70], ['950', 'Задржана', '', '', 0, 30], ['abc', '', '', '', 1, 0]],
      totals: [['12', 150, 0]], grand: [160, 160],
    });
    expect(r.rows.map((x) => [x[0], x[2], x[4], x[5]])).toEqual([['1200', 'А ДОО', 100, 0], ['1200', 'Б ДОО', 50, 0], ['950', '', 0, 99]]); // the konto-less line joins the previous konto (legacy lastK)
    expect(r.netZero).toEqual([{ k: '230018', n: 2, g: 10 }]);
    expect(r.remapped).toBe(1);
    expect(r.totals).toEqual([['12', 150, 0]]);
    expect(r.grand).toEqual([160, 160]);
    expect(obFromAi({ rows: [['951', '', '', '', 0, 70]] }, { full: true }).rows[0]![0]).toBe('951');
  });
});

describe('opening balance difference analysis (legacy obDiag / obSubtot)', () => {
  const R = [
    { i: 0, account: '1200', label: 'Купувачи', partner: 'А', debit: 100, credit: 0 },
    { i: 1, account: '2200', label: 'Добавувачи', partner: 'Б', debit: 0, credit: 60 },
    { i: 2, account: '2200', label: 'Добавувачи', partner: 'Б', debit: 0, credit: 60 },
    { i: 3, account: '9999', label: 'xx', partner: '', debit: 20, credit: 0 },
  ];
  it('finds hits, duplicates, unknown kontos and pairs', () => {
    const X = obDiag(R, { known: (k) => k !== '9999' && k !== '999' });
    expect(X.diff).toBe(0);
    expect(X.dup).toHaveLength(1);
    expect(X.noK.map((r) => r.account)).toEqual(['9999']);
    const Z = obDiag([...R.slice(0, 2), { i: 5, account: '1000', label: '', partner: '', debit: 20, credit: 0 }], { known: () => true });
    expect(Z.diff).toBe(60);
    expect(Z.hits.map((h) => h.r.account)).toEqual(['2200']);
    expect(Z.cls.map((c) => c.c)).toEqual([1, 2]);
  });
  it('finds summary rows read as items', () => {
    const S = obDiag([
      { i: 0, account: '2200', label: '', partner: 'А', debit: 0, credit: 10 },
      { i: 1, account: '2200', label: '', partner: 'Б', debit: 0, credit: 20 },
      { i: 2, account: '2200', label: 'Добавувачи', partner: '', debit: 0, credit: 30 },
    ], { known: () => true });
    expect(S.sub.map((x) => x.r.i)).toEqual([2]);
  });
  it('bank accounts from 100x/103x rows', () => {
    expect(obBankRows([{ account: '100005' }, { account: '103001' }, { account: '100' }, { account: '100005' }, { account: '1200' }], ['100006']).map((r) => r.account)).toEqual(['100005', '103001']);
  });
});
