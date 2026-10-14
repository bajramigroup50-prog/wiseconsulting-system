import { describe, expect, it } from 'vitest';
import { fxRate } from './bank-match';
import { nbrmChunks, nbrmUrl, parseNbrm } from './bank/nbrm';
import { feeAutoPeriod, feeBillingDate, feeDue, feePlan, feeReminderDue, feeReminderText, feeToIssue, feeTotals } from './firms/kdfee';
import type { KdRecRow } from './firms/kdog';
import {
  icsFold, rokClientDue, rokClientText, rokDays, rokGenerate, rokIcs, rokMonthGrid, rokRemindDue, rokState, type RokFirm,
} from './office/rokovi';

const base: RokFirm = { id: 'f1', name: 'Фирма ДООЕЛ', vatRegistered: true, vatPeriod: 'month', entity: 'co', employees: [] };
const keys = (f: RokFirm, a: string, b: string) => rokGenerate(f, a, b).map((r) => `${r.key}@${r.due}`);

describe('📅 deadline generation per firm type', () => {
  it('monthly VAT payer with employees: ДДВ-04 25th, МПИН 10th, profit-tax advance 15th, moved past weekends and holidays', () => {
    const f: RokFirm = { ...base, employees: [{ id: 'e1', name: 'Ана', start: '2020-01-01', end: null, m1Date: '2020-01-01' }] };
    // 25.10.2026 is a Sunday → Monday 26.10; 10.10 Saturday, 11.10 (holiday) on Sunday → Monday 12.10 off → 13.10
    expect(keys(f, '2026-10-01', '2026-10-31')).toEqual(['mpin:2026-09@2026-10-13', 'akont:2026-09@2026-10-15', 'ddv:2026-09@2026-10-26']);
    const r = rokGenerate(f, '2026-10-01', '2026-10-31').find((x) => x.type === 'ddv')!;
    expect(r).toMatchObject({ legal: '2026-10-25', link: 'ddv', verified: true, title: 'ДДВ-04 за 09.2026', period: '2026-09' });
  });
  it('quarterly VAT payer: ДДВ-04 only in the month after the quarter, period id as in vat_periods (`YYYY-Тq`)', () => {
    const f: RokFirm = { ...base, vatPeriod: 'quarter' };
    expect(keys(f, '2026-10-01', '2026-10-31').filter((k) => k.startsWith('ddv'))).toEqual(['ddv:2026-Т3@2026-10-26']);
    expect(keys(f, '2026-11-01', '2026-12-31').filter((k) => k.startsWith('ddv'))).toEqual([]);
    expect(keys(f, '2027-01-01', '2027-01-31').filter((k) => k.startsWith('ddv'))).toEqual(['ddv:2026-Т4@2027-01-25']);
  });
  it('no VAT, no employees: no ДДВ-04 / МПИН; year-end forms by entity type', () => {
    const co: RokFirm = { ...base, vatRegistered: false };
    expect(keys(co, '2027-01-01', '2027-03-31')).toEqual(expect.arrayContaining(['ye_db:2026@2027-03-15', 'ye_crm:2026@2027-03-15', 'dzs:2026@2027-03-15']));
    expect(keys(co, '2027-01-01', '2027-03-31').some((k) => k.startsWith('ddv') || k.startsWith('mpin') || k.startsWith('pdd_gi'))).toBe(false);
    const tp: RokFirm = { ...base, vatRegistered: false, entity: 'tp' };
    const T = keys(tp, '2027-03-01', '2027-03-31');
    expect(T).toContain('ye_tp:2026@2027-03-15');
    expect(T).toContain('dld:2027-02@2027-03-15');
    expect(T.some((k) => k.startsWith('akont') || k.startsWith('ye_db'))).toBe(false);
    // 28.02.2027 is a Sunday → 01.03.2027
    expect(keys({ ...base, vatRegistered: false, entity: 'npo' }, '2027-02-01', '2027-03-05')).toEqual(['ye_npo:2026@2027-03-01']);
  });
  it('unverified items are marked „за проверка“; М1 with a registration date is done; documents, contract and manual dates stay unmoved', () => {
    const f: RokFirm = {
      ...base, vatRegistered: false, akont: false,
      employees: [{ id: 'e2', name: 'Нов', start: '2026-10-17', end: null, m1Date: null }, { id: 'e3', name: 'Стар', start: '2019-01-01', end: '2026-10-18', m1Date: '2019-01-01' }],
      docs: [{ id: 'd1', title: 'Лиценца за превоз', validTo: '2026-10-24' }],
      contract: { no: 'СУ-001/2026', end: '2026-10-31' },
      manual: [{ id: 'm1', title: 'Обнова ЦРМ', due: '2026-10-18', done: true }],
    };
    const R = rokGenerate(f, '2026-10-16', '2026-10-31');
    expect(R.map((r) => r.key)).toEqual(['m1:e2', 'firm:m1', 'm2:e3', 'doc:d1', 'kdog:СУ-001/2026']);
    expect(R.find((r) => r.key === 'm1:e2')).toMatchObject({ verified: false, due: '2026-10-17' });
    expect(R.find((r) => r.key === 'firm:m1')).toMatchObject({ done: true, due: '2026-10-18' });
    expect(R.find((r) => r.key === 'doc:d1')!.due).toBe('2026-10-24');
  });
  it('ПДД-ГИ for employers, unverified', () => {
    const f: RokFirm = { ...base, vatRegistered: false, akont: false, employees: [{ id: 'e', name: 'А', start: '2020-01-01', end: null, m1Date: null }] };
    const r = rokGenerate(f, '2027-01-20', '2027-02-05').find((x) => x.type === 'pdd_gi')!;
    expect(r).toMatchObject({ period: '2026', verified: false, due: '2027-02-01' }); // 31.01.2027 is a Sunday
  });
});

describe('📅 reminders schedule, states, client reminder, calendar, ICS', () => {
  it('reminder window: N days before, open only, at most 30 days late', () => {
    expect(rokRemindDue('2026-10-20', { due: '2026-10-26', done: false }, 5)).toBe(false);
    expect(rokRemindDue('2026-10-21', { due: '2026-10-26', done: false }, 5)).toBe(true);
    expect(rokRemindDue('2026-10-27', { due: '2026-10-26', done: false }, 5)).toBe(true);
    expect(rokRemindDue('2026-10-21', { due: '2026-10-26', done: true }, 5)).toBe(false);
    expect(rokRemindDue('2026-12-01', { due: '2026-10-26', done: false }, 5)).toBe(false);
    expect(rokDays({})).toBe(5);
    expect(rokDays({ days: 0 })).toBe(0);
    expect(rokDays({ days: 100 })).toBe(60);
  });
  it('states', () => {
    expect(rokState('2026-10-14', '2026-10-13', false)).toBe('late');
    expect(rokState('2026-10-14', '2026-10-14', false)).toBe('today');
    expect(rokState('2026-10-14', '2026-10-16', false, 5)).toBe('soon');
    expect(rokState('2026-10-14', '2026-10-30', false, 5)).toBe('open');
    expect(rokState('2026-10-14', '2026-10-13', true)).toBe('done');
  });
  it('client reminder goes out on the configured day for the previous month', () => {
    expect(rokClientDue('2026-10-03', { client: { on: true } })).toBe('2026-09');
    expect(rokClientDue('2026-01-05', { client: { on: true, day: 5 } })).toBe('2025-12');
    expect(rokClientDue('2026-10-04', { client: { on: true } })).toBeNull();
    expect(rokClientDue('2026-10-03', { client: { on: false } })).toBeNull();
    expect(rokClientText('2026-09', { firm: 'Клиент', office: 'БАЈРАМИ ГРОУП' }).body).toContain('доставете ги изводите / фактурите за месец септември 2026');
  });
  it('month grid starts on Monday', () => {
    const W = rokMonthGrid('2026-10');
    expect(W[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(W.flat().filter(Boolean)).toHaveLength(31);
  });
  it('ICS: all-day events, escaped text, lines folded at 75 octets without splitting UTF-8', () => {
    const s = rokIcs([{ key: 'ddv:2026-09', firmId: 'f1', title: 'ДДВ-04 за 09.2026, месечно; тест', due: '2026-10-26', verified: true, firm: 'Фирма ДООЕЛ' }], '20261014T080000Z');
    expect(s).toContain('DTSTART;VALUE=DATE:20261026\r\n');
    expect(s).toContain('DTEND;VALUE=DATE:20261027\r\n');
    expect(s.replace(/\r\n /g, '')).toContain('SUMMARY:ДДВ-04 за 09.2026\\, месечно\\; тест – Фирма ДООЕЛ');
    for (const l of s.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(icsFold('a'.repeat(80)).split('\r\n')).toHaveLength(2);
  });
});

/* A fixture of the live answer (October 2026), trimmed: Friday 09.10 and the Saturday copy, plus a JPY row per 100. */
const NBRM_JSON = JSON.stringify([
  { rBr: 189, datum: '2026-10-09T00:00:00', valuta: '978', oznaka: 'EUR', drzava: 'ЕМУ', nomin: 1, sreden: 61.6866, nazivMak: 'евро', datum_f: '2026-10-08T00:00:00' },
  { rBr: 189, datum: '2026-10-09T00:00:00', valuta: '840', oznaka: 'USD', drzava: 'С А Д', nomin: 1, sreden: 55.1463, nazivMak: 'САД долар', datum_f: '2026-10-08T00:00:00' },
  { rBr: 189, datum: '2026-10-09T00:00:00', valuta: '392', oznaka: 'JPY', drzava: 'Јапонија', nomin: 100, sreden: 36.0815, nazivMak: 'јапонски јен', datum_f: '2026-10-08T00:00:00' },
  { rBr: 189, datum: '2026-10-10T00:00:00', valuta: '978', oznaka: 'EUR', drzava: 'ЕМУ', nomin: 1, sreden: 61.6866, nazivMak: 'евро', datum_f: '2026-10-08T00:00:00' },
  { rBr: 0, datum: '2026-10-10T00:00:00', valuta: '', oznaka: '', nomin: 1, sreden: 0 },
]);
const NBRM_XML = `<?xml version="1.0" encoding="utf-16"?>
<ArrayOfGetExchangeRate xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <GetExchangeRate><RBr>189</RBr><Datum>2026-10-09T00:00:00</Datum><Valuta>978</Valuta><Oznaka>EUR</Oznaka><Nomin>1</Nomin><Sreden>61.6866</Sreden><NazivMak>евро</NazivMak></GetExchangeRate>
  <GetExchangeRate><RBr>189</RBr><Datum>2026-10-09T00:00:00</Datum><Valuta>826</Valuta><Oznaka>GBP</Oznaka><Nomin>1</Nomin><Sreden>72.8312</Sreden></GetExchangeRate>
</ArrayOfGetExchangeRate>`;

describe('💱 NBRM rates', () => {
  it('parses the JSON answer: MKD per ONE unit (sreden / nomin), invalid rows skipped', () => {
    expect(parseNbrm(NBRM_JSON)).toEqual([
      { date: '2026-10-09', cur: 'EUR', rate: 61.6866, name: 'евро' },
      { date: '2026-10-09', cur: 'JPY', rate: 0.360815, name: 'јапонски јен' },
      { date: '2026-10-09', cur: 'USD', rate: 55.1463, name: 'САД долар' },
      { date: '2026-10-10', cur: 'EUR', rate: 61.6866, name: 'евро' },
    ]);
  });
  it('parses the XML answer', () => {
    expect(parseNbrm(NBRM_XML).map((r) => [r.date, r.cur, r.rate])).toEqual([['2026-10-09', 'EUR', 61.6866], ['2026-10-09', 'GBP', 72.8312]]);
    expect(() => parseNbrm('Service unavailable')).toThrow();
    expect(() => parseNbrm('<html><body>Error</body></html>')).toThrow();
  });
  it('URL and backfill chunks', () => {
    expect(nbrmUrl('2026-10-09', '2026-10-13')).toBe('https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=09.10.2026&EndDate=13.10.2026&format=json');
    expect(nbrmChunks('2026-01-01', '2026-03-05', 31)).toEqual([['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-03-03'], ['2026-03-04', '2026-03-05']]);
    expect(nbrmChunks('2026-02-01', '2026-01-01')).toEqual([]);
  });
  it('weekends / holidays / days not yet published use the last published rate', () => {
    const office = parseNbrm(NBRM_JSON).map((r) => ({ cur: r.cur, rate: r.rate, date: r.date }));
    expect(fxRate('USD', '2026-10-12', { office })).toBe(55.1463); // Monday holiday, no list → Friday's
    expect(fxRate('EUR', '2026-10-11', { office })).toBe(61.6866);
    expect(fxRate('EUR', '2026-10-08', { office: [...office, { cur: 'EUR', rate: 61.5, date: '2026-10-01' }] })).toBe(61.5);
    // the firm's own currency codebook still wins (manual entry stays allowed)
    expect(fxRate('EUR', '2026-10-10', { firm: [{ cur: 'EUR', rate: 61.7 }], office })).toBe(61.7);
  });
});

const rec = (id: string, name: string, net: number, o: Partial<KdRecRow> = {}): KdRecRow =>
  ({ firm: { id, name }, net, start: '2026-01-01', end: '', no: `СУ-${id}`, partnerId: `p-${id}`, existing: null, st: 'нова', ...o });

describe('🧾 monthly fee invoices', () => {
  it('plan: new / already issued / recurring / outside the contract; exact cents', () => {
    const P = feePlan([
      rec('a', 'Алфа', 3000), rec('b', 'Бета', 2541.67), rec('c', 'Гама', 1000, { start: '2026-11-01' }),
      rec('d', 'Делта', 1000, { end: '2026-09-30' }), rec('e', 'Ехо', 1500),
    ], '2026-10', 18, new Map([['b', { id: 'i1', number: '15/2026' }]]), new Map([['e', 'r1']]));
    expect(P.map((r) => [r.name, r.st])).toEqual([['Алфа', 'нова'], ['Бета', 'издадена'], ['Гама', 'пред почеток'], ['Делта', 'истечен'], ['Ехо', 'периодична']]);
    expect(P[0]).toMatchObject({ net: 300000, vat: 54000, gross: 354000 });
    expect(P[1]).toMatchObject({ net: 254167, vat: 45750, gross: 299917 });
    expect(feeToIssue(P).map((r) => r.name)).toEqual(['Алфа']);
    expect(feeToIssue(P, { includeRecurring: true }).map((r) => r.name)).toEqual(['Алфа', 'Ехо']);
    expect(feeToIssue(P, { includeRecurring: true, only: ['e'] }).map((r) => r.name)).toEqual(['Ехо']);
    expect(feeTotals(feeToIssue(P, { includeRecurring: true }))).toEqual({ net: 450000, vat: 81000, gross: 531000 });
    // office not a VAT payer
    expect(feePlan([rec('a', 'Алфа', 3000)], '2026-10', 0, new Map(), new Map())[0]).toMatchObject({ vat: 0, gross: 300000 });
  });
  it('billing day, automatic day, due date', () => {
    expect(feeBillingDate('2026-10')).toBe('2026-10-30'); // 31.10.2026 is a Saturday
    expect(feeBillingDate('2026-02', 30)).toBe('2026-02-28');
    expect(feeBillingDate('2026-10', 5)).toBe('2026-10-05');
    expect(feeAutoPeriod('2026-10-30', { auto: true })).toBe('2026-10');
    expect(feeAutoPeriod('2026-10-29', { auto: true })).toBeNull();
    expect(feeAutoPeriod('2026-10-30', { auto: false })).toBeNull();
    expect(feeDue('2026-10-30', '2026-10', 10)).toBe('2026-11-10');
    expect(feeDue('2026-11-20', '2026-10', 10)).toBe('2026-12-05');
    expect(feeDue('2026-10-30', '2026-10', null)).toBe('2026-11-14');
  });
  it('overdue reminders: N days after due, every M days, at most K', () => {
    const r = { due: '2026-11-10', remaining: 354000, reminders: 0, lastReminder: null };
    const c = { on: true, days: 10, every: 15, max: 2 };
    expect(feeReminderDue(r, '2026-11-19', c)).toBe(false);
    expect(feeReminderDue(r, '2026-11-20', c)).toBe(true);
    expect(feeReminderDue({ ...r, reminders: 1, lastReminder: '2026-11-20' }, '2026-12-04', c)).toBe(false);
    expect(feeReminderDue({ ...r, reminders: 1, lastReminder: '2026-11-20' }, '2026-12-05', c)).toBe(true);
    expect(feeReminderDue({ ...r, reminders: 2, lastReminder: '2026-12-05' }, '2027-01-30', c)).toBe(false);
    expect(feeReminderDue({ ...r, remaining: 50 }, '2026-12-30', c)).toBe(false);
    expect(feeReminderDue(r, '2026-12-30', { ...c, on: false })).toBe(false);
    const t = feeReminderText({ n: 1, number: '15/2026', date: '2026-10-30', due: '2026-11-10', remaining: 354000, ym: '2026-10', client: 'Алфа', office: 'БАЈРАМИ ГРОУП ДООЕЛ' });
    expect(t.subject).toContain('Љубезен потсетник');
    expect(t.body).toContain('3.540,00 ден.');
    expect(t.body).toContain('октомври 2026');
  });
});
