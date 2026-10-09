import { describe, expect, it } from 'vitest';
import type { LedgerLine } from './ledger';
import { can, entryStatusFor, type Principal } from './rbac';
import {
  addMonths, alCompute, amlCompleteness, amlNextReview, apExtra, apHash, capitalSum, expiry, freshness, gdprDue,
  inspCheck, inspCtx, inspScore, invoiceGaps, klAllowedViews, klSections, lastWorkingDay, maskEmbg, recIsDue, recIssue,
  sharesOk, taskTransition, todaySkopje, tplKinds, tplScanText, tplVars, vatPeriodRange, type FirmSnapshot, INSP,
} from './office';

const ln = (date: string, account: string, debit: number, credit: number, partnerId?: string, journalId?: string): LedgerLine =>
  ({ date, account, debit, credit, partnerId: partnerId ?? null, journalId });

const snap = (o: Partial<FirmSnapshot> = {}): FirmSnapshot => ({
  firm: { id: 'f1', name: 'Тест ДООЕЛ', vatRegistered: true, nkd: '47.11' },
  today: '2026-10-08', ledger: [], partnerNames: { p1: 'Добавувач АД', p2: 'Купувач ДОО' }, dossier: [], pendingClient: 0,
  ...o,
});

describe('dates', () => {
  it('addMonths clamps to the month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', -6)).toBe('2026-02-28');
  });
  it('todaySkopje uses the office time zone', () => {
    expect(todaySkopje(new Date('2026-10-08T22:30:00Z'))).toBe('2026-10-09');
  });
  it('lastWorkingDay skips weekends', () => {
    expect(lastWorkingDay(2026, 4)).toBe('2026-05-29'); // 31 May 2026 is a Sunday
    expect(lastWorkingDay(2026, 13)).toBe('2027-02-26');
  });
  it('vatPeriodRange', () => {
    expect(vatPeriodRange('2026-08-15')).toEqual(['2026-07-01', '2026-09-30']);
    expect(vatPeriodRange('2026-02-15', 'month')).toEqual(['2026-02-01', '2026-02-28']);
  });
});

describe('dossier', () => {
  it('freshness of ЦРМ extracts: 3 / 6 months', () => {
    const c = 'Тековна состојба (ЦРМ)';
    expect(freshness({ category: c, date: '2026-09-01' }, '2026-10-08')!.lvl).toBe('good');
    expect(freshness({ category: c, date: '2026-05-01' }, '2026-10-08')!.lvl).toBe('warn');
    expect(freshness({ category: c, date: '2026-01-01' }, '2026-10-08')!.lvl).toBe('bad');
    expect(freshness({ category: 'Друго', date: '2020-01-01' }, '2026-10-08')).toBeNull();
  });
  it('expiry badge', () => {
    expect(expiry({ category: 'x', validTo: '2026-10-01' }, '2026-10-08')).toEqual({ lvl: 'bad', days: -7 });
    expect(expiry({ category: 'x', validTo: '2026-10-20' }, '2026-10-08')).toEqual({ lvl: 'warn', days: 12 });
    expect(expiry({ category: 'x' }, '2026-10-08')).toBeNull();
  });
});

describe('tasks', () => {
  it('transition appends history and stamps doneAt', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    const r = taskTransition({ status: 'new', hist: [] }, 'done', 'Ана', 'готово', now);
    expect(r.status).toBe('done');
    expect(r.hist).toEqual([{ at: now.toISOString(), by: 'Ана', st: 'done', note: 'готово' }]);
    expect(r.doneAt).toEqual(now);
    expect(taskTransition({ status: 'new', hist: r.hist }, 'progress', 'Б').hist).toHaveLength(2);
  });
});

describe('client portal / klient role', () => {
  const kl: Principal = { id: 'k', role: 'klient', firms: ['f1'] };
  const acc: Principal = { id: 'a', role: 'acc', firms: ['f1'] };
  it('client entries are pending; only the office may approve (FIX #1)', () => {
    expect(entryStatusFor(kl)).toBe('pending');
    expect(can(kl, 'write', 'f1')).toBe(true);
    expect(can(kl, 'office', 'f1')).toBe(false);
    expect(can(acc, 'office', 'f1')).toBe(true);
    expect(can(kl, 'write', 'f2')).toBe(false);
  });
  it('sections: base set by default, explicit toggles win', () => {
    expect(klSections(null).map((s) => s[0])).toEqual(['docs', 'send', 'kdfi', 'metg']);
    expect(klSections({ on: { metg: false, plati: true } }).map((s) => s[0])).toEqual(['docs', 'send', 'kdfi', 'plati']);
    expect(klAllowedViews(null)).toEqual(expect.arrayContaining(['klHome', 'klSend', 'dosie']));
    expect(klAllowedViews(null)).not.toContain('nalozi');
  });
});

describe('recurring', () => {
  const r = { id: 'r1', partnerId: 'p', active: true, next: '2026-10-05', every: 'month' as const, day: 5, dueDays: 15, note: 'Фактура за {месец}', items: [{ name: 'Услуги за месец', qty: 1, price: 6000, vat: 18 }] };
  it('due only when active, arrived and not past end', () => {
    expect(recIsDue(r, '2026-10-08')).toBe(true);
    expect(recIsDue({ ...r, active: false }, '2026-10-08')).toBe(false);
    expect(recIsDue({ ...r, end: '2026-09-30' }, '2026-10-08')).toBe(false);
    expect(recIsDue(r, '2026-10-04')).toBe(false);
  });
  it('issue builds the draft and advances one period', () => {
    const x = recIssue(r, '2026-10-08')!;
    expect(x.invoice).toMatchObject({ date: '2026-10-08', due: '2026-10-23', note: 'Фактура за октомври 2026' });
    expect(x.invoice.items[0]!.name).toBe('Услуги за месец октомври 2026');
    expect(x.next).toBe('2026-11-05');
    expect(x.finished).toBe(false);
    expect(recIssue({ ...r, day: 'L', next: '2026-09-30' }, '2026-10-08')!.invoice.date).toBe('2026-09-30');
  });
});

describe('autopilot checks (alCompute / apExtra)', () => {
  it('flags suppliers paid without invoice, customer prepayments, negative cash and expiring documents', () => {
    const S = snap({
      ledger: [
        ln('2026-03-01', '2200', 5000, 0, 'p1'), ln('2026-03-01', '1000', 0, 5000),
        ln('2026-03-02', '1200', 0, 2000, 'p2'), ln('2026-03-02', '1000', 2000, 0),
        ln('2026-04-01', '1020', 0, 300), ln('2026-04-01', '4400', 300, 0),
      ],
      dossier: [{ category: 'Дозволи и лиценци', title: 'Лиценца', validTo: '2026-10-20' }],
      pendingClient: 2,
    });
    const A = alCompute(S);
    const cats = A.map((a) => `${a.lvl}:${a.cat}`);
    expect(cats).toEqual(['warn:Документи', 'bad:Влезни фактури', 'warn:Излезни фактури', 'bad:Благајна', 'warn:Документи']);
    expect(A[1]!.txt).toContain('Добавувач АД');
    const off = alCompute({ ...S, firm: { ...S.firm, alOff: { 'Благајна': true } } });
    expect(off.some((a) => a.cat === 'Благајна')).toBe(false);
  });
  it('VAT threshold for non-VAT firms', () => {
    const S = snap({ firm: { id: 'f', name: 'x', vatRegistered: false }, ledger: [ln('2026-02-01', '7600', 0, 1_700_000), ln('2026-02-01', '1200', 1_700_000, 0, 'p2')] });
    expect(alCompute(S).find((a) => a.cat === 'ДДВ')!.lvl).toBe('warn');
  });
  it('skips checks whose data belongs to unmerged phases', () => {
    expect(alCompute(snap()).length).toBe(0);
    expect(alCompute(snap({ employees: [{ name: 'A', active: true }], payrollMonths: [] })).length).toBe(0); // before the 15th
    const S = snap({ today: '2026-10-20', employees: [{ name: 'A', active: true }], payrollMonths: [] });
    expect(alCompute(S).find((a) => a.cat === 'Плати')!.txt).toContain('09/2026');
  });
  it('apExtra: daily cash, big cash payments and client messages', () => {
    const S = snap({
      ledger: [
        ln('2026-05-02', '1020', 0, 70000, 'p1', 'j1'), ln('2026-05-02', '2200', 70000, 0, 'p1', 'j1'),
        ln('2026-05-03', '1020', 80000, 0, null as unknown as string, 'j2'), ln('2026-05-03', '7600', 0, 80000, undefined, 'j2'),
      ],
    });
    const X = apExtra(S);
    expect(X.adds.map((a) => a.cat)).toEqual(['Благајна', 'Благајна']);
    expect(X.msgs.map((m) => m.type)).toEqual(['cash', 'inv']);
    expect(X.msgs[1]!.body).toContain('Добавувач АД');
    expect(X.m.rev).toBe(80000);
  });
  it('invoice gaps per series', () => {
    const I = ['1', '2', '4', 'A-1', 'A-2', 'A-3'].map((number) => ({ number, date: '2026-01-10', total: 1, paid: 0 }));
    expect(invoiceGaps(I, '2026')).toEqual([['', [3]]]);
  });
  it('VAT estimate message (legacy step 4): amount due of the ended period, nothing for a non-VAT firm', () => {
    const vatEstimate = { period: '2026-Т3', from: '2026-07-01', to: '2026-09-30', due: '2026-10-25', amount: 12345.6, closed: false };
    const X = apExtra(snap({ vatEstimate }));
    const m = X.msgs.find((x) => x.type === 'vat')!;
    expect(m.body).toContain('12.345');
    expect(m.body).toContain('25.10.2026');
    expect(X.m.vatEst).toBe(12345.6);
    expect(apExtra(snap({ vatEstimate, firm: { id: 'f', name: 'x', vatRegistered: false } })).msgs.some((x) => x.type === 'vat')).toBe(false);
    expect(apExtra(snap({ vatEstimate: { ...vatEstimate, amount: -100 } })).msgs.some((x) => x.type === 'vat')).toBe(false); // refund: no payment
  });
  it('apHash is stable', () => expect(apHash('cash|f1|2026-10')).toBe(apHash('cash|f1|2026-10')));
});

describe('inspection readiness', () => {
  it('applies needs, merges manual confirmations and validity', () => {
    const S = { ...snap({ ledger: [ln('2026-02-01', '1020', 0, 500, undefined, 'j'), ln('2026-02-01', '4400', 500, 0, undefined, 'j')] }), inspEmployees: [{ name: 'Ана', start: '2025-01-01', embg: '0101990450001', position: 'продавач' }] };
    const c = inspCtx(S, { kasaMax: 30000 });
    expect(c.retail).toBe(true);
    const R = inspCheck(c, { u_arch: { d: '2026-01-10', by: 'Ана' }, b_ppz: { d: '2025-01-10' }, d_lang: { na: true } });
    const by = Object.fromEntries(R.map((r) => [r.it.id, r]));
    expect(by.u_kneg!.s).toBe('bad');
    expect(by.u_arch!.s).toBe('ok');
    expect(by.b_ppz!.s).toBe('bad'); // valid 12 months → expired
    expect(by.d_lang!.s).toBe('na');
    expect(by.u_kins!.s).toBe('todo'); // kasaMax > 20000
    expect(by.u_mpin).toBeUndefined(); // payroll data not available → automatic-only check skipped
    expect(by.t_m1!.s).toBe('warn');
    expect(R.length).toBeLessThan(INSP.length);
    expect(inspScore(R).bad).toBeGreaterThan(0);
  });
});

describe('AML', () => {
  it('next review by level and completeness', () => {
    expect(amlNextReview({ lastReview: '2026-01-15' }, 'low', '2026-10-08')).toBe('2029-01-15');
    expect(amlNextReview({}, 'high', '2026-10-08')).toBe('2026-10-08');
    expect(amlCompleteness({ crDate: '2026-01-01', purpose: 'x', source: 'y', pepAsked: false }, null)).toBe(50);
  });
});

describe('formation, GDPR, templates', () => {
  it('capital with a configurable EUR rate (FIX #18)', () => {
    expect(capitalSum([{ name: 'пари', eur: 5000 }, { name: 'опрема', mkd: 61500 }], 61.5)).toEqual({ eur: 6000, mkd: 369000 });
    expect(sharesOk([{ kind: 'ФЛ', name: 'A', share: 60 }, { kind: 'ФЛ', name: 'B', share: 40 }])).toBe(true);
    expect(sharesOk([{ kind: 'ФЛ', name: 'A', share: 60 }, { kind: 'ПЛ', name: 'B', share: 30 }])).toBe(false);
  });
  it('GDPR deadlines and ЕМБГ masking (FIX #5)', () => {
    expect(gdprDue('breach', '2026-10-08')).toBe('2026-10-11');
    expect(gdprDue('request', '2026-10-08')).toBe('2026-11-07');
    expect(maskEmbg('0101990450001')).toBe('01•••••••••01');
  });
  it('template vars and placeholder scan', () => {
    const V = tplVars({ name: 'Фирма', edb: '4030', nkd: '47.11', activity: 'Трговија' }, { name: 'WISE' }, '2026-10-08', { ДОГОВОР_БРОЈ: 'СУ-001/2026' });
    expect(V).toMatchObject({ ДАТУМ: '08.10.2026', ФИРМА: 'Фирма', ФИРМА_ДЕЈНОСТ: '47.11 – Трговија', КАНЦЕЛАРИЈА: 'WISE', ДОГОВОР_БРОЈ: 'СУ-001/2026' });
    expect(V.ФИРМА_ЕМБС).toBeUndefined();
    expect(tplScanText('Се склучува {{ фирма }} и {{ДОГОВОР БРОЈ}} {{ФИРМА}}')).toEqual(['ФИРМА', 'ДОГОВОР_БРОЈ']);
    expect(tplKinds().find((k) => k.key === 'kd')!.vars).toContain('НАДОМЕСТ');
  });
});
