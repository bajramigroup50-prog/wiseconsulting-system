import { describe, expect, it } from 'vitest';
import {
  cleanNorms, consumptionChanged, idsDue, idsState, kitchenReport, mealConsumption, memberActive, membersDue, membersState, nextReceiptNo,
  normOrgan, parseDateCell, parseMembers, portionsByDay, withoutConsent,
} from './npo';
import { rokGenerate, type RokFirm } from './office/rokovi';
import { klAllowedViews } from './office/portal';
import { viewEnabled } from './industry/modules';

const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';

describe('consent', () => {
  it('lists the active beneficiaries without a consent date', () => {
    expect(withoutConsent([{ consentDate: '2026-11-01', active: true }, { consentDate: null, active: true }, { consentDate: null, active: false }])).toHaveLength(1);
  });
});

describe('members register', () => {
  it('is due 2 years after the last update; warns 60 days before and after', () => {
    expect(membersDue('2024-11-21')).toBe('2026-11-21');
    expect(membersState(null, '2026-11-21')).toBe('never');
    expect(membersState('2024-11-01', '2026-11-21')).toBe('late');
    expect(membersState('2024-12-15', '2026-11-21')).toBe('soon');
    expect(membersState('2026-01-10', '2026-11-21')).toBe('ok');
  });

  it('reads an Excel sheet with Macedonian or Albanian headers, dates and organs', () => {
    const r = parseMembers([
      ['Регистар на членови'],
      ['Име и презиме', 'ЕМБГ', 'Адреса', 'Телефон', 'Зачленет', 'Исчленет', 'Орган', 'Функција'],
      ['Шкељким Укшини', '0101980450011', 'Кичево', '070 111 222', '15.03.2024', '', 'управен одбор', 'Претседател'],
      ['', '', '', '', '', '', '', ''],
      ['', 'x'],
      ['Ana Ana', '', '', '', 45292, '2025-12-31', 'Kuvendi', 'anëtar'],
    ]);
    expect(r.skipped).toBe(1);
    expect(r.list).toEqual([
      { name: 'Шкељким Укшини', embg: '0101980450011', address: 'Кичево', phone: '070 111 222', email: null, joined: '2024-03-15', left: null, organ: 'Управен одбор', role: 'претседател', note: null },
      { name: 'Ana Ana', embg: null, address: null, phone: null, email: null, joined: '2024-01-01', left: '2025-12-31', organ: 'Собрание', role: 'anëtar', note: null },
    ]);
    expect(parseDateCell('2024')).toBe('2024-01-01');
    expect(parseDateCell('abc')).toBeNull();
    expect(normOrgan('Надзорен одбор')).toBe('Надзорен одбор');
    expect(memberActive({ joined: '2024-01-01', left: '2025-12-31' }, '2026-01-01')).toBe(false);
  });
});

describe('УЈП-ИДС/ПР', () => {
  it('is due 30 days after the fulfilment (else the confirmation date) and has a state', () => {
    expect(idsDue({ fulfilledDate: '2026-11-18' })).toBe('2026-12-18');
    expect(idsDue({ confDate: '2026-11-01' })).toBe('2026-12-01');
    expect(idsDue({})).toBeNull();
    const T = '2026-11-21';
    expect(idsState({ role: 'given', confDate: '2026-11-01' }, T)).toBe('na');
    expect(idsState({ role: 'received' }, T)).toBe('wait');
    expect(idsState({ role: 'received', fulfilledDate: '2026-10-01' }, T)).toBe('late');
    expect(idsState({ role: 'received', fulfilledDate: '2026-10-25' }, T)).toBe('soon');
    expect(idsState({ role: 'received', fulfilledDate: '2026-11-18' }, T)).toBe('open');
    expect(idsState({ role: 'received', fulfilledDate: '2026-10-01', idsFiled: '2026-10-20' }, T)).toBe('filed');
  });

  it('goes to the deadline calendar (moved to a working day), with the members register', () => {
    const f: RokFirm = {
      id: 'f', name: 'Здружение', vatRegistered: false, vatPeriod: 'quarter', entity: 'npo', employees: [],
      donIds: [{ id: 'd1', title: 'УЈП-ИДС/ПР – донација 1/2026 од КИППЕР', due: '2026-12-19', done: false }], npoReg: '2026-12-10',
    };
    const R = rokGenerate(f, '2026-12-01', '2026-12-31');
    expect(R.find((r) => r.type === 'donids')).toMatchObject({ key: 'donids:d1', due: '2026-12-21', link: 'donacii', done: false });
    expect(R.find((r) => r.type === 'npoReg')).toMatchObject({ due: '2026-12-10', link: 'clenovi' });
  });
});

describe('kitchen stock', () => {
  it('cleans the normatives and computes portions × quantity per item', () => {
    const N = cleanNorms({ b: [{ itemId: U1, qty: '0,15' }, { itemId: U1, qty: 0.05 }, { itemId: 'x', qty: 1 }], l: [{ itemId: U2, qty: 0.2 }, { itemId: U1, qty: 0 }], zz: [] });
    expect(N).toEqual({ b: [{ itemId: U1, qty: 0.2 }], l: [{ itemId: U2, qty: 0.2 }] });
    const P = portionsByDay([{ id: 'a', members: 5 }, { id: 'b', members: 3 }], [
      { beneficiaryId: 'a', date: '2026-11-20', meal: 'b' }, { beneficiaryId: 'b', date: '2026-11-20', meal: 'b' }, { beneficiaryId: 'a', date: '2026-11-20', meal: 'l' }, { beneficiaryId: 'zz', date: '2026-11-20', meal: 'l' },
    ]);
    expect(P.get('2026-11-20')).toEqual({ b: 8, l: 5, d: 0 });
    const C = mealConsumption(P.get('2026-11-20')!, N);
    expect(C).toEqual([{ itemId: U1, qty: 1.6 }, { itemId: U2, qty: 1 }]);
    expect(consumptionChanged(C, [{ itemId: U2, qty: 1 }, { itemId: U1, qty: 1.6 }])).toBe(false);
    expect(consumptionChanged(C, [{ itemId: U1, qty: 1.6 }])).toBe(true);
  });

  it('reports received / used / left per item and the real cost per portion', () => {
    const K = kitchenReport([
      { itemId: U1, date: '2026-10-30', qty: 10, value: 500, sourceType: 'purchase' },
      { itemId: U1, date: '2026-11-02', qty: 20, value: 1000, sourceType: 'don_receipt' },
      { itemId: U1, date: '2026-11-03', qty: -12, value: -600, sourceType: 'meal_issue' },
      { itemId: U1, date: '2026-11-04', qty: -1, value: -50, sourceType: 'manual_move' },
      { itemId: U1, date: '2026-12-01', qty: -5, value: -250, sourceType: 'meal_issue' },
    ], '2026-11-01', '2026-11-30', 40);
    expect(K.rows[0]).toMatchObject({ open: 10, inQ: 20, donQ: 20, useQ: 12, othQ: 1, close: 17, useV: 600 });
    expect(K.tot).toMatchObject({ inV: 1000, donV: 1000, useV: 600, closeV: 850 });
    expect(K.perPortion).toBe(15);
  });

  it('numbers the donation receipts per year', () => {
    expect(nextReceiptNo([{ number: '1/2026', date: '2026-01-05' }, { number: '2/2026', date: '2026-02-01' }, { number: '9/2025', date: '2025-12-01' }], '2026')).toBe('3/2026');
  });
});

describe('module and portal', () => {
  it('the members register is part of the meals module and has its own portal section', () => {
    expect(viewEnabled('clenovi', ['meals'], { hasFirm: true, client: true })).toBe(true);
    expect(viewEnabled('clenovi', [], { hasFirm: true, client: true })).toBe(false);
    expect(klAllowedViews({ on: { clen: true } }, ['meals'])).toContain('clenovi');
  });
});
