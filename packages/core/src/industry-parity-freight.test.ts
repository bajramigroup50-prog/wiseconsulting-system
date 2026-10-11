import { describe, expect, it } from 'vitest';
import {
  FR_DOC_DRIVER, FR_DOC_VEHICLE, FR_XLSX_HEAD, frCanPick, frCost, frDnevByDriver, frDnevTours, frDocBadge, frDocError, frDocImport, frExpiredFor, frExpiring,
  frFilterTours, frInvoicePlan, frNextEmployeeNo, frNextNo, frParseRates, frPriceMkd, frQuickDriverError, frQuickVehicleError, frQuickVehicleName,
  frToursWithoutBorders, frTourError, frXlsxRow, monthOptions,
} from './industry';

const fx = (c: string) => (c === 'EUR' ? 61.5 : c === 'CHF' ? 65 : 0);

describe('freight parity (legacy 14436–14706)', () => {
  it('monSel: year+1 .. year-2, December first', () => {
    const o = monthOptions('2026-03', 2026);
    expect(o).toHaveLength(48);
    expect(o[0]).toEqual({ value: '2027-12', label: 'Декември 2027' });
    expect(o[47]).toEqual({ value: '2024-01', label: 'Јануари 2024' });
  });

  it('frNextNo: Т-NNN/year from the highest number of the year', () => {
    expect(frNextNo([{ number: 'Т-007/2026', date: '2026-02-01' }, { number: 'Т-099/2025', date: '2025-12-30' }], '2026-05-01')).toBe('Т-008/2026');
    expect(frNextNo([], '2026-01-01')).toBe('Т-001/2026');
  });

  it('price in MKD and frCost (fuel + per diems + tolls + other)', () => {
    const t = { number: 'Т-1', date: '2026-03-01', unloadDate: '2026-03-03', price: 1000, cur: 'EUR', tolls: 100, tollCur: 'EUR', otherCost: 500 };
    expect(frPriceMkd(t, fx)).toBe(61500);
    expect(frPriceMkd({ ...t, fx: 61.7 }, fx)).toBe(61700);
    expect(frPriceMkd({ ...t, cur: 'MKD' }, fx)).toBe(1000);
    const c = frCost(t, 12000.4, 9000, fx);
    expect(c).toEqual({ fuel: 12000.4, dn: 9000, tolls: 6150, oth: 500, total: 27650.4 });
  });

  it('list filter: open (default) hides invoiced and cancelled; month and client', () => {
    const L = [
      { id: 'a', status: 'plan', date: '2026-03-01', partnerId: 'p1' }, { id: 'b', status: 'inv', date: '2026-03-02', partnerId: 'p1' },
      { id: 'c', status: 'cancel', date: '2026-04-02', partnerId: 'p2' }, { id: 'd', status: 'done', date: '2026-04-05', partnerId: 'p2' },
    ];
    expect(frFilterTours(L, {}).map((x) => x.id)).toEqual(['a', 'd']);
    expect(frFilterTours(L, { st: 'all', mo: '2026-04' }).map((x) => x.id)).toEqual(['c', 'd']);
    expect(frFilterTours(L, { st: 'inv' }).map((x) => x.id)).toEqual(['b']);
    expect(frFilterTours(L, { st: 'all', p: 'p1' }).map((x) => x.id)).toEqual(['a', 'b']);
    expect(frCanPick({ status: 'done', invoiceId: null })).toBe(true);
    expect(frCanPick({ status: 'cancel' })).toBe(false);
    expect(frCanPick({ status: 'done', invoiceId: 'x' })).toBe(false);
  });

  it('save validations in the legacy order and wording', () => {
    const cn = (c: string) => (c === 'DE' ? 'Германија' : c);
    const base = { number: 'Т-1', date: '2026-03-01' };
    expect(frTourError({ ...base, price: 10 }, { dupNumber: false, countryName: cn })).toBe('Изберете клиент (налогодавач) – потребен е за фактурата.');
    expect(frTourError({ ...base }, { dupNumber: false, countryName: cn })).toBe('Изберете клиент или возач.');
    expect(frTourError({ ...base, number: ' ', driverId: 'd' }, { dupNumber: false, countryName: cn })).toBe('Внесете број на турата.');
    expect(frTourError({ ...base, driverId: 'd' }, { dupNumber: true, countryName: cn })).toBe('Бројот Т-1 веќе постои.');
    expect(frTourError({ ...base, driverId: 'd', segs: [{ c: 'DE', in: '2026-03-02T10:00', out: '2026-03-01T10:00' }] }, { dupNumber: false, countryName: cn })).toBe('Излезот од Германија е пред влезот.');
    const prev = { ...base, partnerId: 'p', price: 100, cur: 'EUR', vat: 'intl', invoiceId: 'i', invNumber: '12/2026' };
    expect(frTourError({ ...prev, price: 120 }, { dupNumber: false, prev, countryName: cn })).toMatch(/^Турата е фактурирана \(12\/2026\)/);
    expect(frTourError({ ...prev, note: 'x' } as never, { dupNumber: false, prev, countryName: cn })).toBeNull();
  });

  it('invoice from tours: one client, one currency, legacy line and note texts, pdate = latest unloading', () => {
    const T = [
      { number: 'Т-001/2026', date: '2026-03-01', unloadDate: '2026-03-04', partnerId: 'p', cur: 'EUR', price: 1200, vat: 'intl', loadPlace: 'Скопје', loadC: 'MK', unloadPlace: 'Минхен', unloadC: 'DE', vehicleId: 'v1', trailer: 'SK-55-XY', orderNo: '77' },
      { number: 'Т-002/2026', date: '2026-03-05', unloadDate: '2026-03-09', partnerId: 'p', cur: 'EUR', price: 800, fx: 61.6, vat: 'intl', loadPlace: 'Битола', unloadPlace: 'Виена', unloadC: 'AT' },
    ];
    const r = frInvoicePlan(T, { plate: () => 'SK-1234-AB', fx, date: '2026-03-20' });
    if ('error' in r) throw new Error(r.error);
    expect(r.lines[0]!.name).toBe('Превоз на стока Скопје (MK) – Минхен (DE), CMR Т-001/2026, SK-1234-AB/SK-55-XY, нар. 77 · 1.200,00 EUR × 61.5');
    expect(r.lines[1]!.name).toBe('Превоз на стока Битола – Виена (AT), CMR Т-002/2026 · 800,00 EUR × 61.6');
    expect(r.lines[0]).toMatchObject({ unit: 'тура', qty: 1, price: 1200, rate: 0 });
    expect(r.note).toBe('Вкупно за плаќање: 2.000,00 EUR. Денарската противвредност е по среден курс на НБРМ. Меѓународен превоз на стоки – ослободено од ДДВ со право на одбивка според Законот за ДДВ.');
    expect(r.pdate).toBe('2026-03-09');
    expect(r.fx).toBe(61.5);
    expect(frInvoicePlan([T[0]!, { ...T[1]!, partnerId: 'q' }], { plate: () => '', fx, date: '2026-03-20' })).toEqual({ error: 'Избраните тури се на различни клиенти – една фактура е за еден клиент.' });
    expect(frInvoicePlan([T[0]!, { ...T[1]!, cur: 'MKD' }], { plate: () => '', fx, date: '2026-03-20' })).toEqual({ error: 'Избраните тури се во различни валути.' });
    const d = frInvoicePlan([{ ...T[0]!, cur: 'MKD', vat: 'dom' }], { plate: () => '', fx, date: '2026-03-20' });
    expect(d).toMatchObject({ note: '', lines: [{ rate: 18 }] });
  });

  it('Excel: the legacy 23 columns', () => {
    expect(FR_XLSX_HEAD).toHaveLength(23);
    const t = { number: 'Т-1', date: '2026-03-01', status: 'done', price: 100, cur: 'EUR', km: 1500 };
    const row = frXlsxRow(t, { partner: 'А', plate: 'SK', driver: 'Д', rev: 6150, cost: frCost(t, 1000, 2000, fx), invNumber: '' });
    expect(row).toHaveLength(23);
    expect(row[1]).toBe('01.03.2026');
    expect(row[20]).toBe(3150);
    expect(row[21]).toBe('Завршена');
  });

  it('licences: expiring within 30 days, expired for a tour, badges, validation', () => {
    const D = [
      { who: 'veh' as const, ref: 'v1', kind: 'CEMT дозвола', validTo: '2026-03-05' },
      { who: 'drv' as const, ref: 'd1', kind: 'Пасош', validTo: '2026-02-20' },
      { who: 'drv' as const, ref: 'd2', kind: 'Пасош', validTo: '2026-06-01' },
    ];
    expect(frExpiring(D, '2026-03-01').map((x) => x.n)).toEqual([4, -9]);
    expect(frExpiredFor({ vehicleId: 'v1', driverId: 'd1' }, D, '2026-03-01').map((x) => x.ref)).toEqual(['d1']);
    expect(frDocBadge('2026-02-28', '2026-03-01')).toEqual(['bad', 'истечено']);
    expect(frDocBadge('2026-03-11', '2026-03-01')).toEqual(['warn', 'за 10 дена']);
    expect(frDocBadge('2026-09-11', '2026-03-01')).toEqual(['good', 'важи']);
    expect(frDocError({ who: 'drv', ref: '', kind: 'x' })).toBe('Нема внесени вработени (возачи).');
    expect(frDocError({ who: 'veh', ref: 'v', kind: 'x', validFrom: '2026-02-01', validTo: '2026-01-01' })).toBe('„Важи до“ е пред „Важи од“.');
  });

  it('documents import from Excel', () => {
    const r = frDocImport([
      ['За', 'Рег', 'Вид', 'Број', 'Од', 'До', 'Заб'],
      ['возило', 'sk 1234 ab', 'CEMT дозвола', '55', '01.01.2026', '31.12.2026', ''],
      ['возач', 'Петар Петров', 'пасош', 'A1', '', '2027-05-01', 'x'],
      ['возач', 'Непознат', 'Пасош', '', '', '', ''],
    ], [{ id: 'v1', plate: 'SK-1234-AB' }], [{ id: 'd1', name: 'Петар Петров' }], { veh: FR_DOC_VEHICLE, drv: FR_DOC_DRIVER });
    expect(r.docs).toEqual([
      { who: 'veh', ref: 'v1', kind: 'CEMT дозвола', no: '55', validFrom: '2026-01-01', validTo: '2026-12-31', note: '' },
      { who: 'drv', ref: 'd1', kind: 'Пасош', no: 'A1', validFrom: null, validTo: '2027-05-01', note: 'x' },
    ]);
    expect(r.errors).toEqual(['Ред 4: нема вработен „Непознат“.']);
  });

  it('per diems page: month tours, tours without borders, per driver', () => {
    const L = [
      { id: 'a', date: '2026-03-01', status: 'done', driverId: 'd1', segs: [{ c: 'DE', in: '', out: '' }] },
      { id: 'b', date: '2026-03-03', status: 'plan', driverId: null, segs: [{ c: 'AT', in: '', out: '' }] },
      { id: 'c', date: '2026-03-04', status: 'plan', driverId: 'd1', segs: [] },
      { id: 'd', date: '2026-03-04', status: 'cancel', driverId: 'd1', segs: [{ c: 'AT', in: '', out: '' }] },
    ];
    expect(frDnevTours(L, '2026-03').map((x) => x.id)).toEqual(['a', 'b']);
    expect(frToursWithoutBorders(L, '2026-03').map((x) => x.id)).toEqual(['c']);
    const by = frDnevByDriver(frDnevTours(L, '2026-03'), () => ({ mkd: 100, by: { EUR: 2 }, rows: [{ u: 1.5 }] }));
    expect(by.map((x) => [x.driverId, x.tours.length, x.units, x.mkd])).toEqual([['d1', 1, 1.5, 100], ['-', 1, 1.5, 100]]);
  });

  it('per-diem amounts: blank = standard, 0 < v < 1000, currency of the table', () => {
    expect(frParseRates([['DE', '80'], ['CH', '120,5'], ['AT', '']])).toEqual({ rates: { DE: [80, 'EUR'], CH: [120.5, 'CHF'] } });
    expect(frParseRates([['DE', '1000']])).toEqual({ error: 'Неважечки износ.' });
    expect(frParseRates([['DE', '0']])).toEqual({ error: 'Неважечки износ.' });
  });

  it('quick add of vehicles, trailers and drivers', () => {
    expect(frQuickVehicleError('', [])).toBe('Внесете регистрација.');
    expect(frQuickVehicleError('sk-1234-ab', ['SK 1234 AB'])).toBe('Возило со оваа регистрација веќе постои.');
    expect(frQuickVehicleName(true, '', 'sk-55')).toBe('Приколка SK-55');
    expect(frQuickVehicleName(false, 'Scania R450', 'SK-1')).toBe('Scania R450 SK-1');
    expect(frQuickDriverError('', '', [])).toBe('Внесете име.');
    expect(frQuickDriverError('А', '123', [])).toBe('ЕМБГ има 13 цифри.');
    expect(frQuickDriverError('А', '0101990450001', ['0101990450001'])).toBe('Вработен со овој ЕМБГ веќе постои.');
    expect(frNextEmployeeNo(['3', '10', null, 'x'])).toBe('11');
  });
});
