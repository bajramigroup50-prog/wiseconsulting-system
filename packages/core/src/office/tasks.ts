/** Office tasks — legacy `INST` / `TTYPE` / `TST` / `taskSet` (3874–3913). */

export const INST = ['ЦРСМ', 'УЈП', 'АВРМ', 'ФЗО', 'ПИОМ', 'Банка', 'Суд', 'Општина', 'Нотар', 'Друго'] as const;
export const TTYPE = ['Поднесување документ', 'Подигнување документ', 'Плаќање / уплата', 'Потпис / заверка', 'Барање / потврда', 'Основање фирма', 'Друго'] as const;

export const TASK_STATUS = ['new', 'assigned', 'progress', 'done', 'problem'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];
/** [label, pill class] */
export const TST: Record<TaskStatus, readonly [string, string]> = {
  new: ['Нова', 'info'],
  assigned: ['Доделена', 'warn'],
  progress: ['Во тек', 'warn'],
  done: ['Завршена', 'good'],
  problem: ['Проблем / вратена', 'bad'],
};
export const isTaskStatus = (s: unknown): s is TaskStatus => typeof s === 'string' && (TASK_STATUS as readonly string[]).includes(s);

export interface TaskHist { at: string; by: string; st: string; note: string }

/** Legacy `taskSet`: new status + history entry; `doneAt` stamped when finished. */
export function taskTransition(
  t: { status: string; hist: readonly TaskHist[] },
  st: TaskStatus, by: string, note = '', now = new Date(),
): { status: TaskStatus; hist: TaskHist[]; doneAt?: Date } {
  const hist = [...t.hist, { at: now.toISOString(), by, st, note }];
  return st === 'done' ? { status: st, hist, doneAt: now } : { status: st, hist };
}

/** Field workers (teren) may only move their own tasks along this path (legacy `mz*` handlers). */
export const TEREN_STATUSES: readonly TaskStatus[] = ['progress', 'done', 'problem'];

/** Overdue = has a due date before today and is not done. */
export const taskLate = (t: { due?: string | null; status: string }, today: string) => !!t.due && t.due < today && t.status !== 'done';
