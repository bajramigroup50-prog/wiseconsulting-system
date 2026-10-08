/**
 * Realistic year-end fixtures: a trading ДОО, a service ДООЕЛ (first year, loss, payroll v2 without 4201/4202),
 * a sole trader (ТП) and an NPO (on the NPO chart). Each is a list of balanced journal entries that feeds BOTH the
 * legacy runtime (as journals) and the new engine (as a trial balance).
 */
import type { YeTrialBalanceRow } from '../../../src/yearend';
import type { LegacyJournal, LegacyWorld } from './legacy';

/** [account, debit, credit, partner?] */
export type OpenLine = [string, number, number, string?];
/** [date, debit account, credit account, amount, partner on debit?, partner on credit?, src?] */
export type Entry = [string, string, string, number, string?, string?, string?];

export interface Fixture {
  name: string;
  year: number;
  firm: Record<string, unknown>;
  opening: OpenLine[];
  entries: Entry[];
  payroll?: { month: string; v: 2; emps: unknown[]; T: { tax: number; pio: number; zdr: number; dop: number; vrab: number } }[];
  employees?: { id: string; active?: boolean }[];
  assets?: { id: string; name: string; konto: string; rate: number; date: string; cost: number; vehicleOnly?: boolean }[];
  partners?: { id: string; name: string }[];
  /** extra legacy collections (bank, moves, items, invoices, purchases, …) */
  extra?: Record<string, unknown[]>;
}

export function legacyJournals(fx: Fixture): LegacyJournal[] {
  const Y = fx.year;
  const J: LegacyJournal[] = [];
  if (fx.opening.length)
    J.push({
      id: 'open-' + Y,
      kind: 'open',
      date: Y + '-01-01',
      lines: fx.opening.map(([k, d, p, partner]) => ({ k, d, p, ...(partner ? { partner } : {}) })),
    });
  const lines: LegacyJournal['lines'] = [];
  for (const [date, dk, pk, amt, dpar, ppar, src] of fx.entries) {
    lines.push({ k: dk, d: amt, p: 0, date, ...(dpar ? { partner: dpar } : {}), ...(src ? { src } : {}) });
    lines.push({ k: pk, d: 0, p: amt, date, ...(ppar ? { partner: ppar } : {}), ...(src ? { src } : {}) });
  }
  J.push({ id: 'nal-' + Y, kind: 'nalog', date: Y + '-06-30', lines });
  return J;
}

export function legacyWorld(fx: Fixture, extraJournals: LegacyJournal[] = []): LegacyWorld {
  return {
    year: fx.year,
    firm: structuredClone(fx.firm),
    data: {
      journal: [...legacyJournals(fx), ...extraJournals],
      payroll: fx.payroll ?? [],
      employees: fx.employees ?? [],
      assets: fx.assets ?? [],
      partners: fx.partners ?? [],
      bank: [],
      moves: [],
      items: [],
      invoices: [],
      purchases: [],
      sales: [],
      docs: [],
      ...(structuredClone(fx.extra) ?? {}),
    },
  };
}

/** Trial balance for the new engine. */
export function trialBalance(fx: Fixture): YeTrialBalanceRow[] {
  const by = new Map<string, YeTrialBalanceRow>();
  const row = (k: string) => {
    let r = by.get(k);
    if (!r) by.set(k, (r = { account: k, debit: 0, credit: 0, openingDebit: 0, openingCredit: 0 }));
    return r;
  };
  for (const [k, d, p] of fx.opening) {
    const r = row(k);
    r.openingDebit! += d;
    r.openingCredit! += p;
  }
  for (const [, dk, pk, amt] of fx.entries) {
    row(dk).debit += amt;
    row(pk).credit += amt;
  }
  return [...by.values()];
}

/** Ledger lines for zcFindings. */
export function ledgerLines(fx: Fixture) {
  return legacyJournals(fx).flatMap((j) =>
    j.lines.map((l) => ({ k: l.k, d: l.d, p: l.p, partner: l.partner ?? null, date: l.date ?? j.date, src: l.src ?? (j.kind === 'open' ? 'Почетна' : 'Налог') })),
  );
}

/* ------------------------------------------------------------------ ДОО ------------------------------------------------------------------ */

export const DOO: Fixture = {
  name: 'ДОО (трговија, со почетна состојба)',
  year: 2025,
  firm: {
    id: 'f-doo',
    name: 'ТЕСТ ТРГОВИЈА ДОО Скопје',
    ent: 'co',
    embs: '7001234',
    edb: '4030001234567',
    regDate: '2019-05-10',
    activity: '46.900',
    nkd: '46.900',
    dbAdj: { 2025: { '15': 34875, kazni: 12000 } },
    crmPeriod: 1,
  },
  partners: [
    { id: 'p1', name: 'Купувач Еден ДОО' },
    { id: 'p2', name: 'Купувач Два ДООЕЛ' },
    { id: 's1', name: 'Добавувач Еден ДОО' },
    { id: 's2', name: 'Добавувач Два АД' },
  ],
  opening: [
    ['0120', 1_250_000, 0],
    ['0192', 0, 312_500],
    ['01360', 1_480_000, 0],
    ['0193', 0, 444_000],
    ['1000', 612_345.2, 0],
    ['1020', 18_450, 0],
    ['1200', 385_200, 0, 'p1'],
    ['1200', 122_000, 0, 'p2'],
    ['6600', 1_045_780.4, 0],
    ['2200', 0, 402_115.6, 's1'],
    ['2200', 0, 96_000, 's2'],
    ['9000', 0, 310_000],
    ['950', 0, 3_349_160],
  ],
  entries: [
    ['2025-01-05', '1020', '1000', 200_000],
    ['2025-01-20', '1200', '7400', 8_240_350.75, 'p1', undefined, 'Излез'],
    ['2025-01-20', '1200', '2300', 1_483_263.14, 'p1', undefined, 'Излез'],
    ['2025-02-14', '1200', '7401', 1_830_400.1, 'p2', undefined, 'Излез'],
    ['2025-02-14', '1200', '2300', 329_472.02, 'p2', undefined, 'Излез'],
    ['2025-02-01', '6600', '2200', 5_880_200.3, undefined, 's1', 'Влез'],
    ['2025-02-01', '1300', '2200', 1_058_436.05, undefined, 's1', 'Влез'],
    ['2025-03-03', '6600', '2200', 410_000, undefined, 's2', 'Влез'],
    ['2025-03-03', '1300', '2200', 73_800, undefined, 's2', 'Влез'],
    ['2025-03-10', '1000', '1200', 9_400_000, undefined, 'p1'],
    ['2025-04-10', '1000', '1200', 2_050_000, undefined, 'p2'],
    ['2025-03-15', '2200', '1000', 6_950_000, 's1'],
    ['2025-04-15', '2200', '1000', 520_000, 's2'],
    ['2025-12-31', '7000', '6600', 6_085_410.55],
    ['2025-05-31', '4100', '2200', 286_450.4, undefined, 's2', 'Влез'],
    ['2025-06-30', '4130', '1000', 48_120.66],
    ['2025-06-30', '4000', '1020', 64_230.15],
    ['2025-06-30', '4010', '1000', 132_400.8],
    ['2025-12-31', '4200', '2400', 1_320_000],
    ['2025-12-31', '4201', '2340', 146_666.67],
    ['2025-12-31', '4202', '2341', 513_333.33],
    ['2025-12-31', '2400', '1000', 1_320_000],
    ['2025-12-31', '2340', '1000', 146_666.67],
    ['2025-12-31', '2341', '1000', 513_333.33],
    ['2025-07-15', '4400', '1020', 45_000],
    ['2025-08-20', '4460', '1020', 38_750],
    ['2025-12-31', '4302', '0192', 125_000],
    ['2025-12-31', '4302', '0193', 296_000],
    ['2025-12-31', '4470', '1000', 18_936.42],
    ['2025-12-31', '4740', '1000', 22_115.3],
    ['2025-11-30', '1000', '7750', 6_512.88],
    ['2025-10-31', '1000', '7690', 15_000],
    ['2025-09-30', '4640', '1000', 12_000],
    ['2025-12-31', '2300', '1300', 1_132_236.05],
    ['2025-12-31', '2300', '1000', 660_499.11],
    ['2025-12-15', '2330', '1000', 96_000],
  ],
  employees: [
    { id: 'e1', active: true },
    { id: 'e2', active: true },
    { id: 'e3', active: true },
    { id: 'e4', active: true },
    { id: 'e5', active: false },
  ],
  assets: [
    { id: 'a1', name: 'Виљушкар', konto: '0120', rate: 10, date: '2021-06-15', cost: 1_250_000 },
    { id: 'a2', name: 'Доставно возило', konto: '01360', rate: 20, date: '2023-03-15', cost: 1_480_000 },
    { id: 'a3', name: 'Возило на лизинг (само евиденција)', konto: '01360', rate: 20, date: '2025-02-15', cost: 900_000, vehicleOnly: true },
    { id: 'a4', name: 'Лаптоп', konto: '0134', rate: 25, date: '2025-09-15', cost: 72_000 },
    { id: 'a5', name: 'Софтвер', konto: '0030', rate: 25, date: '2024-01-15', cost: 120_000 },
  ],
};

/* ------------------------------------------------------------------ ДООЕЛ ------------------------------------------------------------------ */

const months = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2025-${String(from + i).padStart(2, '0')}`);

export const DOOEL: Fixture = {
  name: 'ДООЕЛ (услуги, прва година, загуба, плати v2)',
  year: 2025,
  firm: { id: 'f-dooel', name: 'ДИГИТАЛ СЕРВИС ДООЕЛ Битола', ent: 'co', embs: '7123456', regDate: '2025-03-12', activity: '62.010', nkd: '62.010' },
  partners: [
    { id: 'k1', name: 'Клиент А' },
    { id: 'd1', name: 'Хостинг Б' },
  ],
  opening: [],
  entries: [
    ['2025-03-12', '1000', '9000', 307_500],
    ['2025-03-20', '0134', '2200', 186_000, undefined, 'd1', 'Влез'],
    ['2025-04-30', '1200', '7420', 1_210_500.5, 'k1', undefined, 'Излез'],
    ['2025-04-30', '1200', '2300', 217_890.09, 'k1', undefined, 'Излез'],
    ['2025-06-30', '1000', '1200', 1_250_000, undefined, 'k1'],
    ['2025-05-31', '4120', '2200', 244_800.35, undefined, 'd1', 'Влез'],
    ['2025-05-31', '1300', '2200', 44_064.06, undefined, 'd1', 'Влез'],
    ['2025-07-31', '2200', '1000', 470_000, 'd1'],
    ['2025-12-31', '4200', '2400', 1_130_000],
    ['2025-12-31', '2400', '1000', 780_000],
    ['2025-12-31', '4480', '1000', 9_870.4],
    ['2025-12-31', '4302', '0193', 34_875],
  ],
  payroll: months(4, 12).map((m) => ({ month: m, v: 2 as const, emps: [{}, {}], T: { tax: 9_150.5, pio: 23_880, zdr: 9_000, dop: 600, vrab: 150 } })),
  employees: [{ id: 'x1' }, { id: 'x2' }],
};

/* ------------------------------------------------------------------ ТП ------------------------------------------------------------------ */

export const TP: Fixture = {
  name: 'ТП (трговец поединец, малопродажба)',
  year: 2025,
  firm: { id: 'f-tp', name: 'ТП Маркет Петровски', ent: 'tp', dldAdj: { 2025: { rep: 12_000, kazni: 3_500, ak: 48_000, red: 0 } } },
  opening: [],
  entries: [
    ['2025-02-03', '1000', '9000', 50_000],
    ['2025-02-10', '6600', '2200', 2_450_000.4],
    ['2025-03-31', '1020', '7600', 3_120_450.25],
    ['2025-12-31', '7000', '6600', 2_201_330.1],
    ['2025-06-30', '2200', '1000', 2_300_000],
    ['2025-06-30', '1000', '1020', 2_900_000],
    ['2025-06-30', '4100', '1000', 96_400.5],
    ['2025-06-30', '4010', '1000', 74_225.8],
    ['2025-06-30', '4400', '1020', 12_000],
    ['2025-06-30', '4640', '1020', 3_500],
    ['2025-12-31', '4310', '0193', 18_000],
  ],
};

/* ------------------------------------------------------------------ НПО ------------------------------------------------------------------ */

export const NPO: Fixture = {
  name: 'НПО (здружение, контен план за НПО, стопанска дејност над 1 милион)',
  year: 2025,
  firm: {
    id: 'f-npo',
    name: 'Здружение Зелена Иднина',
    ent: 'npo',
    accounts: { '730': { mk: 'Приходи од членарини' }, '731': { mk: 'Приходи од донации' } },
  },
  opening: [
    ['100', 412_000, 0],
    ['101', 8_500, 0],
    ['013', 260_000, 0],
    ['019', 0, 78_000],
    ['220', 0, 22_500],
    ['900', 0, 180_000],
    ['950', 0, 50_000],
    ['970', 0, 350_000],
  ],
  entries: [
    ['2025-01-31', '100', '730', 145_000],
    ['2025-03-31', '100', '731', 1_840_000],
    ['2025-04-30', '120', '710', 1_386_250.6],
    ['2025-06-30', '100', '120', 1_200_000],
    ['2025-05-31', '400', '220', 312_480.15],
    ['2025-05-31', '402', '220', 845_100],
    ['2025-06-30', '220', '100', 1_100_000],
    ['2025-12-31', '460', '280', 1_406_000],
    ['2025-12-31', '280', '100', 1_406_000],
    ['2025-12-31', '406', '019', 52_000],
    ['2025-12-31', '410', '100', 9_480.75],
    ['2025-12-31', '416', '101', 6_000],
  ],
};

export const FIXTURES = { DOO, DOOEL, TP, NPO };
