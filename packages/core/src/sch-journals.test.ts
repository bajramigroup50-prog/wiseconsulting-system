import { describe, expect, it } from 'vitest';
import { SCH0 } from './data/posting';
import { jField, journalBalance, journalCards } from './sch-journals';

const val = (o: Record<string, string> = {}) => (k: string) => o[k] ?? String((SCH0 as Record<string, unknown>)[k] ?? '');

describe('schemes as journals (legacy schEx)', () => {
  it('lists the legacy example journals, balanced', () => {
    const C = journalCards(val(), () => false);
    expect(C.map((c) => c.id)).toEqual(['pur', 'purR', 'imp', 'fisk', 'inv', 'invS', 'cogs', 'kasa', 'adv', 'noVat', 'inv0', 'art32', 'pay', 'izvPay', 'izvSup']);
    for (const c of C.filter((x) => !['pay', 'izvPay'].includes(x.id))) expect(journalBalance(c.rows.filter((r) => !r.key || val()(r.key) !== '-')).ok, c.id).toBe(true);
    expect(C.find((c) => c.id === 'inv')!.rows[1]!.key).toBe('revGoods_18');
  });
  it('follows the values: revenue split off, retail method, removed payroll rows', () => {
    const C = journalCards(val({ revGoods_18: '-', pay_pio: '-' }), (k) => k === 'retailMethod');
    expect(C.find((c) => c.id === 'inv')!.rows[1]!.key).toBe('revGoods');
    expect(C.find((c) => c.id === 'purR')!.rows[0]!.key).toBe('retailStock');
    expect(C.find((c) => c.id === 'pay')!.rows.some((r) => r.key === 'pay_contrib')).toBe(true);
  });
  it('balance: a removed row unbalances; text amounts need both sides', () => {
    expect(journalBalance([{ d: 1000, p: 0 }, { d: 0, p: 1050 }]).ok).toBe(false);
    expect(journalBalance([{ d: 'бруто', p: 0 }, { d: 0, p: 'нето' }])).toMatchObject({ nums: false, ok: true });
    expect(journalBalance([{ d: 'бруто', p: 0 }]).ok).toBe(false);
    expect(jField('VI18')).toBe('VI18');
    expect(jField('stock')).toBe('s_stock');
  });
});
