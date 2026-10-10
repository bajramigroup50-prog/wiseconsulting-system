import { describe, expect, it } from 'vitest';
import { copyDcToRo, firmSettingsFrom, frCounts, frList, frTitle, unlockTo } from './firmform';

describe('firm editor (legacy firmFormVals)', () => {
  it('stores legacy keys, drops empties, keeps foreign settings', () => {
    const r = firmSettingsFrom({
      text: { bank: '300000000123456', fax: ' 02/111 ', opstina: '', payCode: '0', invNote: '' },
      checked: new Set(['qr']),
      settings: { sch: { x: 1 }, opstina: '004' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings).toMatchObject({ sch: { x: 1 }, bank: '300000000123456', bankAccount: '300000000123456', fax: '02/111', payCode: '0', qr: true, transport: false, invNote: '' });
    expect('opstina' in r.settings).toBe(false);
  });
  it('ignores collective VAT accounts like legacy vOk', () => {
    const r = firmSettingsFrom({ text: {}, checked: new Set(), settings: {}, vatIn: { 18: '1300', 10: '130010' }, vatOut: { 5: '23005' } });
    expect(r.ok && r.settings.vatIn).toEqual({ 10: '130010' });
    expect(r.ok && r.settings.vatOut).toEqual({ 5: '23005' });
  });
  it('accounting fee is a decimal string', () => {
    expect(firmSettingsFrom({ text: { accFee: '3000,5', accFrom: '2026-01-01' }, checked: new Set(), settings: {}, withFee: true })).toMatchObject({ ok: true, settings: { accFee: '3000.5', accFrom: '2026-01-01' } });
    expect(firmSettingsFrom({ text: { accFee: 'abc' }, checked: new Set(), settings: {}, withFee: true }).ok).toBe(false);
    // without the fee box the stored fee stays
    expect(firmSettingsFrom({ text: {}, checked: new Set(), settings: { accFee: '100' } })).toMatchObject({ ok: true, settings: { accFee: '100' } });
  });
  it('copyDC fills only empty fields', () => {
    expect(copyDcToRo({ dc_first: 'Ана', dc_last: 'Петрова', ro_last: 'Стојанова' })).toMatchObject({ ro_first: 'Ана', ro_last: 'Стојанова' });
  });
});

describe('firm list report (legacy frList)', () => {
  const L = [
    { id: '1', name: 'Бета', vatRegistered: true, vatPeriod: 'month' },
    { id: '2', name: 'Алфа', vatRegistered: true, vatPeriod: 'quarter', example: true },
    { id: '3', name: 'Гама', vatRegistered: false, vatPeriod: 'quarter' },
  ];
  it('filters and sorts', () => {
    expect(frList(L, 'all').map((f) => f.id)).toEqual(['2', '1', '3']);
    expect(frList(L, 'all', false).map((f) => f.id)).toEqual(['1', '3']);
    expect(frList(L, 'ddvM').map((f) => f.id)).toEqual(['1']);
    expect(frList(L, 'ddvQ').map((f) => f.id)).toEqual(['2']);
    expect(frList(L, 'noddv').map((f) => f.id)).toEqual(['3']);
    expect(frCounts(L)).toEqual({ ddv: 2, month: 1, quarter: 1, no: 1 });
    expect(frTitle('ddv')).toBe('ЛИСТА НА ФИРМИ – ДДВ ОБВРЗНИЦИ');
  });
  it('unlock moves the lock to the previous year end', () => {
    expect(unlockTo('2025-12-31')).toBe('2024-12-31');
  });
});
