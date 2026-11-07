/**
 * Dated absences of an employee (породилно, боледување, годишен одмор, платено / неплатено отсуство) turned into the
 * payroll lines of a month: the working hours of the days that fall into the month (`workHoursBetween`: Saturday,
 * Sunday and the holidays are not absence hours — a holiday stays paid as a holiday), with the code's %, payer and МПИН
 * code from the line-code table (`PSIF0` / the firm's `paysif`). Sick leave paid by the employer turns into the ФЗО
 * code from the 31st day of the same absence (ЗЗО: the first 30 days on the employer, then the Fund).
 */
import { r2 } from '../money';
import { workHoursBetween, monthEnd, type Holiday } from './calendar';
import type { PayLine, PsifCode } from './calc';

export interface PayAbsence { id: string; employeeId: string; code: string; from: string; to: string; docNo?: string | null; note?: string | null }

/** Absence kinds offered on the screen: [code, label]. */
export const ABSENCE_KINDS: readonly (readonly [string, string])[] = [
  ['301', 'Породилно отсуство (ФЗО)'],
  ['201', 'Боледување – до 30 дена (на товар на работодавачот)'],
  ['203', 'Повреда на работа (работодавач, 100%)'],
  ['205', 'Малигна болест (работодавач)'],
  ['211', 'Боледување – над 30 дена (ФЗО)'],
  ['214', 'Нега на дете / член на семејство (ФЗО)'],
  ['216', 'Бременост / ризична бременост (ФЗО)'],
  ['401', 'Годишен одмор'],
  ['402', 'Платено отсуство'],
  ['403', 'Неплатено отсуство'],
  ['404', 'Стручно оспособување / обука'],
];

/** Employer sick-leave codes and the ФЗО code they turn into from the 31st day. */
export const SICK_AFTER_30: Readonly<Record<string, string>> = { '201': '211', '202': '211', '206': '211', '207': '211', '203': '212', '204': '212', '205': '213' };

/** Marks the lines made from the absence register (re-applying replaces them, hand-made lines stay). */
export const ABSENCE_MARK = '·евид.';
export const isAbsenceLine = (type: string): boolean => type.endsWith(ABSENCE_MARK);

const dayAdd = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dm = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7);
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;

/** Calendar days of an absence (inclusive). */
export const absenceDays = (a: Pick<PayAbsence, 'from' | 'to'>): number => (a.to >= a.from ? days(a.from, a.to) : 0);

/** Two absences of the same employee overlap. */
export const absencesOverlap = (a: Pick<PayAbsence, 'from' | 'to'>, b: Pick<PayAbsence, 'from' | 'to'>): boolean => a.from <= b.to && b.from <= a.to;

/**
 * The lines of `month` for one employee's absences. `scale` = the employee's hour fund / the full fund (part time);
 * `psif` = the code table. Each line is „<name> dd.mm–dd.mm ·евид.“ with the hours of its days in the month.
 */
export function absenceLines(month: string, A: readonly PayAbsence[], psif: readonly PsifCode[], o: { scale?: number; extra?: readonly Holiday[] } = {}): PayLine[] {
  const m0 = month + '-01', m1 = monthEnd(month);
  const code = (c: string) => psif.find((p) => p.code === c);
  const out: PayLine[] = [];
  const seg = (c: string, from: string, to: string) => {
    const f = from < m0 ? m0 : from, t = to > m1 ? m1 : to;
    if (f > t) return;
    const h = r2(workHoursBetween(month, f, t, o.extra ?? []).work * (o.scale ?? 1));
    if (!h) return;
    const P = code(c);
    out.push({
      type: `${P?.name ?? 'Отсуство ' + c} ${dm(f)}–${dm(t)} ${ABSENCE_MARK}`, code: c, hours: h,
      pct: P?.pct ?? 100, cat: (P?.cat as PayLine['cat']) || 'odm', payer: P?.payer ?? '', mpin: P?.mpin ?? '',
    });
  };
  for (const a of [...A].sort((x, y) => x.from.localeCompare(y.from))) {
    if (a.to < m0 || a.from > m1 || a.to < a.from) continue;
    const fzo = SICK_AFTER_30[a.code];
    if (fzo && absenceDays(a) > 30) {
      const d30 = dayAdd(a.from, 29);
      seg(a.code, a.from, d30 < a.to ? d30 : a.to);
      seg(fzo, dayAdd(a.from, 30), a.to);
    } else seg(a.code, a.from, a.to);
  }
  return out;
}
