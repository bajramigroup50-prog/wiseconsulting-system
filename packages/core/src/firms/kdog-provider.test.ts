import { describe, expect, it } from 'vitest';
import { kdHtml, kdNew, kdOfficeFirm, kdProvider, KD_OFFICE_NAME_RX } from './kdog';
import { hrCtLawCheck, HR_LEAVE_DAYS } from '../payroll/hr';

const SIG = '11111111-2222-3333-4444-555555555555';
const STAMP = '66666666-7777-8888-9999-000000000000';
const BG = { id: 'bg', name: 'БАЈРАМИ ГРОУП ДООЕЛ СКОПЈЕ', address: 'ул. Пример 1', city: 'Скопје', edb: 'MK4030-000-000', embs: '7000000', phone: '02/111', email: 'kanc@example.mk', settings: { bankAccount: '300-0000000000-00', signer: 'Сопственик Бајрами', signerRole: 'Управител', sign: SIG, stamp: STAMP, logo: 'http://not-a-file' } };

describe('office firm = provider of the accounting-service contracts (owner decision)', () => {
  it('default office firm: flag, then ЕДБ, then the name „БАЈРАМИ ГРОУП“ (never an example firm)', () => {
    const F = [{ id: 'a', name: 'Клиент ДОО', settings: {} }, { id: 'x', name: 'БАЈРАМИ ГРОУП (пример)', settings: { example: true } }, { ...BG }];
    expect(kdOfficeFirm(F, {})?.id).toBe('bg');
    expect(kdOfficeFirm([...F, { id: 'f', name: 'Друга', settings: { officeFirm: true } }], {})?.id).toBe('f');
    expect(kdOfficeFirm([{ id: 'e', name: 'Е', edb: '123', settings: {} }, ...F], { edb: '123' })?.id).toBe('e');
    expect(kdOfficeFirm([{ id: 'a', name: 'Клиент', settings: {} }], {})).toBeNull();
    expect(kdOfficeFirm(F, {}, null)).toBeNull();
    expect(KD_OFFICE_NAME_RX.test('Bajrami Group DOOEL')).toBe(true);
  });

  it('provider data come from the firm record; office settings only fill the gaps', () => {
    const O = { name: 'Стар назив', edb: '999', fee: 3000, vatOn: true, lic: '12/2020', rep: 'Резервен', sig: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    const P = kdProvider(O, BG);
    expect(P).toMatchObject({ name: BG.name, address: 'ул. Пример 1', city: 'Скопје', edb: '4030000000', embs: '7000000', bank: '300-0000000000-00', rep: 'Сопственик Бајрами', repRole: 'Управител', sig: SIG, stamp: STAMP, fee: 3000, lic: '12/2020' });
    expect(P.logo).toBeNull(); // not a stored file id
    const P2 = kdProvider(O, { name: 'Б', settings: {} });
    expect(P2).toMatchObject({ name: 'Б', edb: '999', rep: 'Резервен', sig: O.sig });
    expect(kdProvider(O, null)).toEqual(O);
  });

  it('the contract names the office firm as давател and the client as нарачател', () => {
    const P = kdProvider({ vatOn: true }, BG);
    const cli = { name: 'КЛИЕНТ ДОО', address: 'Битола', edb: '111', embs: '222' };
    const k = { ...kdNew(P, cli, '2026-10-12'), number: 'СУ-001/2026', fee: 1180 };
    const H = kdHtml(k, { firm: cli, firmId: 'c', O: P, img: (id) => `/api/files/${id}` });
    expect(H).toContain('БАЈРАМИ ГРОУП ДООЕЛ СКОПЈЕ');
    expect(H).toContain('КЛИЕНТ ДОО');
    expect(H).toContain('300-0000000000-00'); // bank in the memo
    expect(H.indexOf('БАЈРАМИ ГРОУП')).toBeLessThan(H.indexOf('КЛИЕНТ ДОО'));
    expect(H).toContain('Сопственик Бајрами');
  });
});

describe('employment contract — required elements (ЗРО, marked „за проверка“)', () => {
  const f = { name: 'Фирма ДОО', address: 'ул. 1', city: 'Скопје', edb: '4030' };
  const e = { name: 'Петар Петров', embg: '0101990450001', address: 'Скопје' };
  const c = { type: 'neopr' as const, start: '2026-11-01', position: 'Продавач', workPlace: 'Скопје', hours: 40, gross: 40000, net: 27000, leave: 20, notice: 1, rep: 'Управител', probation: '' as const };
  it('complete contract passes, every item carries a legal reference to verify', () => {
    const L = hrCtLawCheck(c, e, f);
    expect(L.every((x) => x.ok)).toBe(true);
    expect(L.every((x) => x.verify && x.law)).toBe(true);
    expect(L.map((x) => x.k)).toEqual(expect.arrayContaining(['parties', 'start', 'position', 'workPlace', 'term', 'hours', 'pay', 'leave', 'notice']));
  });
  it('missing / unlawful elements are flagged', () => {
    const bad = (k: string, x: object, emp: object = e) => hrCtLawCheck({ ...c, ...x }, emp as typeof e, f).find((i) => i.k === k)!.ok;
    expect(bad('parties', {}, { ...e, embg: '' })).toBe(false);
    expect(bad('term', { type: 'opr', end: '' })).toBe(false);
    expect(bad('term', { type: 'opr', end: '2027-10-31' })).toBe(true);
    expect(bad('leave', { leave: HR_LEAVE_DAYS - 1 })).toBe(false);
    expect(bad('probation', { probation: 7 })).toBe(false);
    expect(bad('pay', { gross: 0 })).toBe(false);
    expect(bad('hours', { hours: 45 })).toBe(false);
    expect(bad('notice', { notice: 0 })).toBe(false);
  });
});
