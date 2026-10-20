import { describe, expect, it } from 'vitest';
import {
  elDeadlines, elHtml, elNew, elNormalize, elNumber, elStatus, elValidTo, ethicsText, ethicsTraining, ifacReview, qcNormalize, qcStatus, qcValidate,
  QC_ACCEPT, QC_REVIEW, type QcAuto,
} from './ifac';

const O = { name: 'WISE CONSULTING', city: 'Скопје', address: 'ул. 1', edb: '4030000000000', rep: 'Управител Офис', fee: 3000, feeMode: 'net' as const, docDay: 7 };
const F = { name: 'АЛФА ДООЕЛ', city: 'Тетово', address: 'ул. 2', edb: '4028000000000', signer: 'Ана Анева' };

describe('ISRS 4410 engagement letter', () => {
  it('new letter from the contract, number, normalise', () => {
    const l = elNew(O, F, 2026, '2026-10-20', { number: 'СУ-004/2026', fee: 4000, feeMode: 'gross', svc: ['book', 'vat', 'pay', 'year', 'xx'], docDay: 5 });
    expect(l).toMatchObject({ year: 2026, place: 'Скопје', rep: 'Ана Анева', fee: 4000, feeMode: 'gross', contractNo: 'СУ-004/2026', docDay: 5, svc: ['book', 'vat', 'pay', 'year'], framework: 'mk' });
    expect(elNew(O, F, 2026, '2026-10-20').svc).toEqual(['book', 'pay', 'vat', 'year']);
    expect(elNumber(3, 2026)).toBe('ПА-003/2026');
    const n = elNormalize({ year: 1990, fee: '1.500,5', svc: ['vat', 7], framework: 'zz', docDay: 40, signed: { at: 'x' } } as never, '2026-10-20');
    expect(n).toMatchObject({ year: 2026, svc: ['vat'], framework: 'mk', docDay: 28, signed: null, date: '2026-10-20' });
    expect(elValidTo({ year: 2026 })).toBe('2026-12-31');
    expect(elStatus(null)[0]).toBe('нема писмо');
    expect(elStatus({ number: 'x', signed: { at: '2026-01-10' } })[1]).toBe('good');
  });
  it('deadlines follow the scope', () => {
    const D = elDeadlines({ svc: ['vat', 'pay', 'year'], docDay: 5, year: 2026 }).map(([a, b]) => `${a}: ${b}`).join(' | ');
    expect(D).toContain('ДДВ пријава');
    expect(D).toContain('до 15.03.2027');
    expect(elDeadlines({ svc: ['book'], docDay: 5, year: 2026 }).some(([a]) => a.includes('ДДВ'))).toBe(false);
  });
  it('the letter has the ISRS 4410 §24 contents and both signature lines', () => {
    const l = { ...elNew(O, F, 2026, '2026-10-20', { fee: 3000, feeMode: 'net' }), number: 'ПА-001/2026' };
    const h = elHtml(l, { firm: F, firmId: 'f1', O: { ...O, vatOn: true }, img: (id) => id, draftMark: true });
    for (const t of ['ПИСМО ЗА АНГАЖМАН', 'ISRS 4410', 'не е ревизија', 'Применлива рамка', 'Одговорности на раководството', 'Извештај за составување', 'IESBA', 'УФР', 'Рокови', '3.000,00', '3.540,00', 'АЛФА ДООЕЛ', 'WISE CONSULTING', 'Потврдено и прифатено', 'до 31.12.2026', 'НАЦРТ', 'Контролен код']) expect(h).toContain(t);
    const s = elHtml({ ...l, signed: { at: '2026-11-02', name: 'Ана Анева' } }, { firm: F, firmId: 'f1', O, img: (id) => id, draftMark: true });
    expect(s).not.toContain('НАЦРТ');
    expect(s).toContain('02.11.2026');
    // without the year-end service there is no compilation report
    expect(elHtml({ ...l, svc: ['book'] }, { firm: F, firmId: 'f1', O, img: (id) => id })).not.toContain('Извештај за составување');
  });
});

describe('ISQM 1 checklist', () => {
  const auto: QcAuto = { aml: { level: 'mid', last: '2026-02-01', next: '2028-02-01' }, ethics: { signed: 3, total: 3 }, contract: true, letter: 'signed' };
  const manual = Object.fromEntries(QC_ACCEPT.filter((x) => !x.auto).map((x) => [x.k, true]));
  const rev = Object.fromEntries(QC_REVIEW.map((x) => [x.k, true]));
  const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
  it('normalise keeps only the known manual items', () => {
    expect(qcNormalize({ acc: { integrity: true, aml: true, zz: true }, rev: { tb: true, x: true }, decision: 'nope', preparedBy: 'bad' } as never))
      .toMatchObject({ acc: { integrity: true }, rev: { tb: true }, decision: null, preparedBy: null });
  });
  it('the reviewer is a second person, with a date', () => {
    expect(qcValidate(qcNormalize({ preparedBy: A, reviewedBy: A, reviewedOn: '2027-03-01' } as never))).toMatch(/второ лице/);
    expect(qcValidate(qcNormalize({ preparedBy: A, reviewedBy: B } as never))).toMatch(/датумот/);
    expect(qcValidate(qcNormalize({ decision: 'accept' } as never))).toMatch(/кој и кога/);
    expect(qcValidate(qcNormalize({ preparedBy: A, reviewedBy: B, reviewedOn: '2027-03-01' } as never))).toBeNull();
  });
  it('status with the system facts', () => {
    const q = qcNormalize({ acc: manual, decision: 'continue', decidedBy: A, decidedOn: '2026-01-15', rev, preparedBy: A, reviewedBy: B, reviewedOn: '2027-03-01' } as never);
    const s = qcStatus(q, auto, '2026-10-20');
    expect([s.accept.ok, s.review.ok, s.ok]).toEqual([true, true, true]);
    // expired УФР analysis, one declaration missing, no letter → acceptance not complete
    const s2 = qcStatus(q, { ...auto, aml: { level: 'high', last: '2024-01-01', next: '2025-01-01' }, ethics: { signed: 2, total: 3 }, letter: null }, '2026-10-20');
    expect(s2.accept.ok).toBe(false);
    expect(s2.accept.items.filter((x) => !x.ok).map((x) => x.k)).toEqual(['aml', 'ethics', 'letter']);
    expect(s2.accept.items.find((x) => x.k === 'aml')!.info).toContain('истечена');
    // no УФР file: the manual risk counts for the risk item
    const s3 = qcStatus({ ...q, risk: 'low' }, { ...auto, aml: null }, '2026-10-20');
    expect(s3.accept.items.find((x) => x.k === 'risk')!.ok).toBe(true);
    expect(qcStatus({ ...q, reviewedBy: A }, auto, '2026-10-20').review).toMatchObject({ second: false, ok: false });
  });
});

describe('IESBA declaration', () => {
  it('text with the five principles, the ISO training record', () => {
    const T = ethicsText('WISE CONSULTING', 'Бесник Б.', 2026).join('\n');
    for (const t of ['IESBA', 'Интегритет', 'Објективност', 'компетентност', 'Доверливост', 'Професионално однесување', 'перење пари']) expect(T).toContain(t);
    const R = [{ userId: 'a', name: 'А', at: '2026-01-10' }, { userId: 'b', name: 'Б', at: null }];
    expect(ethicsTraining(R, 'WISE', 2026)).toMatchObject({ title: 'Кодекс на етика (IESBA) – годишни изјави 2026', status: 'progress', data: { who: 'А', date: '2026-01-10' } });
    expect(ethicsTraining(R.map((r) => ({ ...r, at: '2026-02-01' })), 'WISE', 2026).status).toBe('done');
  });
  it('the year in the management review', () => {
    const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
    const rev = Object.fromEntries(QC_REVIEW.map((x) => [x.k, true]));
    const V = ifacReview([
      { kind: 'letter', year: 2026, subject: 'f1', status: 'signed', data: {} },
      { kind: 'letter', year: 2026, subject: 'f2', status: 'draft', data: {} },
      { kind: 'qc', year: 2026, subject: 'f1', status: 'reviewed', data: { decision: 'continue', decidedOn: '2026-01-02', rev, preparedBy: A, reviewedBy: B, reviewedOn: '2027-03-01' } },
      { kind: 'qc', year: 2026, subject: 'f2', status: 'open', data: { decision: 'decline' } },
      { kind: 'ethics', year: 2026, subject: 'u1', status: 'signed', data: {} },
      { kind: 'letter', year: 2025, subject: 'f3', status: 'signed', data: {} },
    ], 2026, 3, 2);
    expect(V).toEqual({ firms: 3, letters: { signed: 1, draft: 1, missing: 1 }, accept: { decided: 1, declined: 1 }, review: { done: 1 }, ethics: { signed: 1, total: 2 } });
  });
});
