import { describe, expect, it } from 'vitest';
import {
  CB, CB_KEYS, cbInput, cbIsGlobal, cbNextCode, cbPerm, cbSort, cbUsageMessage, cbVal, isCbKey, priceListRows,
  SIFRARNIK_GROUPS, SIFRARNIK_SUBVIEWS,
} from './codebooks';

describe('codebook definitions (legacy CB)', () => {
  it('has the 16 legacy codebooks, each with a code and a name field', () => {
    expect(CB_KEYS).toHaveLength(16);
    for (const k of CB_KEYS) {
      const f = CB[k].f.map((x) => x[0]);
      expect(f).toContain('code');
      expect(f).toContain('name');
    }
    expect(isCbKey('paysif')).toBe(true);
    expect(isCbKey('toString')).toBe(false);
  });
  it('office-wide lists need settings, firm lists need write', () => {
    expect(cbIsGlobal('city')).toBe(true);
    expect(cbPerm('city', false)).toBe('settings');
    expect(cbPerm('warehouse', false)).toBe('write');
    expect(cbPerm('currency', true)).toBe('settings');
  });
  it('every cb_ link of „Сите шифрарници“ is a codebook sub-view', () => {
    for (const [, it] of SIFRARNIK_GROUPS) for (const [v] of it) if (v.startsWith('cb_')) expect(SIFRARNIK_SUBVIEWS).toContain(v);
  });
});

describe('cbInput (legacy cbSave)', () => {
  it('splits columns and data, parses numbers, keeps empty numbers empty', () => {
    expect(cbInput('position', { code: ' 01 ', name: 'Сметководител', nkz: '2411', coef: '1,5' }))
      .toEqual({ code: '01', name: 'Сметководител', data: { nkz: '2411', coef: 1.5 } });
    expect(cbInput('position', { code: '02', name: 'X', coef: '' })).toEqual({ code: '02', name: 'X', data: {} });
  });
  it('requires a code or a name and validates numbers, dates and payroll types', () => {
    expect(cbInput('oe', { code: '', name: '  ' })).toEqual({ error: 'Внесете шифра или назив.' });
    expect(cbInput('position', { name: 'X', coef: 'abc' })).toEqual({ error: '„Коефициент“ мора да биде број.' });
    expect(cbInput('cenovnik', { name: 'X', date: '1.1.2026' })).toEqual({ error: 'Неважечки датум.' });
    expect(cbInput('paysif', { code: '999', name: 'X', cat: 'zzz' })).toHaveProperty('error');
    expect(cbInput('paysif', { code: '101', name: 'Прекувремена', cat: 'dop', pct: '40' }))
      .toEqual({ code: '101', name: 'Прекувремена', data: { cat: 'dop', pct: 40 } });
  });
  it('upper-cases currency codes', () => {
    expect(cbInput('currency', { code: 'eur', name: 'Евро', rate: '61.5', date: '2026-01-01' }))
      .toEqual({ code: 'EUR', name: 'Евро', data: { rate: 61.5, date: '2026-01-01' } });
  });
});

describe('helpers', () => {
  it('sorts by code (or name) numerically, Macedonian collation', () => {
    const r = cbSort([{ code: '10', name: 'a' }, { code: '2', name: 'b' }, { code: null, name: 'Битола' }, { code: null, name: 'Охрид' }]);
    expect(r.map((x) => x.code ?? x.name)).toEqual(['2', '10', 'Битола', 'Охрид']);
  });
  it('next code keeps zero padding', () => {
    expect(cbNextCode(['01', '02', '09'])).toBe('10');
    expect(cbNextCode(['007', 'X'])).toBe('008');
    expect(cbNextCode([])).toBe('1');
  });
  it('reads columns and data fields', () => {
    const r = { code: '01', name: 'Скопје', data: { postal: '1000' } };
    expect([cbVal(r, 'code'), cbVal(r, 'name'), cbVal(r, 'postal')]).toEqual(['01', 'Скопје', '1000']);
  });
  it('usage message (legacy cbDelRow)', () => {
    expect(cbUsageMessage('Магацин 1', { stock_moves: 3, invoices: 0, journal_lines: 2 }))
      .toBe('„Магацин 1“ не може да се избрише – се користи во 3 магацински движења, 2 налози.');
    expect(cbUsageMessage('X', { invoices: 0 })).toBeNull();
  });
  it('price list applies the discount, then VAT (legacy cenPdf)', () => {
    const R = priceListRows([{ code: '2', name: 'B', unit: 'кг', price: 100, rate: 18 }, { code: '1', name: 'A', unit: null, price: 10.555, rate: 5 }], 10);
    expect(R.map((r) => [r.code, r.net, r.gross])).toEqual([['1', 9.5, 9.98], ['2', 90, 106.2]]);
  });
});
