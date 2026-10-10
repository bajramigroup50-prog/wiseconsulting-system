/**
 * Monthly close of all firms — legacy `zatMonthEnd` / `zatTasks` / `zatPrio` (8686–8711). The facts are collected per
 * firm by the server (aggregated SQL); this decides the tasks, their state (true = done, false = to do, null = n/a)
 * and the priority group.
 */
import { periodOf } from '../vat';

export interface ZatFacts {
  vat: boolean;
  vatPeriod: 'month' | 'quarter' | string;
  lockDate: string | null;
  /** Number of bank statements dated in the month / distinct statement dates. */
  statements: number;
  /** Invoices (not credit notes), purchases, payroll run of the month. */
  invoices: number;
  purchases: number;
  /** Invoice numbers of the year up to the month end (not credit notes / advances) for the gap check. */
  invoiceNumbers: readonly string[];
  /** Journal lines on 1020 exist, and the balance at the month end (den.). */
  cash: { any: boolean; balance: number };
  activeEmployees: number;
  payrollRun: { exists: boolean; locked: boolean } | null;
  /** VAT periods closed (`YYYY-MM` / `YYYY-Тq`). */
  vatClosed: ReadonlySet<string>;
}

export interface ZatTask { k: string; n: string; ok: boolean | null; info: string; go: string; due?: string }

export const zatMonthEnd = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
export const ymAdd = (ym: string, k: number): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};
const dmy = (d: string) => d.split('-').reverse().join('.');
const fmt = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Legacy gap count: per number prefix (series), missing numbers between the smallest and largest. */
export function numberGaps(numbers: readonly string[]): number {
  const ser = new Map<string, number[]>();
  for (const s of numbers) {
    const m = String(s || '').match(/^(\D*)(\d+)/);
    if (m) ser.set(m[1]!.trim(), [...(ser.get(m[1]!.trim()) ?? []), +m[2]!]);
  }
  let gaps = 0;
  for (const N of ser.values()) {
    const u = [...new Set(N)].sort((a, b) => a - b);
    for (let i = 1; i < u.length; i++) gaps += u[i]! - u[i - 1]! - 1;
  }
  return gaps;
}

/** Legacy `zatTasks`. FIX: the statement-balance check (`izvSal`) is not ported — statements here are counted only. */
export function zatTasks(f: ZatFacts, ym: string): ZatTask[] {
  const T: ZatTask[] = [];
  const me = zatMonthEnd(ym), nx = ymAdd(ym, 1);
  const add = (k: string, n: string, ok: boolean | null, info: string, go: string, due?: string) => T.push({ k, n, ok, info, go, ...(due ? { due } : {}) });
  const hasAct = f.invoices > 0 || f.purchases > 0 || !!f.payrollRun;
  add('izv', 'Изводи', f.statements ? true : hasAct ? false : null, f.statements ? `${f.statements} изводи` : hasAct ? 'нема ниту еден извод за месецот' : 'нема промет', 'banka');
  add('vlez', 'Влезни фактури', f.purchases ? true : hasAct ? false : null, f.purchases ? `${f.purchases} фактури` : 'нема внесено влезни фактури', 'vlez');
  const gaps = numberGaps(f.invoiceNumbers);
  add('izlez', 'Излезни фактури', f.invoices ? !gaps : null, f.invoices ? `${f.invoices} фактури${gaps ? ' · ⚠ ' + gaps + ' прескокнати броеви' : ''}` : 'нема излезни фактури', 'izlez');
  if (f.cash.any) add('blg', 'Благајна', f.cash.balance >= -0.5, 'салдо на ' + dmy(me) + ': ' + fmt(f.cash.balance), 'blagajna');
  if (f.activeEmployees) {
    const p = f.payrollRun;
    add('pay', 'Плата + МПИН', !!p, p ? 'пресметана' + (p.locked ? ' · заклучена' : '') : `не е пресметана (${f.activeEmployees} вработени)`, 'plati', nx + '-15');
  }
  if (f.vat) {
    const per = f.vatPeriod === 'month' ? 'month' : 'quarter';
    if (per === 'month' || ['03', '06', '09', '12'].includes(ym.slice(5))) {
      const pp = periodOf(me, per);
      const done = f.vatClosed.has(pp);
      add('ddv', 'ДДВ-04 ' + (per === 'month' ? 'месечна' : 'тромесечна'), done, done ? 'книжена' : pp + ' не е книжена', 'ddv', nx + '-25');
    }
  }
  add('lock', 'Месецот заклучен', !!(f.lockDate && f.lockDate >= me), f.lockDate ? 'заклучено до ' + dmy(f.lockDate) : 'не е заклучен', 'firmi');
  return T;
}

/** Legacy `zatPrio` (+ the refinement in `zatRun`): VAT monthly → VAT quarterly at quarter end → other VAT → no VAT with payroll → rest. */
export function zatPrio(f: Pick<ZatFacts, 'vat' | 'vatPeriod' | 'activeEmployees'>, ym: string): [number, string] {
  if (f.vat && f.vatPeriod === 'month') return [1, 'ДДВ обврзници – месечно'];
  if (f.vat && ['03', '06', '09', '12'].includes(ym.slice(5))) return [2, 'ДДВ обврзници – тромесечно (крај на квартал)'];
  if (f.vat) return [3, 'ДДВ обврзници – тромесечно'];
  return f.activeEmployees ? [4, 'Без ДДВ – со плати'] : [5, 'Без ДДВ, без вработени'];
}
