import { describe, expect, it } from 'vitest';
import { zkAopChecks, zkData, zkExpect, zkMapped } from './yearend/kontrola';

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
