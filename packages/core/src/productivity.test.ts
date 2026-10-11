import { describe, expect, it } from 'vitest';
import {
  KNOWN_ACTIONS, activeMinutes, aggregateProductivity, catTotal, classifyAction, firmCount, fmtMinutes, parsePeriod, perActiveHour, presetRange,
  skopjeDayStart, verbOf, type AuditRowIn,
} from './office/productivity';

const T0 = Date.parse('2026-10-05T08:00:00Z'); // Monday 10:00 in Skopje
const min = (m: number) => new Date(T0 + m * 60_000);
const row = (m: number, action: string, o: Partial<AuditRowIn> = {}): AuditRowIn =>
  ({ at: min(m), userId: 'u1', firmId: 'f1', action, entityType: null, entityId: null, data: null, ...o });

describe('classifyAction', () => {
  it('maps the main document actions to their category and verb', () => {
    expect(classifyAction('saveInv', 'invoice')).toMatchObject({ cat: 'izlez', verb: 'c', known: true });
    expect(classifyAction('editInv', 'invoice')).toMatchObject({ cat: 'izlez', verb: 'u' });
    expect(classifyAction('delDoc', 'invoice')).toMatchObject({ cat: 'izlez', verb: 'd' });
    expect(classifyAction('savePur', 'purchase')).toMatchObject({ cat: 'vlez', verb: 'c' });
    expect(classifyAction('importBank', 'bank_import')).toMatchObject({ cat: 'izvodi', verb: 'c' });
    expect(classifyAction('bankKonto', 'bank_line')).toMatchObject({ cat: 'izvodi', verb: 'u' });
    expect(classifyAction('blgNew', 'cash_voucher')).toMatchObject({ cat: 'blagajna', verb: 'c' });
    expect(classifyAction('payNewM', 'payroll_run')).toMatchObject({ cat: 'plati', verb: 'c' });
    expect(classifyAction('ddvClose', 'vatPeriod')).toMatchObject({ cat: 'ddv' });
    expect(classifyAction('saveAsset', 'asset')).toMatchObject({ cat: 'os', verb: 'u' });
    expect(classifyAction('fileUpload', 'file')).toMatchObject({ cat: 'dokumenti', verb: 'c' });
    expect(classifyAction('aiRead', 'ai_document')).toMatchObject({ cat: 'ai', verb: 'c' });
    expect(classifyAction('carryOver', 'year')).toMatchObject({ cat: 'zatvoranje', verb: 'c' });
    expect(classifyAction('newFirm', 'firm')).toMatchObject({ cat: 'firmi', verb: 'c' });
    expect(classifyAction('htNew', 'hotel_reservation')).toMatchObject({ cat: 'dejnosti', verb: 'c' });
    expect(classifyAction('tNew', 'office_task')).toMatchObject({ cat: 'kanc', verb: 'c' });
  });
  it('excludes sign-in, settings and downloads', () => {
    for (const a of ['login', 'logout', 'uMyPass', 'invStyle', 'pdfRender', 'ublDl', 'bankFmt', 'ownerSet', 'backupJson']) expect(classifyAction(a), a).toBeNull();
    expect(classifyAction('fkPost', 'firm')).toBeNull(); // the firm-setting use of the name
    expect(classifyAction('fkPost', 'sales_daily')).toMatchObject({ cat: 'magacin', verb: 'c' });
  });
  it('journals of documents are by-products; hand-made journals are movements', () => {
    expect(classifyAction('postInvoice', 'journal')).toMatchObject({ byProduct: true });
    expect(classifyAction('postJournal', 'journal', { sourceType: 'stock_move' })).toMatchObject({ byProduct: true });
    expect(classifyAction('unpostJournal', 'journal', { sourceType: 'invoice' })).toMatchObject({ byProduct: true, verb: 'd' });
    expect(classifyAction('postJournal', 'journal', { sourceType: null })).toMatchObject({ cat: 'nalozi', verb: 'c', byProduct: false });
    expect(classifyAction('postJournal', 'journal', { sourceType: 'opening' })).toMatchObject({ byProduct: false });
    expect(classifyAction('saveJ', 'journal')).toMatchObject({ cat: 'nalozi', verb: 'c', byProduct: false });
  });
  it('approveDoc follows the entity; unknown actions fall back to the entity type, then „Друго“', () => {
    expect(classifyAction('approveDoc', 'purchase')).toMatchObject({ cat: 'vlez', known: true });
    expect(classifyAction('approveDoc', 'invoice')).toMatchObject({ cat: 'izlez', known: true });
    expect(classifyAction('xyzNew', 'invoice')).toMatchObject({ cat: 'izlez', verb: 'c', known: false });
    expect(classifyAction('cbFoo', 'code:city')).toMatchObject({ cat: 'firmi', known: false });
    expect(classifyAction('somethingOdd', null)).toMatchObject({ cat: 'drugo', verb: 'u', known: false });
  });
  it('guesses the verb from the name', () => {
    expect(verbOf('fooDel')).toBe('d');
    expect(verbOf('barCancel')).toBe('d');
    expect(verbOf('bazNew')).toBe('c');
    expect(verbOf('quxImport')).toBe('c');
    expect(verbOf('quuxSave')).toBe('u');
  });
  it('the table knows the core actions', () => {
    for (const a of ['saveInv', 'savePur', 'postJournal', 'importBank', 'blgSave', 'payNewM', 'saveMove', 'login']) expect(KNOWN_ACTIONS.has(a), a).toBe(true);
  });
});

describe('active time', () => {
  it('sums bursts split by pauses of 15 minutes or more, one minute per burst', () => {
    expect(activeMinutes([])).toBe(0);
    expect(activeMinutes([T0])).toBe(1);
    // 0, 5, 14 → one burst of 14 min (+1); 40, 50 → burst of 10 (+1)
    expect(activeMinutes([0, 5, 14, 40, 50].map((m) => T0 + m * 60_000))).toBe(15 + 11);
    // exactly 15 min apart → two bursts
    expect(activeMinutes([T0, T0 + 15 * 60_000])).toBe(2);
    // order does not matter
    expect(activeMinutes([50, 0, 40, 14, 5].map((m) => T0 + m * 60_000))).toBe(26);
  });
  it('movements per active hour', () => {
    expect(perActiveHour(30, 60)).toBe(30);
    expect(perActiveHour(10, 45)).toBe(13.3);
    expect(perActiveHour(5, 0)).toBeNull();
    expect(fmtMinutes(125)).toBe('2 ч 05 мин');
    expect(fmtMinutes(40)).toBe('40 мин');
  });
});

describe('period', () => {
  it('presets relative to today (week from Monday)', () => {
    expect(presetRange('d', '2026-10-11')).toEqual({ from: '2026-10-11', to: '2026-10-11' });
    expect(presetRange('w', '2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' }); // Sunday
    expect(presetRange('w', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(presetRange('m', '2026-10-11')).toEqual({ from: '2026-10-01', to: '2026-10-11' });
    expect(presetRange('pm', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('pm', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('y', '2026-10-11')).toEqual({ from: '2026-01-01', to: '2026-10-11' });
  });
  it('Skopje day start (CEST / CET)', () => {
    expect(skopjeDayStart('2026-07-01').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(skopjeDayStart('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });
  it('Од / До win over the preset; bad input falls back to this month', () => {
    expect(parsePeriod({ od: '2026-09-10', do: '2026-09-01' }, '2026-10-11')).toEqual({ from: '2026-09-01', to: '2026-09-10', preset: '' });
    expect(parsePeriod({ od: '2026-09-10' }, '2026-10-11')).toEqual({ from: '2026-09-10', to: '2026-09-10', preset: '' });
    expect(parsePeriod({ p: 'zz', od: 'x' }, '2026-10-11')).toEqual({ from: '2026-10-01', to: '2026-10-11', preset: 'm' });
  });
});

describe('aggregateProductivity', () => {
  const rows: AuditRowIn[] = [
    row(0, 'login'),
    row(1, 'saveInv', { entityType: 'invoice', entityId: 'i1', data: { kind: 'invoice', total: 1180, currency: 'MKD' } }),
    row(1, 'postInvoice', { entityType: 'journal', data: { lines: 3, sourceType: 'invoice' } }),
    row(3, 'editInv', { entityType: 'invoice', entityId: 'i1', data: { kind: 'invoice', total: 1180.5, currency: 'MKD' } }),
    row(4, 'saveInv', { entityType: 'invoice', entityId: 'i2', data: { kind: 'invoice', total: 100, currency: 'EUR' } }),
    row(5, 'savePur', { entityType: 'purchase', entityId: 'p1', firmId: 'f2', data: { total: '590.10' } }),
    row(30, 'saveJ', { entityType: 'journal', data: { lines: 4, sourceType: null } }),
    row(31, 'importBank', { entityType: 'bank_import', data: { lines: 12 } }),
    row(32, 'bankKonto', { entityType: 'bank_line' }),
    row(33, 'autoMatch', { entityType: 'bank_lines', data: { lines: [{ id: 'a' }, { id: 'b' }] } }),
    row(34, 'mysteryAction'),
    row(60 * 24, 'delDoc', { entityType: 'invoice', entityId: 'i2' }), // next day
    row(2, 'saveInv', { userId: 'u2', entityType: 'invoice', entityId: 'i9', data: { kind: 'invoice', total: 10 } }),
    row(5, 'recRun', { userId: null, entityType: 'recurring_invoice' }),
  ];
  const R = aggregateProductivity(rows);
  const u1 = R.users.find((u) => u.userId === 'u1')!;

  it('counts movements per user without noise and by-products', () => {
    expect(u1.total).toBe(10);
    expect(u1.noise).toBe(1);
    expect(u1.verbs).toEqual({ c: 5, u: 4, d: 1 });
    expect(catTotal(u1, 'izlez')).toBe(4);
    expect(u1.byCat.izlez).toEqual({ c: 2, u: 1, d: 1 });
    expect(catTotal(u1, 'izvodi')).toBe(3);
    expect(catTotal(u1, 'nalozi')).toBe(1);
    expect(catTotal(u1, 'drugo')).toBe(1);
    expect(R.unknown).toEqual({ mysteryAction: 1 });
    expect(R.total).toBe(12);
    expect(R.users[0]!.userId).toBe('u1');
    expect(R.users.some((u) => u.userId === null && u.total === 1)).toBe(true);
  });
  it('firms, days, active time', () => {
    expect(firmCount(u1)).toBe(2);
    expect(u1.firms[0]).toMatchObject({ firmId: 'f1', total: 9 });
    expect(u1.days).toEqual({ '2026-10-05': 9, '2026-10-06': 1 });
    expect(u1.activeDays).toBe(2);
    // bursts: 1..5 (4+1), 30..34 (4+1), next day (1)
    expect(u1.activeMin).toBe(11);
    expect(u1.perHour).toBe(Math.round(10 * 600 / 11) / 10);
  });
  it('volume: journal lines, bank lines, distinct invoices in MKD cents', () => {
    expect(u1.vol.jLines).toBe(7);
    expect(u1.vol.journals).toBe(1);
    expect(u1.vol.bankImported).toBe(12);
    expect(u1.vol.bankBooked).toBe(3);
    expect(u1.vol.inv).toBe(2);
    expect(u1.vol.invCents).toBe(118050); // i1 last total; the EUR invoice is not summed
    expect(u1.vol.pur).toBe(1);
    expect(u1.vol.purCents).toBe(59010);
  });
  it('a range keeps only its Skopje days', () => {
    const r = aggregateProductivity(rows, { from: '2026-10-06', to: '2026-10-06' });
    expect(r.users.map((u) => [u.userId, u.total])).toEqual([['u1', 1]]);
  });
});
