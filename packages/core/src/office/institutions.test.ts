import { describe, expect, it } from 'vitest';
import {
  instDueFromDays, instDueState, instFindings, instFromRead, instFromText, instGuess, instOrderDraft, instPaidNote, instPaymentMatch, instPublicRevenue, instTitle,
} from './institutions';
import { rokGenerate, type RokFirm } from './rokovi';
import { alCompute, type FirmSnapshot } from './autopilot';

const payer = { name: 'Алфа ДООЕЛ', address: 'ул. 1', city: 'Скопје', account: '300000000000017', edb: '4030000000012' };

describe('institutions', () => {
  it('guesses the institution from the name on the document', () => {
    expect(instGuess('Управа за јавни приходи – Регионална дирекција Скопје')).toBe('ujp_ro');
    expect(instGuess('УПРАВА ЗА ЈАВНИ ПРИХОДИ')).toBe('ujp');
    expect(instGuess('Државен пазарен инспекторат')).toBe('dpi');
    expect(instGuess('Државен инспекторат за труд – Подрачна единица Тетово')).toBe('dit');
    expect(instGuess('Агенција за храна и ветеринарство')).toBe('afv');
    expect(instGuess('Фонд за здравствено осигурување на РСМ')).toBe('fzo');
    expect(instGuess('Општина Аеродром')).toBe('opstina');
    expect(instGuess('Извршител Петар Петров')).toBe('izvrsitel');
    expect(instGuess('нешто друго')).toBe('other');
  });

  it('deadline state: overdue / today / within 7 days / ok; finished items do not count', () => {
    const td = '2026-11-20';
    expect(instDueState({ status: 'new', due: '2026-11-19' }, td)).toBe('late');
    expect(instDueState({ status: 'work', due: '2026-11-20' }, td)).toBe('today');
    expect(instDueState({ status: 'new', due: '2026-11-27' }, td)).toBe('soon');
    expect(instDueState({ status: 'new', due: '2026-11-28' }, td)).toBe('ok');
    expect(instDueState({ status: 'new', due: null }, td)).toBe('none');
    expect(instDueState({ status: 'answered', due: '2026-11-01' }, td)).toBe('done');
    expect(instDueFromDays('2026-11-20', 8)).toBe('2026-11-28');
    expect(instDueFromDays(null, 8)).toBeNull();
  });

  it('payment order: КТБ to the Budget with уплатна сметка / приходна шифра / повик, КТД to an account otherwise', () => {
    const tax = { id: 'x', inst: 'ujp', type: 'reshenie', refNo: '12-345/2026', amount: '15000.50', payUplSm: '840-019-02687', payPrihod: '714116 00', payRef: '1234567890' };
    expect(instPublicRevenue(tax)).toBe(true);
    const o = instOrderDraft(tax, payer, '2026-11-20');
    expect(o.kind).toBe('pp50');
    expect(o).toMatchObject({ amount: 15000.5, uplSm: '840-019-02687', prihod: '714116 00', refDebit: '1234567890', recipAcc: '100000000063095' });
    expect(o.purpose).toBe('Плаќање по Решение бр. 12-345/2026 – УЈП');
    const fine = { id: 'y', inst: 'izvrsitel', instName: 'Извршител Петров', type: 'izvrsuvanje', amount: 2000, payAccount: 'MK07 210 0000000000 13', payRef: '55-2026' };
    expect(instPublicRevenue(fine)).toBe(false);
    const k = instOrderDraft(fine, payer, '2026-11-20');
    expect(k).toMatchObject({ kind: 'pp30', recipAcc: '210000000000013', refCredit: '55-2026', amount: 2000, recip: 'Извршител Петров', code: 'GOVT' });
  });

  it('bank match: same amount AND the reference (or the account when no reference); the treasury account alone is not enough', () => {
    const L = [
      { id: 'a', date: '2026-11-21', amount: -15000.5, payRef: '', description: 'ДДВ 1234567890', statementNo: '45', counterAccount: '100000000063095' },
      { id: 'b', date: '2026-11-21', amount: -15000.5, payRef: '999', description: 'друго', counterAccount: '100000000063095' },
      { id: 'c', date: '2026-11-22', amount: -2000, description: 'извршител', counterAccount: '210000000000013' },
      { id: 'd', date: '2026-10-01', amount: -15000.5, payRef: '1234567890' },
    ];
    const it = { id: '1', status: 'new', received: '2026-11-18', amount: '15000.50', payRef: '1234567890' };
    expect(instPaymentMatch(it, L)?.id).toBe('a');
    expect(instPaymentMatch(it, L, new Set(['a']))).toBeNull(); // 'd' is long before the item was received
    expect(instPaymentMatch({ ...it, amount: 14000 }, L)).toBeNull();
    expect(instPaymentMatch({ id: '2', status: 'new', received: '2026-11-18', amount: 2000, payAccount: '210-0000000000-13' }, L)?.id).toBe('c');
    expect(instPaymentMatch({ id: '3', status: 'new', received: '2026-11-18', amount: 15000.5, payAccount: '100000000063095' }, L)).toBeNull();
    expect(instPaidNote(L[0]!)).toBe('✓ платено (извод бр. 45 од 21.11.2026, 15.000,50 ден.)');
  });

  it('AI answer → fields; „во рок од 15 дена“ from the receipt', () => {
    const r = instFromRead({ institution: 'Државен инспекторат за труд', type: 'zapisnik', refNo: '08-12', date: '05.11.2026', due: null, dueDays: 15, amount: '0', subject: 'Доставување на договори за вработување' }, '2026-11-10');
    expect(r).toMatchObject({ inst: 'dit', type: 'zapisnik', refNo: '08-12', date: '2026-11-05', due: '2026-11-25', amount: null });
    expect(instFromRead(null).type).toBe('drugo');
  });

  it('reads a text document without AI', () => {
    const t = `РЕПУБЛИКА СЕВЕРНА МАКЕДОНИЈА
Управа за јавни приходи
Регионална дирекција Скопје
Број: 13-4567/2026
Скопје, 05.11.2026
ОПОМЕНА
До Алфа ДООЕЛ, ЕДБ: 4030000000012
Ве опоменуваме да го платите долгот во износ од 12.345,60 денари најдоцна до 20.11.2026 година.
Уплатна сметка: 840-019-02687, приходна шифра 714116 00, повикување на број 0511202612345`;
    const r = instFromText(t)!;
    expect(r).toMatchObject({ type: 'opomena', refNo: '13-4567/2026', date: '2026-11-05', due: '2026-11-20', amount: 12345.6, uplSm: '840-019-02687', prihod: '714116 00', payRef: '0511202612345', firmEdb: '4030000000012' });
    expect(instFromRead(r).inst).toBe('ujp_ro');
    expect(instFromText('здраво')).toBeNull();
  });

  it('deadlines go to the calendar (type inst, not moved to a workday) and the autopilot (Институции)', () => {
    const f: RokFirm = { id: 'f', name: 'Алфа', vatRegistered: false, vatPeriod: 'quarter', entity: 'co', akont: false, employees: [], inst: [{ id: 'i1', title: 'ДПИ · Записник', due: '2026-11-22', done: false }] };
    const R = rokGenerate(f, '2026-11-01', '2026-11-30').filter((r) => r.type === 'inst');
    expect(R).toEqual([expect.objectContaining({ key: 'inst:i1', due: '2026-11-22', link: 'institucii', done: false })]);
    const items = [
      { id: '1', inst: 'ujp', type: 'opomena', refNo: '1', status: 'new', due: '2026-11-19', amount: '100', paidOn: null },
      { id: '2', inst: 'dit', type: 'baranje_dok', status: 'work', due: '2026-11-25', amount: null },
      { id: '3', inst: 'dpi', type: 'reshenie', status: 'new', due: '2026-12-30' },
    ];
    const A = instFindings(items, '2026-11-20');
    expect(A.map((a) => a.lvl)).toEqual(['bad', 'warn']);
    expect(A[0]!.txt).toBe('УЈП · Опомена бр. 1: рокот истече на 19.11.2026, за плаќање 100,00 ден.');
    expect(instTitle(items[1]!)).toBe('ДИТ · Барање за документи / податоци');
    const S = { firm: { id: 'f', name: 'Алфа', vatRegistered: false }, today: '2026-11-20', ledger: [], partnerNames: {}, dossier: [], pendingClient: 0, inst: items } as FirmSnapshot;
    expect(alCompute(S).filter((x) => x.cat === 'Институции').map((x) => x.go)).toEqual(['institucii', 'institucii']);
  });
});
