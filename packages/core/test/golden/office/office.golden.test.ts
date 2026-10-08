/**
 * Golden tests for the pure Phase 9 office helpers against legacy/index.html: recurring-invoice dates
 * (`recNext`, `lastWD`, `recNext2`, `recNote`, `recItemName`), AML risk (`amlRisk`) and the autopilot peer
 * risk score (`apRisk`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { amlRisk, apRisk, recItemName, recNext, recNote, type AmlFile, type AmlAuto, type RecEvery } from '../../../src/office';

const SRC = readFileSync(fileURLToPath(new URL('../../../../../legacy/index.html', import.meta.url)), 'utf8').split('\n');
const PARTS: [number, number, string][] = [
  [9493, 9493, 'const ymd='],
  [10173, 10173, 'const recNext='],
  [10182, 10182, 'const MON_MK='],
  [13483, 13484, 'function lastWD('],
  [13486, 13486, 'function recItemName('],
  [13492, 13492, 'function recNote('],
  [15866, 15866, 'const AML_LV='],
  [15881, 15891, 'function amlRisk('],
  [16282, 16294, 'function apRisk('],
];

function legacy(today: string, year: number) {
  const code = PARTS.map(([a, b, start]) => {
    const t = SRC.slice(a - 1, b).join('\n');
    if (!t.startsWith(start)) throw new Error(`legacy/index.html drifted: line ${a} should start with "${start}"`);
    return t;
  }).join('\n');
  const ctx: Record<string, any> = {
    bzPad: (n: number) => String(n).padStart(2, '0'),
    fmt: (n: number) => String(n), today: () => today, S: { year }, amlEur: () => 61.5,
  };
  vm.createContext(ctx);
  vm.runInContext(`${code}\nObject.assign(globalThis,{recNext,recNext2,recNote,recItemName,amlRisk,apRisk,lastWD});`, ctx);
  return ctx;
}

describe('recurring invoices vs legacy', () => {
  const L = legacy('2026-10-08', 2026);
  const dates = ['2026-01-31', '2026-02-28', '2025-12-15', '2026-03-31', '2024-01-30', '2026-11-29'];
  const days: (number | 'L')[] = [1, 15, 28, 29, 30, 31, 'L'];
  const every: RecEvery[] = ['month', 'quarter', 'half', 'year'];
  it('recNext2 matches for every combination', () => {
    for (const d of dates) for (const e of every) for (const day of days)
      expect(recNext(d, e, day), `${d} ${e} ${day}`).toBe(L.recNext2(d, e, day));
  });
  it('recNote and recItemName match', () => {
    for (const next of ['2026-01-05', '2026-10-31', '2027-03-01']) {
      const note = 'Фактура за {месец} (услуги за {претходен месец})';
      expect(recNote(note, next)).toBe(L.recNote({ note, next }));
      for (const nm of ['Сметководствени услуги за месец', 'ЗАКУП ЗА МЕСЕЦ', 'Закуп {месец}', 'Обично'])
        expect(recItemName(nm, next)).toBe(L.recItemName(nm, { next }));
    }
  });
});

describe('AML risk vs legacy', () => {
  const today = '2026-10-08';
  const L = legacy(today, 2026);
  const owner = { name: 'Петар Петров', cit: 'Македонско', share: 100 };
  const cases: [AmlFile, AmlAuto | null][] = [
    [{}, null],
    [{ bo: [owner] }, null],
    [{ bo: [owner], nonFace: true }, null],
    [{ bo: [{ ...owner, cit: 'Српско', legal: true }] }, null],
    [{ bo: [owner], crDate: '2026-01-02', ind: { cash: true, fict: true } }, null],
    [{ bo: [owner], pep: true }, null],
    [{ bo: [owner], lvOver: 'low' }, null],
    [{ bo: [owner], lvOver: 'high' }, null],
    [{ bo: [owner] }, { cash: 2, cashMax: 90000, rev: 9_000_000, emps: 0, nkdRisk: true, age: 0.5 }],
    [{}, { cash: 0, cashMax: 0, rev: 0, emps: 3, nkdRisk: false, age: 4, bo: [owner] }],
  ];
  it('level, score and factor count match', () => {
    for (const [A, X] of cases) {
      const lg = L.amlRisk({ nkd: '47.11' }, JSON.parse(JSON.stringify(A)), X && JSON.parse(JSON.stringify(X)));
      const r = amlRisk(A, X, { eurRate: 61.5, today, nkd: '47.11' });
      expect({ lv: r.level, s: r.score, n: r.factors.length, enh: r.enhanced }, JSON.stringify(A)).toEqual({ lv: lg.lv, s: lg.s, n: lg.F.length, enh: lg.enh });
    }
  });
});

describe('autopilot peer risk vs legacy', () => {
  const L = legacy('2026-10-08', 2026);
  const M = [
    { rev: 5e6, margin: 40, expR: 80, cashR: 20, sal: 40000, emp: 3, nkd: '47' },
    { rev: 4e6, margin: 38, expR: 85, cashR: 25, sal: 38000, emp: 2, nkd: '47' },
    { rev: 6e6, margin: 42, expR: 82, cashR: 22, sal: 42000, emp: 4, nkd: '47' },
    { rev: 7e6, margin: 10, expR: 120, cashR: 70, sal: 20000, emp: 0, nkd: '47' },
    { rev: 1e6, margin: null, expR: 60, cashR: 10, sal: null, emp: 0, nkd: '62' },
  ];
  it('scores match', () => {
    const rows = M.map((m, i) => ({ id: String(i), X: { m } }));
    L.apRisk(rows);
    const mine = apRisk(M.map((m, i) => ({ id: String(i), m })));
    for (const r of rows) expect(mine.get(r.id)!.score, r.id).toBe((r as any).risk.score);
    for (const r of rows) expect(mine.get(r.id)!.why.length, r.id).toBe((r as any).risk.why.length);
  });
});
