/**
 * Employment document read with `EMP_PROMPT` → employee record (legacy `readEmployeeDocs` 6047–6056): match by ЕМБГ,
 * keep the existing values the document does not state, coefficient from the weekly hours, net from the gross.
 *
 * FIX (LEGACY-MAP 6.4 #1): the net is computed with the month's complete payroll params (`resolvePayParams`), not
 * with the hard-coded 18.8 / 7.5 / 0.5 / 1.2 / 10 % fallbacks, and the maximum contribution base is applied like in
 * `grossFromNet`.
 */
import { r2 } from '../money';
import { assertPayParams, type PayParams } from '../payroll/params';

export interface ReadEmployee {
  name?: string; embg?: string; address?: string; position?: string; start?: string; end?: string; contract?: string;
  hoursWeek?: number | string; netSalary?: number | string; grossSalary?: number | string; bankAcc?: string; bank?: string; stazPrevYears?: number | string;
}

/** Monthly net of a full-time gross (legacy formula in `readEmployeeDocs`, inverse of `grossFromNet`). */
export function empNetFromGross(gross: number, P: PayParams): number {
  assertPayParams(P);
  const c = (P.pio + P.zdr + P.dop + P.vrab) / 100;
  const contrib = c * (P.maxBase > 0 ? Math.min(gross, P.maxBase) : gross);
  const afterC = gross - contrib;
  return Math.round(afterC - (Math.max(0, afterC - (+P.exempt || 0)) * P.tax) / 100);
}

/** The employee fields this mapping fills (names of the `employees` columns). */
export interface EmployeeFromRead {
  no: string; name: string; embg: string | null; address: string | null; position: string | null; start: string | null; end: string | null;
  contract: 'определено' | 'неопределено' | null; netBase: number; coef: number; stazPrev: number; bankAcc: string | null; bank: string | null;
  leaveDays: number; active: true;
}

export interface ExistingEmployee {
  id: string; no?: string | null; name: string; embg?: string | null; address?: string | null; position?: string | null; start?: string | null;
  end?: string | null; contract?: string | null; netBase?: number | string | null; coef?: number | string | null; stazPrev?: number | string | null;
  bankAcc?: string | null; bank?: string | null; leaveDays?: number | null;
}

const iso = (s: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? String(s) : '');
const txt = (s: unknown) => String(s ?? '').trim();

/** ЕМБГ digits of a read (for matching). */
export const readEmbg = (r: ReadEmployee | null | undefined): string => String(r?.embg ?? '').replace(/\D/g, '');

/**
 * `EMP_PROMPT` reply → employee values. `ex` is the firm's employee with the same ЕМБГ (updated, legacy behaviour),
 * `nextNo` the number for a new one, `P` the params of the current month (needed only when the document states the
 * gross and not the net).
 */
export function employeeFromRead(r: ReadEmployee, o: { fileName: string; ex?: ExistingEmployee | null; nextNo: string; P?: PayParams | null }): EmployeeFromRead {
  const ex = o.ex ?? null;
  let net = +(r.netSalary ?? 0) || 0;
  if (!net && +(r.grossSalary ?? 0) && o.P) net = empNetFromGross(+r.grossSalary!, o.P);
  const emb = readEmbg(r);
  const hw = +(r.hoursWeek ?? 0) || 0;
  const coef = hw && hw < 40 ? r2(hw / 40) : 1;
  const contract = txt(r.contract) || txt(ex?.contract);
  return {
    no: txt(ex?.no) || o.nextNo,
    name: txt(r.name) || ex?.name || o.fileName,
    embg: emb || ex?.embg || null,
    address: txt(r.address) || ex?.address || null,
    position: txt(r.position) || ex?.position || null,
    start: iso(r.start) || ex?.start || null,
    end: iso(r.end) || ex?.end || null,
    contract: contract === 'определено' || contract === 'неопределено' ? contract : null,
    netBase: net || +(ex?.netBase ?? 0) || 0,
    coef: +(ex?.coef ?? 0) || coef,
    stazPrev: +(r.stazPrevYears ?? 0) || +(ex?.stazPrev ?? 0) || 0,
    bankAcc: txt(r.bankAcc) || ex?.bankAcc || null,
    bank: txt(r.bank) || ex?.bank || null,
    leaveDays: ex?.leaveDays || 20,
    active: true,
  };
}
