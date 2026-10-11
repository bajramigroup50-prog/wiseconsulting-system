import { describe, expect, it } from 'vitest';
import {
  autoImportHeaderMap, autoImportNum, autoImportRows, autoSearchMatch, partsExportRows, reminderExportRows, VEHICLE_IMPORT_FIELDS, vehicleExportRows, vehicleHistoryRows,
  vehicleImportPlan, vehicleMatches, vregToVehicle, woShortParts, woState, workOrderExportRows, workOrderFrozen, workOrderMatches,
} from './industry';

describe('auto parity: search (legacy srchMatch)', () => {
  it('matches the whole query or its Cyrillic transcription', () => {
    expect(autoSearchMatch('РН-001/2026 SK-1234-AB Петар', 'петар')).toBe(true);
    expect(autoSearchMatch('Петар Петровски', 'petar')).toBe(true);
    expect(autoSearchMatch('Петар', '')).toBe(true);
    expect(autoSearchMatch('Петар', 'марко')).toBe(false);
  });
  it('work orders by number, plate, owner, vehicle, complaint', () => {
    const w = { number: 'РН-007/2026', plate: 'SK-1234-AB', complaint: 'Чука мотор' };
    expect(workOrderMatches(w, 'Петар', 'SK-1234-AB · VW Golf', 'golf')).toBe(true);
    expect(workOrderMatches(w, 'Петар', '', 'чука')).toBe(true);
    expect(workOrderMatches(w, 'Петар', '', 'РН-007')).toBe(true);
    expect(workOrderMatches(w, 'Петар', '', 'кочници')).toBe(false);
  });
  it('vehicles by plate key, VIN key, make / owner text', () => {
    const v = { plate: 'SK-1234-AB', vin: 'WVWZZZ1KZ8W000001', make: 'Volkswagen', model: 'Golf' };
    expect(vehicleMatches(v, 'Петар', 'sk 1234')).toBe(true);
    expect(vehicleMatches(v, 'Петар', '1kz8w')).toBe(true);
    expect(vehicleMatches(v, 'Петар', 'golf')).toBe(true);
    expect(vehicleMatches(v, 'Петар', 'petar')).toBe(true);
    expect(vehicleMatches(v, 'Петар', 'opel')).toBe(false);
  });
});

describe('auto parity: Excel import of customer vehicles (legacy DIG.cveh)', () => {
  it('maps headers by aliases in any order and language', () => {
    expect(autoImportHeaderMap(['Targa', 'Marka', 'Pronari', 'Километри', 'шасија'], VEHICLE_IMPORT_FIELDS)).toEqual({ plate: 0, make: 1, owner: 2, km: 3, vin: 4 });
    expect(autoImportHeaderMap(['Регистрација бр.', 'Модел на возило'], VEHICLE_IMPORT_FIELDS)).toEqual({ plate: 0, model: 1 });
  });
  it('finds the header row and parses numbers', () => {
    const R = autoImportRows([['Список на возила'], ['Таблица', 'Км'], ['SK-1', '1.234,5'], ['', '']], VEHICLE_IMPORT_FIELDS);
    expect(R).toEqual([{ plate: 'SK-1', km: '1.234,5' }]);
    expect(autoImportNum('1.234,5')).toBe(1234.5);
    expect(autoImportNum('185 000')).toBe(185000);
    expect(() => autoImportRows([['a', 'b'], ['1', '2']], VEHICLE_IMPORT_FIELDS)).toThrow(/колоните/);
  });
  it('skips rows without plate and VIN and duplicates (firm and file)', () => {
    const P = vehicleImportPlan([
      ['Таблица', 'VIN', 'Марка', 'Модел', 'Година', 'Мотор', 'Сопственик', 'Км'],
      ['sk-1234-ab', 'wvw1', 'VW', 'Golf', '2008', '1.9 TDI', 'Петар', '185.000'],
      ['SK 1234 AB', '', 'VW', 'Golf', '', '', '', ''],
      ['', '', 'Opel', '', '', '', '', ''],
      ['SK-9999-AA', '', 'Opel', 'Astra', 'x', '', '', ''],
      ['', 'OLDVIN', '', '', '', '', '', ''],
    ], [{ plate: null, vin: 'oldvin' }]);
    expect(P.add).toEqual([
      { plate: 'SK-1234-AB', vin: 'WVW1', make: 'VW', model: 'Golf', year: 2008, engine: '1.9 TDI', owner: 'Петар', km: 185000 },
      { plate: 'SK-9999-AA', vin: '', make: 'Opel', model: 'Astra', year: null, engine: '', owner: '', km: null },
    ]);
    expect(P.skip).toEqual(['SK 1234 AB', 'OLDVIN']);
  });
});

describe('auto parity: registration certificate read (legacy DIG.vreg)', () => {
  it('normalises the read', () => {
    expect(vregToVehicle({ plate: 'sk 1234 ab', vin: 'wvw', make: 'VOLKSWAGEN', model: 'GOLF', year: '2008', engine: '1896', fuel: 'дизел', owner: 'Петар' }))
      .toEqual({ plate: 'SK 1234 AB', vin: 'WVW', make: 'VOLKSWAGEN', model: 'GOLF', year: 2008, engine: '1896', fuel: 'дизел', owner: 'Петар' });
    expect(vregToVehicle(null).plate).toBe('');
    expect(vregToVehicle({ year: 'n/a' }).year).toBeNull();
  });
});

describe('auto parity: draft invoice (legacy woInv → bzInvDraft)', () => {
  it('a draft invoice does not make the order invoiced or frozen', () => {
    expect(woState({ status: 'done', invoiceId: 'i', invoiceStatus: 'draft' })).toBe('done');
    expect(woState({ status: 'done', invoiceId: 'i', invoiceStatus: 'posted' })).toBe('inv');
    expect(workOrderFrozen({ invoiceId: 'i', invoiceStatus: 'draft' })).toBe(false);
    expect(workOrderFrozen({ invoiceId: 'i', invoiceStatus: 'posted' })).toBe(true);
    expect(workOrderFrozen({ invoiceId: null })).toBe(false);
  });
  it('short stock: only stock items with less on hand than the quantity', () => {
    const S: Record<string, number> = { a: 1, b: 5 };
    const short = woShortParts([
      { itemId: 'a', name: 'Филтер', qty: 2, price: 1, rate: 18 }, { itemId: 'b', name: 'Масло', qty: 5, price: 1, rate: 18 },
      { itemId: 'svc', name: 'Услуга', qty: 9, price: 1, rate: 18 }, { name: 'Текст', qty: 1, price: 1, rate: 18 },
    ], (id) => (id in S ? S[id] : null));
    expect(short.map((p) => p.name)).toEqual(['Филтер']);
  });
});

describe('auto parity: exports', () => {
  it('work orders with totals, status and invoice', () => {
    const R = workOrderExportRows([{ number: 'РН-001/2026', date: '2026-03-05', plate: 'SK-1', km: 1000, complaint: 'x', status: 'done', invoiceId: 'i', invoiceStatus: 'posted',
      parts: [{ name: 'p', qty: 1, price: 100, rate: 18 }], labour: [{ name: 'l', hrs: 1, price: 1000, rate: 18 }] }], () => 'SK-1 · VW', () => 'Петар', () => '001/2026');
    expect(R[0]![0]).toBe('Број');
    expect(R[1]).toEqual(['РН-001/2026', '05.03.2026', 'SK-1 · VW', 'Петар', 1000, 'x', '', 100, 1000, 198, 1298, 'фактуриран', '001/2026']);
  });
  it('vehicles, history, parts, reminders', () => {
    expect(vehicleExportRows([{ id: '1', plate: 'SK-1', make: 'VW', year: 2008 }], () => 'Петар', () => ({ n: 2, last: '2026-01-02' }))[1])
      .toEqual(['SK-1', 'VW', '', 2008, '', '', '', 'Петар', null, 2, '02.01.2026', '']);
    expect(vehicleHistoryRows([{ number: 'РН-1', date: '2026-01-02', parts: [{ name: 'Филтер', qty: 2, price: 10, rate: 18 }], labour: [{ name: 'Замена', hrs: 1, price: 0, rate: 18 }] }])[1])
      .toEqual(['02.01.2026', null, 'РН-1', '', '', 'Филтер ×2', 'Замена', 23.6]);
    expect(partsExportRows([{ code: 'F1', name: 'Филтер', stock: 3, price: 100, rate: 18 }])[1]).toEqual(['F1', 'Филтер', '', '', '', 3, 118]);
    expect(reminderExportRows([{ v: { plate: 'SK-1', make: 'VW', model: 'Golf' }, last: { date: '2025-01-01', km: 1000, nextNote: 'Редовен сервис' }, why: 'рок', late: true }],
      () => ({ name: 'Петар', phone: '070', email: '' }))[1]).toEqual(['SK-1', 'VW Golf', 'Петар', '070', '', '01.01.2025', 1000, 'Редовен сервис', 'поминат', 'рок']);
  });
});
