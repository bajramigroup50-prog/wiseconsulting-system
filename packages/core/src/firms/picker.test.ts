import { describe, expect, it } from 'vitest';
import { fgClosed, fgCodes, fgData, fgFtype, fgMatch, alBellState, alMailBody, alSummaryText, fpApply, fpDdvDue, fpDdvNo, fpExportRows, fpGroupKey, fpLetter, fpPhone, fpPrevMonth, fpShort, type FpFirm } from './picker';

const F = (o: Partial<FpFirm> & { id: string; name: string }): FpFirm => ({ vat: true, month: false, ...o });

describe('firm picker (legacy firmPicker v455–v458)', () => {
  it('fpShort drops the long legal prefix', () => {
    expect(fpShort('Друштво за трговија и услуги АЛФА ДООЕЛ Скопје')).toBe('АЛФА ДООЕЛ Скопје');
    expect(fpShort('Друштво за производство, трговија и услуги БЕТА ДОО')).toBe('БЕТА ДОО');
    expect(fpShort('ГАМА ДООЕЛ')).toBe('ГАМА ДООЕЛ');
    expect(fpLetter({ name: 'Друштво за услуги жар ДОО' })).toBe('Ж');
  });
  it('VAT due like legacy fpDdvDue', () => {
    expect(fpDdvDue({ vat: true, month: true }, '2026-10-10')).toEqual({ per: '09/2026', due: '2026-10-25' });
    expect(fpDdvDue({ vat: true, month: false }, '2026-10-10')).toEqual({ per: 'Q3/2026', due: '2026-10-25' });
    expect(fpDdvDue({ vat: true, month: false }, '2026-11-10')).toBeNull();
    expect(fpDdvDue({ vat: true, month: true }, '2026-01-05')).toEqual({ per: '12/2025', due: '2026-01-25' });
    expect(fpDdvDue({ vat: false, month: true }, '2026-01-05')).toBeNull();
    expect(fpPrevMonth('2026-01-05')).toBe('2025-12');
  });
  it('filters, letters and sorts', () => {
    const L = [F({ id: 'a', name: 'Бета', city: 'Битола' }), F({ id: 'b', name: 'Алфа', vat: false, city: 'Скопје' }), F({ id: 'c', name: 'Ацо', month: true, al: { n: 2, bad: 1, txt: [] } })];
    expect(fpApply(L, { q: '', flt: 'all', az: '', sort: 'name' }).rows.map((f) => f.id)).toEqual(['b', 'c', 'a']);
    expect(fpApply(L, { q: '', flt: 'nddv', az: '', sort: 'name' }).rows.map((f) => f.id)).toEqual(['b']);
    expect(fpApply(L, { q: '', flt: 'al', az: '', sort: 'name' }).rows.map((f) => f.id)).toEqual(['c']);
    const r = fpApply(L, { q: '', flt: 'all', az: 'А', sort: 'name' });
    expect(r.rows.map((f) => f.id)).toEqual(['b', 'c']);
    expect([...r.letters].sort()).toEqual(['А', 'Б']);
    expect(fpApply(L, { q: 'скоп', flt: 'all', az: '', sort: 'name' }).rows.map((f) => f.id)).toEqual(['b']);
    expect(fpApply(L, { q: '', flt: 'all', az: '', sort: 'rec' }, ['a']).rows[0]!.id).toBe('a');
    expect(fpGroupKey(L[1]!, 'ddv')).toBe('Не се ДДВ обврзници');
    expect(fpGroupKey(L[2]!, 'ddv')).toBe('ДДВ – месечно');
  });
  it('export row and contact helpers', () => {
    const f = F({ id: 'x', name: 'Друштво за услуги ИКС ДОО', edb: '4030-123', phone: '070 111', phone2: '070 111' });
    expect(fpDdvNo(f)).toBe('MK4030123');
    expect(fpPhone(f)).toBe('070 111');
    const R = fpExportRows([f]);
    expect(R[0]![0]).toBe('Фирма');
    expect(R[1]!.slice(0, 2)).toEqual(['ИКС ДОО', 'Друштво за услуги ИКС ДОО']);
  });
});

describe('notifications (legacy alSummaryText / alMail / alBell)', () => {
  const I = [{ firm: 'А', lvl: 'bad' as const, txt: 'Извод (бр. 3) недостасува' }, { firm: 'А', lvl: 'warn' as const, txt: '100 ден. отворено' }, { firm: 'Б', lvl: 'info' as const, txt: 'инфо' }];
  it('text and voice summary', () => {
    expect(alSummaryText(I)).toBe('А\n  🔴 Извод (бр. 3) недостасува\n  🟠 100 ден. отворено');
    expect(alSummaryText(I, true)).toBe('Имате 1 итни и 1 известувања за внимание. А: Извод  недостасува. 100 денари отворено.');
    expect(alSummaryText([])).toBe('Нема итни известувања – сè е во ред.');
  });
  it('mail body', () => {
    const m = alMailBody(I, '10.10.2026', true);
    expect(m.subject).toBe('🔔 Известувања (2) – 10.10.2026');
    expect(m.body).toContain('Инфо:\n  🔵 Б: инфо');
    expect(m.body).toContain('Автоматски потсетник');
  });
  it('bell state', () => {
    expect(alBellState(1, 2)).toMatchObject({ cls: 'bad', n: 3, label: 'ИТНО' });
    expect(alBellState(0, 2)).toMatchObject({ cls: 'warn', label: 'ВНИМАНИЕ' });
    expect(alBellState(0, 0)).toMatchObject({ cls: 'ok', label: 'Нема известувања' });
  });
});

describe('„Избор на работна фирма“ grid mapping (old program)', () => {
  it('Шифра / Родител per year', () => {
    const st = { parent: '2098', curYear: '2024' };
    expect(fgCodes('3137', st, 2024)).toEqual({ code: '3137', parent: '2098' });
    // the year before the imported one: the parent IS that year's code; its own parent was not imported → empty
    expect(fgCodes('3137', st, 2023)).toEqual({ code: '2098', parent: '' });
    expect(fgCodes('3137', st, 2025)).toEqual({ code: '3137', parent: '2098' });
    // no parent imported / a firm created in WISE: empty Родител (valid: no record the year before)
    expect(fgCodes('3137', { curYear: '2024' }, 2023)).toEqual({ code: '3137', parent: '' });
    expect(fgCodes(null, {}, 2026)).toEqual({ code: '', parent: '' });
    expect(fgCodes('7', { parent: 5 }, 2026)).toEqual({ code: '7', parent: '5' });
  });
  it('Ф/СТД and Заклуч.', () => {
    expect(fgFtype({ ftype: 'СТД' }, 'doo')).toBe('СТД');
    expect(fgFtype({}, 'dooel')).toBe('Ф');
    expect(fgFtype({}, 'tp')).toBe('СТД');
    expect(fgFtype({}, 'doo', 'sd')).toBe('СТД');
    expect(fgFtype({}, 'zdr')).toBe('');
    expect(fgClosed('closed', {}, 2025)).toBe('Д');
    expect(fgClosed('carried', {}, 2025)).toBe('Д');
    expect(fgClosed('open', { closedFlag: 'Д', curYear: '2025' }, 2025)).toBe('Н');
    expect(fgClosed(null, { closedFlag: 'Д', curYear: '2025' }, 2025)).toBe('Д');
    expect(fgClosed(null, { closedFlag: 'Д', curYear: '2025' }, 2026)).toBe('Н');
    expect(fgClosed(undefined, {}, 2026)).toBe('Н');
  });
  it('fgData: bank accounts and import settings, empty columns kept; search by either code or account', () => {
    const d = fgData({ code: '3137', legalForm: 'doo', activity: null, settings: { parent: '2098', curYear: '2026', nkd: '86.230', bankName: 'НЛБ', bankAccount: '210111' } }, 2026,
      [{ account: null, name: 'Каса' }, { account: '300-1', name: 'Трансакциска сметка' }, { account: '500-2', name: 'Стопанска банка' }]);
    expect(d).toMatchObject({ code: '3137', parent: '2098', year: '2026', bank: '300-1', bank2: '500-2', activity: '86.230', bankName: 'НЛБ', ftype: 'Ф', closed: 'Н', regNo: '', opstina: '' });
    expect([...d.accts].sort()).toEqual(['210111', '300-1', '500-2']);
    expect(fgData({ settings: {} }, 2026, [{ account: '1', name: 'Комерцијална' }]).bankName).toBe('Комерцијална');
    const f = F({ id: 'x', name: 'АЛФА', code: '2098', g: d });
    expect(fgMatch(f, '3137')).toBe(true);
    expect(fgMatch(f, '2098')).toBe(true);
    expect(fgMatch(f, '3001')).toBe(true);
    expect(fgMatch(f, 'бета')).toBe(false);
  });
});
