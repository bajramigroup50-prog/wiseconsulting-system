import { describe, expect, it } from 'vitest';
import {
  fleetImportRow, FLEET_PRICE_IMPORT, HOTEL_LEGEND, HOTEL_RES_IMPORT, HOTEL_ROOM_IMPORT, hotelCheckInCheck, hotelDzsStat, hotelEditorCallouts, hotelGuestRows,
  hotelImportReservation, hrImportDate, hrImportNum, hrImportRows, hrImportTemplate, rcCalc, rentAbroad, rentAgeConfirm, rentByMonth, rentCalcLabel, rentClients,
  rentConfig, rentDepositKeepDefault, rentDocsSoon, rentInPeriod, rentOpenItems, rentRevenue, rentServiceDue, rentServiceText, rentWarnings, type RentReportRow,
} from './industry';

describe('hotel parity', () => {
  it('legend = the first three statuses with their colours', () => {
    expect(HOTEL_LEGEND).toEqual([['резервација', '#cfe0ff'], ['во хотел', '#ffd9a8'], ['одјавен', '#cfeedd']]);
  });
  it('editor callouts: clash with another live stay of the room, bad dates', () => {
    const O = [{ id: 'b', roomId: 'r1', from: '2026-07-02', to: '2026-07-05', status: 'resv' }, { id: 'c', roomId: 'r1', from: '2026-07-10', to: '2026-07-12', status: 'cancel' }];
    expect(hotelEditorCallouts({ id: 'a', roomId: 'r1', from: '2026-07-01', to: '2026-07-03' }, O)).toEqual(['⚠ Собата е веќе зафатена во овој период – изберете друга соба или датуми.']);
    expect(hotelEditorCallouts({ id: 'a', roomId: 'r1', from: '2026-07-10', to: '2026-07-11' }, O)).toEqual([]);
    expect(hotelEditorCallouts({ id: 'b', roomId: 'r1', from: '2026-07-05', to: '2026-07-05' }, O)).toEqual(['Датумот на заминување мора да е по датумот на доаѓање.']);
  });
  it('check-in needs guests and confirms incomplete ones', () => {
    expect(hotelCheckInCheck([{ name: '' }]).error).toMatch(/Внесете ги гостите/);
    expect(hotelCheckInCheck([{ name: 'A', birth: '1990-01-01', docNo: '1' }])).toEqual({ error: null, confirm: null });
    expect(hotelCheckInCheck([{ name: 'A', birth: '1990-01-01' }, { name: 'B', docNo: 'x' }]).confirm).toBe('2 гости немаат датум на раѓање или број на документ. Сепак да се пријават?');
  });
  const R = [
    { id: '1', from: '2026-03-30', to: '2026-04-03', status: 'out', inAt: '2026-03-30T14:00:00Z', roomNo: '101', guests: [{ name: 'Hans', nat: 'DE' }, { name: 'Eva', nat: 'DE' }] },
    { id: '2', from: '2026-04-10', to: '2026-04-12', status: 'in', inAt: '2026-04-10T12:00:00Z', roomNo: '102', guests: [{ name: 'Марко', nat: 'MK' }, { name: '' }] },
    { id: '3', from: '2026-04-15', to: '2026-04-16', status: 'resv', roomNo: '101', guests: [{ name: 'X', nat: 'AL' }] },
  ];
  it('guest book rows: checked-in / out stays touching the period, named guests only, check-in order', () => {
    expect(hotelGuestRows(R, '2026-04-01', '2026-04-30').map((x) => x.g.name)).toEqual(['Hans', 'Eva', 'Марко']);
  });
  it('ДЗС statistics: arrivals inside the period, nights clipped to it', () => {
    const S = hotelDzsStat(R, '2026-04-01', '2026-04-30');
    expect(S.dom).toEqual({ arr: 1, nights: 2 });
    expect(S.foreign).toEqual([['DE', { arr: 0, nights: 4 }]]);
    expect(S.total).toEqual({ arr: 1, nights: 6 });
    expect(S.avg(6, 4)).toBe('1.5');
  });
  it('imports: header detection with aliases, dates and numbers like legacy digD / digN', () => {
    const rows = hrImportRows([['Листа'], ['Room', 'Type', 'Beds', 'Price'], ['101', 'Двокреветна', '2', '2.500,00']], HOTEL_ROOM_IMPORT);
    expect(rows).toEqual([{ no: '101', kind: 'Двокреветна', beds: '2', floor: '', price: '2.500,00' }]);
    expect(hrImportNum('2.500,00')).toBe(2500);
    expect(hrImportNum('1 234.5')).toBe(1234.5);
    expect(hrImportDate('5.7.2026')).toBe('2026-07-05');
    expect(hrImportDate('2026-7-5')).toBe('2026-07-05');
    expect(hrImportDate(46208)).toBe('2026-07-05');
    expect(hrImportDate('x')).toBe('');
    expect(() => hrImportRows([['a', 'b']], HOTEL_ROOM_IMPORT)).toThrow();
    expect(hrImportTemplate(HOTEL_ROOM_IMPORT, ['101'])[0]).toEqual(['Број', 'Тип', 'Легла', 'Кат', 'Цена по ноќ']);
  });
  it('reservation import: room by number or type, price per night from the total', () => {
    const rooms = [{ id: 'r1', no: '101', kind: 'Студио', beds: 2, price: '3000' }];
    const [r] = hrImportRows([HOTEL_RES_IMPORT.map((x) => x[1]), ['Ana', '01.08.2026', '04.08.2026', 'Студио', '2', '9000', 'Booking.com', '', '']], HOTEL_RES_IMPORT);
    expect(hotelImportReservation(r!, rooms)).toEqual({ res: { roomId: 'r1', from: '2026-08-01', to: '2026-08-04', guestName: 'Ana', phone: '', email: '', adults: 2, price: 3000, src: 'Booking.com' } });
    expect(hotelImportReservation({ ...r!, room: '999' }, rooms)).toEqual({ skip: 'Ana (соба „999“)' });
    expect(hotelImportReservation({ ...r!, to: '01.08.2026' }, rooms)).toEqual({ skip: 'Ana (датуми)' });
  });
});

describe('rent-a-car parity', () => {
  const C = rentConfig({ minAge: 21, minLic: 2 });
  it('warnings: clash, age, licence years / expiry, vehicle documents, ID expiry, abroad without green card', () => {
    const W = rentWarnings(
      { from: '2026-07-01T09:00', to: '2026-07-10T09:00', status: 'out', countries: ['MK', 'GR'], green: false, driver: { birth: '2006-01-01', licFrom: '2025-01-01', licExp: '2026-07-05', docExp: '2026-07-08' } },
      { regExp: '2026-07-09', insExp: null, techExp: '2027-01-01' }, C, { number: 'RC-002/2026', driverName: 'Б' },
    );
    expect(W).toEqual([
      'Возилото е зафатено: RC-002/2026 (Б)', 'Возачот има 20 години (минимум 21).', 'Возачка дозвола помалку од 2 години.',
      'Возачката дозвола истекува пред крајот на изнајмувањето (05.07.2026).', 'Возилото: регистрација истекува 09.07.2026 – пред крајот на изнајмувањето.',
      'Документот за идентификација истекува 08.07.2026 – пред крајот на изнајмувањето.', 'Возилото е во странство без означен зелен картон.',
    ]);
    expect(rentWarnings({ from: '2026-07-01', to: '2026-07-02', status: 'resv', countries: ['GR'], driver: {} }, null, C, null)).toEqual([]);
    expect(rentAgeConfirm({ birth: '2006-01-01' }, '2026-07-01T09:00', C)).toBe('Возачот има 20 години (минимум 21). Сепак?');
    expect(rentAgeConfirm({ birth: '1990-01-01' }, '2026-07-01T09:00', C)).toBeNull();
    expect(rentAbroad(['MK'])).toBe(false);
    expect(rentAbroad([])).toBe(false);
  });
  it('calculation label and auto extras (extra km, missing fuel eighths)', () => {
    const c = rentConfig({ sPct: 20, fuel8: 600 });
    const k = rcCalc({ from: '2026-07-01T09:00', to: '2026-07-08T09:00', out: { km: 1000, fuel: 8 }, ret: { km: 2000, fuel: 6, at: '2026-07-08T10:00' } }, { rDay: 30, rWeek: 25, rKm: 100, rKmX: 5 }, c);
    expect(k.days).toBe(7);
    expect(k.ex.map((x) => [x.name, x.qty, x.price])).toEqual([['Дополнителни км (300 км над 700)', 300, 5], ['Гориво – недостасува 2/8 резервоар', 2, 600]]);
    expect(rentCalcLabel(k.days, { rWeek: 25 }, c)).toBe('Изнајмување: 7 дена (неделна цена) · сезона +20% (06-15 – 09-15)');
    expect(rentCalcLabel(1, { rWeek: 25 }, rentConfig({}))).toBe('Изнајмување: 1 ден');
    expect(rentDepositKeepDefault(500, 320.4)).toBe(320.4);
    expect(rentDepositKeepDefault(500, -3)).toBe(0);
  });
  it('service intervals and deadlines (legacy pnSvc / osDays ≤ 30)', () => {
    expect(rentServiceDue({ odo: 14500, oilEvery: 10000, oilLastKm: 5000, tyreEvery: 40000, tyreLastKm: 0 })).toEqual([
      { t: 'oil', n: 'Сервис (масло и филтри)', due: 15000, left: 500, st: 'warn' }, { t: 'tyre', n: 'Гуми', due: 40000, left: 25500, st: 'good' },
    ]);
    expect(rentDocsSoon({ regExp: '2026-07-20', insExp: '2026-12-01', techExp: '2026-06-01' }, '2026-07-01')).toEqual([['рег.', '2026-07-20'], ['техн.', '2026-06-01']]);
    expect(rentServiceText({ odo: 16000, oilEvery: 10000, oilLastKm: 5000, regExp: '2026-07-20' }, '2026-07-01')).toEqual(['🔧 Сервис (масло и филтри) поминат', '📄 рег. 20.07.2026']);
  });
  const row = (o: Partial<RentReportRow>): RentReportRow => ({
    id: 'x', number: 'RC-001/2026', plate: 'SK-1', from: '2026-07-01T09:00', to: '2026-07-04T09:00', status: 'ret', driver: { name: 'Ана', phone: '070', nat: 'MK' },
    countries: ['MK'], green: false, deposit: 0, depositIn: false, depositClosed: false, days: 3, tot: 118, km: 300, net: 100, gross: 118, paid: 0, est: true, invNumber: null, ...o,
  });
  it('revenue: invoice base, or the contract without VAT as an estimate', () => {
    expect(rentRevenue(118, 18, null)).toEqual({ net: 100, gross: 118, paid: 0, est: true, invNumber: null });
    expect(rentRevenue(118, 18, { base: 99.99, total: 118, paid: 50, number: '5' })).toEqual({ net: 99.99, gross: 118, paid: 50, est: false, invNumber: '5' });
  });
  it('report tabs: month, clients / countries, open items', () => {
    const L = [row({}), row({ id: 'y', from: '2026-08-02T09:00', to: '2026-08-03T09:00', est: false, net: 50, invNumber: '7', gross: 59, paid: 59, partnerId: 'p1', partnerName: 'Фирма', countries: ['MK', 'AL'], driver: { name: 'Б', nat: 'AL' } }), row({ id: 'z', status: 'resv' })];
    const P = rentInPeriod(L, '2026-01-01', '2026-12-31');
    expect(P.map((r) => r.id)).toEqual(['x', 'y']);
    const M = rentByMonth(P, 2);
    expect(M.map((m) => [m.mo, m.n, m.days, m.net, m.est, m.util, m.bar])).toEqual([['2026-07', 1, 3, 100, 100, 5, 100], ['2026-08', 1, 3, 50, 0, 5, 50]]);
    const K = rentClients(P);
    expect(K.clients.map((c) => [c.name, c.firm, c.net])).toEqual([['Ана', false, 100], ['Фирма', true, 50]]);
    expect(K.countries).toEqual([['MK', 2], ['AL', 1]]);
    expect(K.nationalities.map(([n]) => n)).toEqual(['MK', 'AL']);
    const O = rentOpenItems([
      row({ id: 'late', status: 'out', to: '2026-07-04T09:00', countries: ['GR'] }), row({ id: 'noinv' }), row({ id: 'unpaid', invNumber: '9', gross: 100, paid: 20 }),
      row({ id: 'dep', depositIn: true }), row({ id: 'doc', status: 'resv', driver: { licExp: '2026-07-02' } }),
    ], '2026-07-04T12:00');
    expect(O.late.map((x) => [x.r.id, x.hours])).toEqual([['late', 3]]);
    expect(O.abroad.map((x) => x.id)).toEqual(['late']);
    expect(O.noInv.map((x) => x.id)).toEqual(['noinv', 'dep']);
    expect(O.unpaid.map((x) => x.id)).toEqual(['unpaid']);
    expect(O.deposits.map((x) => x.id)).toEqual(['dep']);
    expect(O.docs.map((x) => x.id)).toEqual(['doc']);
  });
  it('fleet price import row', () => {
    const [r] = hrImportRows([FLEET_PRICE_IMPORT.map((x) => x[1]), ['sk 1234-ab', 'Golf', 'C', '2.000', '1800', '', '200', '10']], FLEET_PRICE_IMPORT);
    expect(fleetImportRow(r!)).toEqual({ plate: 'SK1234AB', name: 'Golf', rClass: 'C', prices: { rDay: 2000, rWeek: 1800, rKm: 200, rKmX: 10 } });
  });
});
