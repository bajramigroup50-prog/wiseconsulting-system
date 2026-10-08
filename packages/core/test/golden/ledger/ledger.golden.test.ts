/**
 * Golden tests: packages/core/src/ledger.ts vs the effective legacy functions (legacy/index.html).
 * Deliberate fixes (LEGACY-MAP §2.4) are kept out of these fixtures and covered by unit tests instead.
 */
import { describe, expect, it } from 'vitest';
import {
  accountCard, assignNumbers, balances, buildOpening, closeYearLines, csvToGrid, dropSummaryRows, nalogNumber,
  openYearLines, parseAmount, parseOpeningSheet, remapResultAccounts, sumPref, trialBalance, type LedgerLine, type NumberableJournal, type ObRow,
} from '../../../src/ledger';
import { csvFile, loadLegacy, type LLine } from './legacy';

/* A small but complete business year: opening, invoices (one credit note), purchases (one import, one cash),
   bank statements on two accounts, payroll, depreciation, manual journals, VAT close. */
const Y = 2026;
const LL: LLine[] = [
  { k: '1000', d: 50000, p: 0, date: '2026-01-01', src: 'Почетна', docId: 'open-2026', kind: 'open', label: 'Почетна состојба' },
  { k: '1200', d: 12000, p: 0, date: '2026-01-01', src: 'Почетна', docId: 'open-2026', kind: 'open', partner: 'p1', label: 'Почетна состојба' },
  { k: '2200', d: 0, p: 8000, date: '2026-01-01', src: 'Почетна', docId: 'open-2026', kind: 'open', partner: 'p2', label: 'Почетна состојба' },
  { k: '9000', d: 0, p: 54000, date: '2026-01-01', src: 'Почетна', docId: 'open-2026', kind: 'open', label: 'Почетна состојба' },
  { k: '1200', d: 23600, p: 0, date: '2026-01-15', src: 'Излез', docId: 'i1', partner: 'p1', label: 'Фактура 1' },
  { k: '7400', d: 0, p: 20000, date: '2026-01-15', src: 'Излез', docId: 'i1', label: 'Фактура 1' },
  { k: '230018', d: 0, p: 3600, date: '2026-01-15', src: 'Излез', docId: 'i1', label: 'Фактура 1' },
  { k: '1200', d: -1180, p: 0, date: '2026-02-20', src: 'Излез', docId: 'i2', partner: 'p1', label: 'Одобрение 2' },
  { k: '7400', d: 0, p: -1000, date: '2026-02-20', src: 'Излез', docId: 'i2', label: 'Одобрение 2' },
  { k: '230018', d: 0, p: -180, date: '2026-02-20', src: 'Излез', docId: 'i2', label: 'Одобрение 2' },
  { k: '4100', d: 5000, p: 0, date: '2026-02-03', src: 'Влез', docId: 'u1', label: 'Влезна ф-ра 7' },
  { k: '130018', d: 900, p: 0, date: '2026-02-03', src: 'Влез', docId: 'u1', label: 'Влезна ф-ра 7' },
  { k: '2200', d: 0, p: 5900, date: '2026-02-03', src: 'Влез', docId: 'u1', partner: 'p2', label: 'Влезна ф-ра 7' },
  { k: '6600', d: 3000, p: 0, date: '2026-04-11', src: 'Влез', docId: 'u2', label: 'Влезна ф-ра 8' },
  { k: '2210', d: 0, p: 3000, date: '2026-04-11', src: 'Влез', docId: 'u2', partner: 'p2', label: 'Влезна ф-ра 8' },
  { k: '4400', d: 590, p: 0, date: '2026-05-02', src: 'Влез', docId: 'u3', label: 'Влезна ф-ра 9' },
  { k: '1020', d: 0, p: 590, date: '2026-05-02', src: 'Влез', docId: 'u3', label: 'Влезна ф-ра 9' },
  { k: '1000', d: 10000, p: 0, date: '2026-03-01', src: 'Извод', docId: 'izv-a-2026-03-01', label: 'Извод' },
  { k: '1200', d: 0, p: 10000, date: '2026-03-01', src: 'Извод', docId: 'izv-a-2026-03-01', partner: 'p1', label: 'Извод' },
  { k: '1030', d: 0, p: 2000, date: '2026-07-07', src: 'Извод', docId: 'izv-e-2026-07-07', label: 'Извод' },
  { k: '2200', d: 2000, p: 0, date: '2026-07-07', src: 'Извод', docId: 'izv-e-2026-07-07', partner: 'p2', label: 'Извод' },
  { k: '4200', d: 6000, p: 0, date: '2026-04-10', src: 'Плати', docId: 'pay-03', label: 'Плата 2026-03' },
  { k: '2400', d: 0, p: 6000, date: '2026-04-10', src: 'Плати', docId: 'pay-03', label: 'Плата 2026-03' },
  { k: '4300', d: 1200, p: 0, date: '2026-12-31', src: 'Амортизација', docId: 'dep-2026', kind: 'amort', label: 'Амортизација' },
  { k: '0190', d: 0, p: 1200, date: '2026-12-31', src: 'Амортизација', docId: 'dep-2026', kind: 'amort', label: 'Амортизација' },
  { k: '4400', d: 700, p: 0, date: '2026-03-05', src: 'Налог', docId: 'j1', label: 'Рачен налог' },
  { k: '1000', d: 0, p: 700, date: '2026-03-05', src: 'Налог', docId: 'j1', label: 'Рачен налог' },
  { k: '4460', d: 120, p: 0, date: '2026-02-01', src: 'Налог', docId: 'j2', label: 'Провизија' },
  { k: '1000', d: 0, p: 120, date: '2026-02-01', src: 'Налог', docId: 'j2', label: 'Провизија' },
  { k: '4460', d: 80, p: 0, date: '2026-06-01', src: 'Налог', docId: 'j3', label: 'Провизија' },
  { k: '1000', d: 0, p: 80, date: '2026-06-01', src: 'Налог', docId: 'j3', label: 'Провизија' },
  { k: '230018', d: 3420, p: 0, date: '2026-03-31', src: 'ДДВ', docId: 'ddv-2026-Т1', kind: 'ddv', label: 'ДДВ' },
  { k: '130018', d: 0, p: 900, date: '2026-03-31', src: 'ДДВ', docId: 'ddv-2026-Т1', kind: 'ddv', label: 'ДДВ' },
  { k: '23008', d: 0, p: 2520, date: '2026-03-31', src: 'ДДВ', docId: 'ddv-2026-Т1', kind: 'ddv', label: 'ДДВ' },
];

const ours: LedgerLine[] = LL.map((l) => ({
  account: l.k, debit: l.d, credit: l.p, date: l.date, partnerId: l.partner ?? null, kind: l.kind ?? null, journalId: l.docId,
}));

const firm = { banks: [{ id: 'a', name: 'Банка А', konto: '1000' }, { id: 'e', name: 'Банка Е', konto: '1030', cur: 'EUR' }], per: 'quarter' };
const data = {
  invoices: [{ id: 'i1', number: '1' }, { id: 'i2', number: '2', credit: true }],
  purchases: [{ id: 'u1' }, { id: 'u2', imp: true }, { id: 'u3', cash: true }],
  journal: [{ id: 'j1', nalNo: '' }, { id: 'j2' }, { id: 'j3', nalNo: '6/1-3' }, { id: 'open-2026', kind: 'open' }, { id: 'dep-2026', kind: 'amort' }, { id: 'ddv-2026-Т1', kind: 'ddv' }],
  partners: [{ id: 'p1', name: 'Купувач' }, { id: 'p2', name: 'Добавувач' }],
};
const env = () => loadLegacy({ year: Y, lines: LL, firm, data });

const sortL = <T extends { account: string; debit: number; credit: number; partnerId?: string | null }>(L: T[]) =>
  L.map((l) => [l.account, l.debit, l.credit, l.partnerId ?? ''] as const).sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1));
const fromLegacy = (L: { k: string; d: number; p: number; partner?: string }[]) =>
  sortL(L.map((l) => ({ account: String(l.k), debit: +l.d || 0, credit: +l.p || 0, partnerId: l.partner ?? null })));

describe('golden: balances / sumPref', () => {
  it('match legacy', () => {
    const { fn } = env();
    const B = fn.balances!(LL);
    expect(balances(ours)).toEqual(JSON.parse(JSON.stringify(B)));
    for (const p of [['1'], ['4', '!44'], ['2', '!23'], ['7']]) expect(sumPref(balances(ours), p, -1)).toBe(fn.sumPref!(B, p, -1));
  });
});

describe('golden: trial balance (bbRows)', () => {
  const cases: [string, string, string, boolean, string, string][] = [
    ['a', '2026-01-01', '2026-12-31', false, '', ''],
    ['1', '2026-01-01', '2026-12-31', false, '', ''],
    ['2', '2026-02-01', '2026-06-30', false, '', ''],
    ['3', '2026-01-01', '2026-12-31', true, '', ''],
    ['4', '2026-01-01', '2026-09-30', false, 'p1', ''],
    ['a', '2026-01-01', '2026-12-31', false, '', '1200'],
    ['a', '2026-01-01', '2026-12-31', false, '', '2200'],
  ];
  it.each(cases)('level %s %s..%s close=%s partner=%s byPart=%s', (lvl, from, to, withClose, pf, byPart) => {
    const { fn } = env();
    const L = JSON.parse(JSON.stringify(fn.bbRows!(lvl, from, to, withClose, pf, byPart))) as Record<string, unknown>[];
    const tb = trialBalance(ours, {
      level: lvl as 'a', from, to, withClose, partnerId: pf || null, byPartnerOf: byPart || null,
      accountName: () => '', partnerName: (id) => data.partners.find((p) => p.id === id)?.name,
    });
    expect(tb.rows).toEqual(L.map(({ k, name, od, op, td, tp, vd, vp, s }) => ({ k, name, od, op, td, tp, vd, vp, s })));
  });
});

describe('golden: account card (kkData)', () => {
  const cases: [string, boolean, string, boolean, string, string][] = [
    ['1000', false, '', false, '2026-01-01', '2026-12-31'],
    ['1000', false, '', false, '2026-03-01', '2026-06-30'],
    ['12', true, '', false, '2026-02-01', '2026-12-31'],
    ['1200', false, 'p1', false, '2026-01-01', '2026-12-31'],
    ['2200', false, '', true, '2026-01-01', '2026-12-31'],
    ['4', true, '', false, '2026-01-01', '2026-12-31'],
  ];
  it.each(cases)('konto %s sub=%s partner=%s noP=%s %s..%s', (k, sub, p, noP, from, to) => {
    const lg = loadLegacy({ year: Y, lines: LL, firm, data, state: { kkK: k, kkSub: sub, kkP: p, kkNoP: noP, kkFrom: from, kkTo: to } });
    lg.ctx.nalogMap = () => new Map();
    const X = lg.fn.kkData!();
    const c = accountCard(ours, { account: k, sub, partnerId: p || null, noPartner: noP, from, to });
    expect([c.opening, c.debit, c.credit]).toEqual([X.o, X.D, X.P]);
    expect(c.rows.map((r) => [r.line.account, r.line.debit, r.line.credit, r.balance]))
      .toEqual(X.rows.map((r: any) => [r.l.k, r.l.d, r.l.p, r.s]));
  });
});

describe('golden: nalog numbering (nalogMap)', () => {
  const kindOf: Record<string, NumberableJournal['kind']> = { i1: 'izlez', i2: 'odobr', u1: 'vlez', u2: 'vlezDev', u3: 'kasa' };
  const journals = (): NumberableJournal[] => {
    const seen = new Map<string, NumberableJournal>();
    for (const l of LL) {
      if (seen.has(l.docId!)) continue;
      const j = data.journal.find((x) => x.id === l.docId) as { nalNo?: string } | undefined;
      const kind = kindOf[l.docId!] ?? (l.src === 'Извод' ? 'bank' : l.src === 'Плати' ? 'plati' : l.kind ?? 'manual');
      seen.set(l.docId!, {
        id: l.docId!, kind, date: l.date, number: j?.nalNo || null,
        bankAccountId: l.src === 'Извод' ? l.docId!.slice(4, -11) : null,
        payMonth: l.src === 'Плати' ? +(l.label!.match(/\d{4}-(\d{2})/)![1]!) : undefined,
      });
    }
    return [...seen.values()];
  };
  const legacyNos = (settings: Record<string, unknown>) => {
    const { fn } = loadLegacy({ year: Y, lines: LL, firm: { ...firm, ...settings }, data });
    const M: Map<string, { no: string | number }> = fn.nalogMap!();
    const out = new Map<string, string>();
    for (const [k, g] of M) if (k.includes('|') && !k.startsWith('N|')) out.set(k.split('|').slice(1).join('|'), String(g.no));
    return out;
  };
  const S = (s: Record<string, unknown>) => ({ ...s, banks: firm.banks });

  it('period mode, quarterly (default)', () => {
    expect(Object.fromEntries(assignNumbers(journals(), S({}), { vatPeriod: 'quarter' }))).toEqual(Object.fromEntries(legacyNos({})));
  });
  it('period mode, monthly, custom codes, payroll per year', () => {
    const st = { nalogPer: 'month', nalCodes: { vlez: '20', izlez: '10' }, nalPayPer: 'year' } as const;
    expect(Object.fromEntries(assignNumbers(journals(), S(st), { vatPeriod: 'quarter' }))).toEqual(Object.fromEntries(legacyNos(st)));
  });
  it('per-document mode', () => {
    const js = journals().map((j) => ({ ...j, number: null }));
    const { fn } = loadLegacy({ year: Y, lines: LL, firm: { ...firm, nalogMode: 'doc' }, data: { ...data, journal: data.journal.map((j) => ({ ...j, nalNo: '' })) } });
    const M: Map<string, { no: number }> = fn.nalogMap!();
    const legacy = Object.fromEntries([...M].map(([k, g]) => [k.split('|').slice(1).join('|'), String(g.no)]));
    expect(Object.fromEntries(assignNumbers(js, { nalogMode: 'doc' }))).toEqual(legacy);
  });
  it('single-journal numbering agrees with the batch numbering', () => {
    for (const j of journals()) {
      const n = nalogNumber({ kind: j.kind, date: j.date, settings: S({}), bankAccountId: j.bankAccountId, payMonth: j.payMonth, vatPeriod: 'quarter' });
      if (n.no) expect(assignNumbers(journals(), S({}), { vatPeriod: 'quarter' }).get(j.id)).toBe(j.number || n.no);
    }
  });
});

describe('golden: close / open year', () => {
  it('closeYear', async () => {
    const lg = env();
    await lg.fn.closeYear!();
    const s = lg.saved.at(-1)!.obj;
    // legacy without ДБ data booked 10 % × max(0, profit); the tax is now always passed in (Phase 8)
    const r = closeYearLines(ours, { tax: s.tax });
    expect([r.profit, r.tax, r.net]).toEqual([s.profit, s.tax, s.net]);
    expect(sortL(r.lines)).toEqual(fromLegacy(s.lines));
  });
  it('openYear after close (951 → 950, per partner)', async () => {
    const lg = env();
    await lg.fn.closeYear!();
    const close: LLine[] = lg.saved.at(-1)!.obj.lines.map((l: LLine) => ({ ...l, date: '2026-12-31', kind: 'close', src: 'Затворање', docId: 'close-2026' }));
    const lg2 = loadLegacy({ year: Y, lines: [...LL, ...close], firm, data });
    await lg2.fn.openYear!();
    const s = lg2.saved.at(-1)!.obj;
    expect(s.id).toBe('open-2027');
    const mine = openYearLines([...ours, ...close.map((l) => ({ account: l.k, debit: l.d, credit: l.p, date: l.date, kind: 'close', partnerId: null }))]);
    expect(sortL(mine)).toEqual(fromLegacy(s.lines));
  });
  it('obResLines', () => {
    const { fn } = env();
    const L = [{ k: '951', d: 0, p: 100 }, { k: '950', d: 0, p: 40 }, { k: '961', d: 30, p: 0 }, { k: '1000', d: 5, p: 0, partner: 'x' }];
    const legacy = fn.obResLines!(L.map((l) => ({ ...l })));
    const mine = L.map((l) => ({ account: l.k, debit: l.d, credit: l.p, partnerId: l.partner ?? null }));
    expect(sortL(remapResultAccounts(mine))).toEqual(fromLegacy(legacy));
  });
});

describe('golden: opening balance import', () => {
  const CSV = [
    'Аналитички бруто биланс;;;;;',
    'Конто;Назив;Комитент;ЕДБ;Салдо;',
    ';;;;Должи;Побарува',
    '1000;Жиро сметка;;;1.250,50;',
    '1200;Купувачи;;;;',
    ';;Алфа Трејд;4030990123456;300,00;0',
    ';;Нов купувач;123;200;0',
    '1200;Вкупно 1200;;;500;0',
    '120;Купувачи синтетика;;;500;0',
    '2200;Добавувачи;;;;',
    ';;Бета;;0;900',
    '4400;Трошоци;;;100;',
    '7400;Приходи;;;;150',
    '9000;Капитал;;;;800,5',
  ].join('\n');
  const partners = [{ id: 'p1', name: 'Алфа Трејд', edb: '4030990123456' }, { id: 'p2', name: 'Бета' }];

  it('parseAmount', () => {
    const { fn } = env();
    for (const v of ['1.234,56', '1,234.56', '12,5', '-7', '', ' 1 000,00', 'abc', 42]) expect(parseAmount(v)).toBe(fn.parseAmount!(v));
  });
  it('obSheet (header with two rows, analytic rows, totals) and headerless CSV', async () => {
    const { fn } = env();
    const L = await fn.obSheet!(csvFile(CSV));
    const R = parseOpeningSheet(csvToGrid(CSV))!;
    expect(R.rows).toEqual(JSON.parse(JSON.stringify(L.rows)));
    expect(R.totals).toEqual(JSON.parse(JSON.stringify(L.totals)));
    const plain = '1000;Банка;100,50;0\n2200;Добавувачи;0;100,50\n1300;ДДВ;-20';
    const L2 = await fn.obSheet!(csvFile(plain));
    expect(parseOpeningSheet(csvToGrid(plain), 'csv')!.rows).toEqual(JSON.parse(JSON.stringify(L2.rows)));
  });
  it('obDropSums', () => {
    const { fn } = env();
    const rows: ObRow[] = [['120', 'x', '', '', 500, 0], ['1200', '', 'А', '', 300, 0], ['1200', '', 'Б', '', 200, 0], ['2200', '', '', '', 0, 90], ['2200', '', 'В', '', 0, 90], ['1000', '', '', '', 5, 0]];
    const L = fn.obDropSums!(rows.map((r) => [...r]));
    expect(dropSummaryRows(rows)).toEqual(JSON.parse(JSON.stringify(L)));
  });
  it('importOpen (rows and control)', async () => {
    const lg = loadLegacy({ year: Y, lines: [], firm, data: { ...data, partners }, state: { draft: { kind: 'open', rows: [] } } });
    await lg.fn.importOpen!(csvFile(CSV));
    const S = lg.ctx.S;
    const { rows, control } = buildOpening(parseOpeningSheet(csvToGrid(CSV))!, { partners });
    expect(rows.map((r) => [r.account, r.name, r.partnerId, r.partnerName ?? '', r.partnerCode ?? '', r.debit, r.credit]))
      .toEqual(S.draft.rows.map((r: any) => [r.k, r.name, r.partner, r.pname, r.pname ? r.pcode : '', +r.d || 0, +r.p || 0]));
    const C = JSON.parse(JSON.stringify(S.openCtl));
    expect({ ...control, src: 'excel' }).toEqual({ ...C, grand: undefined, src: 'excel' } as never);
  });
});
