import { describe, expect, it } from 'vitest';
import { zkAopChecks, zkData, zkExpect, zkMapped } from './yearend/kontrola';
import { ZS_DEF, zsCompute } from './yearend/aop';
import { zcFindings } from './yearend/findings';
import { yeBalanceSet } from './yearend/balances';

describe('zsKontrola (legacy zkExpect / zkMapped / zkData)', () => {
  it('expected sides with the legacy exceptions', () => {
    expect(zkExpect('1000', 'Жиро сметка')).toBe('d');
    expect(zkExpect('0290', 'Исправка на вредноста на опрема')).toBe('p');
    expect(zkExpect('2200', 'Добавувачи')).toBe('p');
    expect(zkExpect('9010', 'Запишан капитал')).toBe('d');
    expect(zkExpect('9200', 'Акумулирана загуба')).toBe('d');
    expect(zkExpect('9500', 'Ревалоризациона резерва')).toBe('p');
    expect(zkExpect('7000', 'Набавна вредност на продадени производи')).toBe('d');
    expect(zkExpect('8100', 'Данок')).toBeNull();
    expect(zkExpect('9900', 'Вонбилансна')).toBeNull();
  });
  it('rule prefixes with ! exclusions', () => {
    const R = [{ k: '10,11,!119' }, { k: '' }];
    expect(zkMapped('1000', R)).toBe(true);
    expect(zkMapped('1190', R)).toBe(false);
    expect(zkMapped('2200', R)).toBe(false);
  });
  it('flags wrong-side and unmapped balances, totals incl. opening', () => {
    const K = zkData([
      { account: '1000', debit: 100, credit: 300, openingDebit: 50 },
      { account: '2200', debit: 0, credit: 500 },
      { account: '4000', debit: 650, credit: 0 },
      { account: '8100', debit: 0.2, credit: 0 },
    ], { 1000: 'Жиро сметка' }, [{ k: '10,22' }]);
    expect(K.TD).toBe(800.2);
    expect(K.TP).toBe(800);
    expect(K.sign).toEqual([{ k: '1000', s: -150, e: 'd' }]);
    expect(K.unm).toEqual([{ k: '4000', s: 650 }]);
  });
  it('six AOP checks', () => {
    const A = zkAopChecks({ bs063: 10, bs111: 10, bu250: 120, bu251: 20, bu252: 10 }, { '01': 100, '56': 10 });
    expect(A).toHaveLength(6);
    expect(A[4]!.slice(1)).toEqual([100, 100]);
    expect(A.every((x) => x[1] === x[2])).toBe(true);
  });
});

describe('production firm (costs by nature, 49 / 700 outside the ЦРМ income statement)', () => {
  it('4900 „Распоред на директни трошоци“ is expected on the credit side', () => {
    expect(zkExpect('4900', 'Распоред на директни трошоци на производи')).toBe('p');
    expect(zkExpect('4000', 'Потрошени материјали')).toBe('d');
  });
  it('49 and 700 are not „надвор од АОП“', () => {
    const K = zkData([
      { account: '4000', debit: 1000, credit: 0 }, { account: '4900', debit: 0, credit: 1500 }, { account: '7000', debit: 1200, credit: 0 },
    ], {}, ZS_DEF);
    expect(K.sign).toEqual([]);
    expect(K.unm).toEqual([]);
  });
  it('without 49 (no costs transferred into production) 7000 stays in AOP 209 as before', () => {
    const B = yeBalanceSet([{ account: '7000', debit: 1000, credit: 0 }, { account: '6600', debit: 0, credit: 1000 }]);
    const r = zsCompute({ year: 2026, pre: B.pre, all: B.all, opening: B.opening, provisionalTax: 0 });
    expect(r.V.bu209).toBe(1000);
    expect(r.V.bs063).toBe(r.V.bs111);
  });
  it('the income statement equals the ledger result and the balance sheet balances', () => {
    // materials 1000 bought and issued to production (D 4000 / C 3100); labour 500 absorbed; cost 1500 → 6300;
    // 2/3 sold (D 7000 1000 / C 6300) for 1800
    const tb = [
      { account: '1200', debit: 2124, credit: 0 }, { account: '2200', debit: 0, credit: 1180 }, { account: '1300', debit: 180, credit: 0 },
      { account: '2300', debit: 0, credit: 324 }, { account: '3100', debit: 1000, credit: 1000 }, { account: '4000', debit: 1000, credit: 0 },
      { account: '4900', debit: 0, credit: 1500 }, { account: '6000', debit: 1500, credit: 1500 }, { account: '6300', debit: 1500, credit: 1000 },
      { account: '7000', debit: 1000, credit: 0 }, { account: '7400', debit: 0, credit: 1800 },
    ];
    const B = yeBalanceSet(tb);
    const r = zsCompute({ year: 2026, pre: B.pre, all: B.all, opening: B.opening, provisionalTax: 0 });
    // ledger: 1800 − 1000 (4000) + 1500 (4900) − 1000 (7000) = 1300
    expect(r.V.bu250).toBe(1300);
    expect(r.V.bu208).toBe(1000);
    expect(r.V.bu205).toBe(500);
    expect(r.V.bu209).toBe(0);
    expect(r.V.bs063).toBe(2804);
    expect(r.V.bs063).toBe(r.V.bs111);
  });
});

describe('year control: stock below zero', () => {
  const items = { P: { name: 'Регал', type: 'product' } };
  it('a product received and sold on the same day is not „во минус“ whatever order the moves come in', () => {
    const F = zcFindings({ year: 2026, today: '2026-12-31', lines: [], items, moves: [{ item: 'P', qty: -15, date: '2026-12-15' }, { item: 'P', qty: 15, date: '2026-12-15' }] });
    expect(F.filter((x) => x.key.startsWith('st|'))).toEqual([]);
  });
  it('a sale before the receipt day is still reported', () => {
    const G = zcFindings({ year: 2026, today: '2026-12-31', lines: [], items, moves: [{ item: 'P', qty: 15, date: '2026-12-16' }, { item: 'P', qty: -15, date: '2026-12-15' }] });
    expect(G.map((x) => x.key)).toEqual(['st|P|main']);
  });
});
