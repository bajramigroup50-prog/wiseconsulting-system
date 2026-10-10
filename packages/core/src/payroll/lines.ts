/**
 * Editing a payroll run's hour/amount lines (legacy ACT `payLineOk` 7131, `payLineDel` 7130,
 * `payLineAdd` 7247, `payLineRm` 7248, `payAddOne` 7121, `payTakeMat` 7126, `payAvgGross` 7127,
 * `payIOHours` 6303, `leaveStats` 6042, `payBaseSum` 6175). All functions mutate the given employee
 * in place (the editor works on a draft copy) and are pure otherwise.
 *
 * DELIBERATE FIXES (LEGACY-MAP 6.4 #14):
 *  - FIX: every line gets a category. Legacy `payLineAdd` pushed `{type,hours,pct}` without `cat`, so
 *    the category was re-guessed from the free-text type on every calculation.
 *  - FIX: the hour fund used to recompute regular hours is the employee's own (`hNorm`, part-time)
 *    before the month's `params.hours`. Legacy `payLineRm` and the batch "prev" path used `params.hours`
 *    and so gave part-time employees a full month of regular hours after deleting an absence.
 *  - FIX: deleting a line only recomputes regular hours when the deleted line was an absence. Legacy
 *    `payLineDel` tested `cat!=='reg' || type!=='Редовно работење'`, which is true for almost every line
 *    (including overtime and amounts) and re-filled "Редовно работење" after unrelated deletions.
 *  - Holidays: `params.hours` is `monthHours` (weekdays × 8, holidays included) and the draft splits it
 *    into regular + "Државен празник" with `monthSplit`, so both always add up to the same fund.
 */
import { empCalc, fixRegular, HT_ADD, payCatOf, stazFor, type EmpCalc, type PayCat, type PayEmp, type PayLine, type PsifCode } from './calc';
import { monthSplit, workHoursBetween, type Holiday } from './calendar';
import type { PayParams } from './params';

type Num = number | string | null | undefined;
const n = (v: Num): number => +(v as number) || 0;

export const PAY_REGULAR = 'Редовно работење';
export const PAY_HOLIDAY = 'Државен празник';

/** Category of a line (stored `cat` or inferred from the type). */
export const payLineCat = (l: Pick<PayLine, 'cat' | 'type'>): PayCat => (l.cat || payCatOf(l.type)) as PayCat;

/** An absence line reduces regular hours (sick leave, leave, holiday…), additional hours/amounts don't. */
export const payIsAbsence = (l: PayLine): boolean => l.type !== PAY_REGULAR && !HT_ADD(l.type) && !['dop', 'kor', 'sin'].includes(payLineCat(l));

/** The hour fund of one employee in a run: personal `hNorm` (part-time) before the month's hours. */
export const empHourFund = (e: Pick<PayEmp, 'hNorm'>, P: Pick<PayParams, 'hours'>): number => n(e.hNorm) || n(P.hours) || 176;

export interface PayLineInput {
  type?: string;
  hours?: Num;
  amt?: Num;
  pct?: Num;
  cat?: PayCat | '';
  /** PSIF code chosen in the editor. */
  code?: string;
}

/**
 * Normalise a line from the editor (legacy `payLineOk`): category always set, `sin` lines are pure
 * deductions (no hours, no %), a known code adds payer + MPIN code. Throws when neither hours nor amount.
 */
export function makePayLine(o: PayLineInput, codes: readonly PsifCode[] = []): PayLine {
  const type = String(o.type ?? '').trim() || 'Ставка';
  const l: PayLine = { type, hours: n(o.hours), amt: n(o.amt), pct: o.pct === '' || o.pct == null ? 100 : n(o.pct), cat: (o.cat || payCatOf(type)) as PayCat };
  const sx = o.code ? codes.find((c) => c.code === o.code) : undefined;
  if (sx && sx.name === type) {
    l.code = sx.code;
    l.payer = sx.payer;
    l.mpin = sx.mpin;
  }
  if (!l.hours && !l.amt) throw new Error('Внесете часови или износ.');
  if (l.cat === 'sin') {
    l.hours = 0;
    l.pct = 0;
  }
  return l;
}

/** Add (`ix` null) or replace line `ix`; an absence with hours recomputes regular hours from the employee's fund. */
export function upsertPayLine(e: PayEmp, line: PayLine, ix: number | null, P: Pick<PayParams, 'hours'>): void {
  e.lines ??= [];
  if (ix == null || ix < 0 || ix >= e.lines.length) e.lines.push(line);
  else e.lines[ix] = line;
  if (line.type !== PAY_REGULAR && n(line.hours) && payLineCat(line) !== 'dop') fixRegular(e, empHourFund(e, P));
}

/** Remove line `ix`; regular hours are recomputed only when an absence was removed (FIX #14). */
export function removePayLine(e: PayEmp, ix: number, P: Pick<PayParams, 'hours'>): void {
  const L = e.lines ?? [];
  const rm = L[ix];
  if (!rm) return;
  L.splice(ix, 1);
  if (payIsAbsence(rm)) fixRegular(e, empHourFund(e, P));
}

/** Default lines for an employee added to a run (legacy `payAddOne`; category set). */
export function defaultPayLines(month: string, extra: readonly Holiday[] = []): PayLine[] {
  const M = monthSplit(month, extra);
  return [{ type: PAY_REGULAR, hours: M.work, pct: 100, cat: 'reg' }, ...(M.hol ? [{ type: PAY_HOLIDAY, hours: M.hol, pct: 100, cat: 'reg' as const }] : [])];
}

export interface RunEmployeeSource {
  id: string;
  no?: string | null;
  name: string;
  embg?: string | null;
  netBase?: Num;
  coef?: Num;
  start?: string | null;
  stazPrev?: Num;
  stazY?: Num;
  hNorm?: Num;
}

/** New run row for an employee (legacy `payAddOne`), part-time fund applied like the draft (v486). */
export function payEmpFor(month: string, E: RunEmployeeSource, P: Pick<PayParams, 'hours'>, extra: readonly Holiday[] = []): PayEmp {
  const e: PayEmp = {
    empId: E.id,
    no: E.no || '',
    name: E.name,
    embg: E.embg || '',
    netBase: n(E.netBase),
    coef: n(E.coef) || 1,
    stazY: stazFor({ start: E.start || undefined, stazY: E.stazY, stazPrev: E.stazPrev }, month),
    lines: defaultPayLines(month, extra),
  };
  const full = n(P.hours) || 176,
    hN = n(E.hNorm);
  if (hN && hN < full) {
    e.hNorm = hN;
    for (const l of e.lines!) if (l.type === PAY_HOLIDAY) l.hours = Math.round((n(l.hours) * hN) / full);
    fixRegular(e, hN);
  }
  return e;
}

/** Refresh the run row from the employee card (legacy `payTakeMat`): name, number, salary, seniority; drops a manual gross. */
export function takeFromEmployee(e: PayEmp, E: RunEmployeeSource, month: string): void {
  Object.assign(e, {
    name: E.name,
    no: E.no || '',
    embg: E.embg || '',
    netBase: n(E.netBase),
    coef: n(E.coef) || 1,
    stazY: stazFor({ start: E.start || undefined, stazY: E.stazY, stazPrev: E.stazPrev }, month),
  });
  delete e.grossBase;
}

/**
 * Joining / leaving during the month (legacy `payIOHours`): regular and holiday hours limited to the
 * employed days, then regular hours = fund − absences.
 */
export function payIOHours(month: string, e: PayEmp & { inout?: string; ioDate?: string }, extra: readonly Holiday[] = []): void {
  const io = !!e.inout && e.inout !== 'full' && !!e.ioDate && e.ioDate.slice(0, 7) === month;
  const r = !io ? workHoursBetween(month, undefined, undefined, extra) : e.inout === 'in' ? workHoursBetween(month, e.ioDate, undefined, extra) : workHoursBetween(month, undefined, e.ioDate, extra);
  e.lines ??= [];
  const hl = e.lines.find((l) => l.type === PAY_HOLIDAY);
  if (hl && !r.hol) e.lines.splice(e.lines.indexOf(hl), 1);
  else if (hl) hl.hours = r.hol;
  else if (r.hol) e.lines.push({ type: PAY_HOLIDAY, hours: r.hol, pct: 100, cat: 'reg' });
  fixRegular(e, r.work + r.hol);
}

/** Contribution base of a calculation: each hour line at least the pro-rated minimum base (legacy `payBaseSum`). */
export function payBaseSum(c: EmpCalc): number {
  return c.rows.reduce((s, r) => s + (r.hr ? Math.max(r.gr, Math.round((c.minB * r.hr) / c.H)) : r.gr), 0);
}

export interface LeaveStats {
  right: number;
  used: number;
  rest: number;
  sick: number;
}

/**
 * Annual leave / sick-leave days of an employee from the year's payroll lines (legacy `leaveStats`;
 * 8 h = 1 day). `extraLeaveDays` / `extraSickDays` add days registered in the HR registry that are not
 * (yet) in a payroll run.
 */
export function payLeaveStats(
  empId: string,
  runs: readonly { emps: readonly (Pick<PayEmp, 'empId' | 'lines'>)[] }[],
  leaveDays: Num,
  extra: { leave?: number; sick?: number } = {},
): LeaveStats {
  let go = 0,
    sick = 0;
  for (const p of runs) {
    const x = p.emps.find((z) => z.empId === empId);
    if (!x) continue;
    for (const l of x.lines || []) {
      if (/одмор/i.test(l.type)) go += n(l.hours);
      if (/боледување/i.test(l.type)) sick += n(l.hours);
    }
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const right = n(leaveDays) || 20;
  const used = r2(go / 8 + (extra.leave || 0));
  return { right, used, rest: r2(right - used), sick: r2(sick / 8 + (extra.sick || 0)) };
}

/** Per-employee summary used by the month list, recap and reports. */
export function payEmpSummary(e: PayEmp, P: PayParams) {
  const c = empCalc(e, P);
  return {
    gross: c.T.gross + c.T.dopl,
    base: payBaseSum(c),
    contr: c.T.contr + c.T.dopl,
    tax: c.T.tax,
    net: c.T.net,
    ded: c.T.ded,
    hours: c.rows.reduce((a, r) => a + (r.hr || 0), 0),
    c,
  };
}

/**
 * "Like the previous month" proposal (legacy `ppMake` 'prev' 7135 and the batch `pbBuild` 'prev' 15283): same
 * employees and salaries, calendar hours, and the previous month's additional / correction / deduction lines.
 * FIX (#14): legacy recomputed regular hours with `params.hours` for everybody; part-time employees (`hNorm`) keep
 * their own fund and get the holiday hours pro-rated, like the calendar draft.
 */
/**
 * `cats`: the line categories carried over. Плати „Нов месец – како претходниот“ copies dop/kor/sin; the all-firms
 * batch (legacy `pbBuild` 15283) copies only `sin` (union, insurance, credit deductions) — no overtime or bonuses.
 */
export function payCopyPrev(month: string, prevEmps: readonly PayEmp[], P: Pick<PayParams, 'hours'>, extra: readonly Holiday[] = [], cats: readonly PayCat[] = ['dop', 'kor', 'sin']): PayEmp[] {
  const full = n(P.hours) || 176;
  return prevEmps.map((e0) => {
    const e: PayEmp = JSON.parse(JSON.stringify(e0));
    const hN = n(e.hNorm);
    const base = defaultPayLines(month, extra);
    if (hN && hN < full) for (const l of base) if (l.type === PAY_HOLIDAY) l.hours = Math.round((n(l.hours) * hN) / full);
    e.lines = [...base, ...(e0.lines ?? []).filter((l) => cats.includes(payLineCat(l))).map((l) => ({ ...l, cat: payLineCat(l) }))];
    delete e.inout;
    delete e.ioDate;
    fixRegular(e, empHourFund(e, P));
    return e;
  });
}
