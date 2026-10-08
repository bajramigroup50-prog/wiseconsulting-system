/**
 * New payroll month proposal (legacy `payDraft` 6156 + v486 wrapper 14826): active employees,
 * regular + holiday hours from the calendar, part-time hour fund with holidays pro-rated,
 * seniority, parameters for the month.
 * Fix (#21): the employment-period bound uses the real last day of the month instead of `'-31'`.
 */
import { fixRegular, stazFor, type PayEmp } from './calc';
import { monthEnd, monthHours, monthSplit, type Holiday } from './calendar';
import { effectiveParams, type PayParamRow, type PayParams } from './params';

export interface DraftEmployee {
  id: string;
  no?: string;
  name: string;
  embg?: string;
  netBase?: number | string;
  coef?: number | string;
  start?: string;
  end?: string;
  stazY?: number | string;
  stazPrev?: number | string;
  hNorm?: number | string;
  active?: boolean;
}

export interface PayDraft {
  month: string;
  params: PayParams;
  emps: PayEmp[];
}

export function payDraft(month: string, employees: readonly DraftEmployee[], overrides: readonly PayParamRow[] = [], extraHolidays: readonly Holiday[] = []): PayDraft {
  const H = monthHours(month);
  const ms = month + '-01',
    me = monthEnd(month);
  const M = monthSplit(month, extraHolidays);
  const emps: PayEmp[] = employees
    .filter((e) => e.active !== false && (!e.start || e.start <= me) && (!e.end || e.end >= ms))
    .slice()
    .sort((a, b) => String(a.no || '').localeCompare(String(b.no || ''), 'mk', { numeric: true }))
    .map((e) => ({
      empId: e.id,
      no: e.no || '',
      name: e.name,
      embg: e.embg || '',
      netBase: +(e.netBase as number) || 0,
      coef: +(e.coef as number) || 1,
      stazY: stazFor(e, month),
      lines: [{ type: 'Редовно работење', hours: M.work, pct: 100 }, ...(M.hol ? [{ type: 'Државен празник', hours: M.hol, pct: 100 }] : [])],
    }));
  const { src: _src, user: _user, from, ...vals } = effectiveParams(month, overrides);
  const params = { ...vals, hours: H, pfrom: from } as PayParams;
  /* v486: part-time hour fund from the employee card, holidays pro-rated */
  const full = +(params.hours ?? 0) || 176;
  for (const e of emps) {
    if (e.hNorm) continue;
    const E = employees.find((x) => x.id === e.empId);
    const hN = +(E?.hNorm ?? 0);
    if (E && hN && hN < full) {
      e.hNorm = hN;
      const k = hN / full;
      for (const l of e.lines || []) if (l.type === 'Државен празник') l.hours = Math.round(+(l.hours as number) * k);
      fixRegular(e, hN);
    }
  }
  return { month, params, emps };
}
