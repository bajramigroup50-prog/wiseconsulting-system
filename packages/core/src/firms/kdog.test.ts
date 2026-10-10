import { describe, expect, it } from 'vitest';
import { kdAmt, kdCode, kdHtml, kdIndex, kdNew, kdNormalize, kdNumber, kdOfficeFirm, kdRecFirst, kdRecPlan, kdStatus, kdVat, kdWords } from './kdog';

describe('accounting-service contract (legacy kdAmt / kdWords / KD_ST)', () => {
  it('VAT rate of the office', () => {
    expect(kdVat({})).toBe(18);
    expect(kdVat({ vatOn: false })).toBe(0);
    expect(kdVat({ vatRate: 5 })).toBe(5);
  });
  it('net / gross in cents', () => {
    expect(kdAmt('gross', 3540, 18)).toEqual({ gross: 3540, net: 3000 });
    expect(kdAmt('net', 3000, 18)).toEqual({ net: 3000, gross: 3540 });
    expect(kdAmt('gross', 1000, 18)).toEqual({ gross: 1000, net: 847.46 });
    expect(kdAmt('net', '', 18)).toEqual({ net: 0, gross: 0 });
    expect(kdAmt('net', 2500, 0)).toEqual({ net: 2500, gross: 2500 });
  });
  it('amount in words', () => {
    expect(kdWords(3000)).toBe('три илјади денари');
    expect(kdWords(847.46)).toMatch(/денари и 46\/100$/);
  });
  it('status', () => {
    expect(kdStatus({})[0]).toBe('нацрт');
    expect(kdStatus({ offSig: { at: 'x' } })[1]).toBe('warn');
    expect(kdStatus({ offSig: { at: 'x' }, cliSig: { at: 'y' } })[0]).toBe('потпишан од двете страни');
    expect(kdStatus({ arch: 'd' })[0]).toBe('потпишан и архивиран');
  });
  it('number, defaults, normalise', () => {
    expect(kdNumber(7, 2026)).toBe('СУ-007/2026');
    const k = kdNew({ fee: 3000, city: 'Скопје', feeMode: 'net' }, { signer: 'Ана' }, '2026-10-10');
    expect(k).toMatchObject({ place: 'Скопје', rep: 'Ана', feeMode: 'net', docDay: 5, payDay: 10, notice: 30, dur: 'indef' });
    const n = kdNormalize({ fee: '3.000,5', docDay: 40, svc: ['book', 'xx'], dur: 'def', end: '2027-01-01' }, '2026-10-10');
    expect(n.docDay).toBe(28);
    expect(n.svc).toEqual(['book']);
    expect(n.end).toBe('2027-01-01');
  });
  it('control code changes with the content', () => {
    const k = kdNew({}, {}, '2026-10-10');
    expect(kdCode({ ...k, number: 'СУ-001/2026' }, 'f')).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(kdCode({ ...k, number: 'СУ-001/2026' }, 'f')).not.toBe(kdCode({ ...k, number: 'СУ-002/2026' }, 'f'));
  });
  it('HTML: parties, fee in words, annex, draft mark, escaping', () => {
    const k = { ...kdNew({}, {}, '2026-10-10'), number: 'СУ-001/2026', fee: 3540, feeMode: 'gross' as const, note: '<x>' };
    const H = kdHtml(k, { firm: { name: 'Клиент ДОО' }, firmId: 'f', O: { name: 'WISE', city: 'Скопје' }, img: (id) => '/api/files/' + id, draftMark: true });
    expect(H).toContain('Клиент ДОО');
    expect(H).toContain('<b>3.000,00</b> денари (со зборови: три илјади денари) без ДДВ');
    expect(H).toContain('АНЕКС 1');
    expect(H).toContain('НАЦРТ');
    expect(H).toContain('&lt;x&gt;');
    expect(H).not.toContain('<x>');
    const H2 = kdHtml({ ...k, noDpa: true, offSig: { at: '2026-10-10T10:00', sig: 's1', by: 'Б' } }, { firm: {}, firmId: 'f', O: {}, img: (id) => '/api/files/' + id, draftMark: true });
    expect(H2).not.toContain('АНЕКС 1');
    expect(H2).not.toContain('НАЦРТ');
    expect(H2).toContain('/api/files/s1');
  });
  it('firm summary (kdIndex)', () => {
    const k = { ...kdNew({}, {}, '2026-10-10'), id: 'c', number: 'СУ-001/2026', fee: 3540, feeMode: 'gross' as const };
    const r = kdIndex(k, 18);
    expect(r.accFee).toBe('3000.00');
    expect(r.kdog).toMatchObject({ no: 'СУ-001/2026', gross: 3540, net: 3000, st: 'нацрт' });
  });
});

describe('monthly invoices from the contracts (kdRecPlan)', () => {
  const firms = [
    { id: 'o', name: 'Канцеларија', edb: '4030', settings: { officeFirm: true } },
    { id: 'a', name: 'А', edb: '111', settings: { accFee: '3000', accFrom: '2026-01-15' } },
    { id: 'b', name: 'Б', embs: '222', settings: { kdog: { gross: 1180, no: 'СУ-002/2026', end: '2027-12-31' }, kdRecId: 'r1' } },
    { id: 'c', name: 'Ц', settings: {} },
    { id: 'd', name: 'Д', settings: { accFee: '500', example: true } },
  ];
  it('office firm', () => {
    expect(kdOfficeFirm(firms, {})?.id).toBe('o');
    expect(kdOfficeFirm([{ edb: '4-03-0', settings: {} }], { edb: '4030' })).toBeTruthy();
  });
  it('rows and states', () => {
    const R = kdRecPlan(firms, 'o', [{ id: 'p1', edb: '111' }], new Map([['r1', { id: 'r1', price: 1000, end: '2027-12-31' }]]), 18);
    expect(R.map((r) => [r.firm.id, r.net, r.st, r.partnerId])).toEqual([['a', 3000, 'нова', 'p1'], ['b', 1000, 'ок', null]]);
    const R2 = kdRecPlan(firms, 'o', [], new Map([['r1', { id: 'r1', price: 900, end: null }]]), 18);
    expect(R2[1]!.st).toBe('нова цена');
    expect(R[0]!.start).toBe('2026-01-15');
  });
  it('first issue date', () => {
    expect(kdRecFirst('2026-01-15', '2026-10-10')).toBe('2026-10-30');
    expect(kdRecFirst('2027-02-01', '2026-10-10')).toBe('2027-02-26');
  });
});
