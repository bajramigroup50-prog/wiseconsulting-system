/**
 * Autopilot tab „Затворање на период“ (legacy `apCloseHTML` 16399 + `apClDdvHTML` 16422): which VAT period each firm
 * closes for the chosen mode, and the input check of a custom period.
 */
export type ApClMode = 'auto' | 'm' | 'q' | string;

const pad = (n: number) => String(n).padStart(2, '0');

/** Previous month `YYYY-MM` of a date. */
export function prevMonth(td: string): string {
  let y = +td.slice(0, 4), m = +td.slice(5, 7) - 1;
  if (!m) { m = 12; y--; }
  return `${y}-${pad(m)}`;
}
/** Previous quarter `YYYY-ТN` of a date. */
export function prevQuarter(td: string): string {
  let y = +td.slice(0, 4), q = Math.ceil(+td.slice(5, 7) / 3) - 1;
  if (!q) { q = 4; y--; }
  return `${y}-Т${q}`;
}

/** Legacy custom input: `2026-09` or `2026-Т3` (Latin T accepted). `null` = invalid. */
export function apClCustom(s: string | null | undefined): string | null {
  const v = String(s ?? '').trim().replace(/-[TТtт]([1-4])$/, '-Т$1');
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) || /^\d{4}-Т[1-4]$/.test(v) ? v : null;
}

/**
 * The period a firm closes in this mode, or `null` when its VAT period does not match (monthly firms close by month,
 * quarterly by quarter — legacy message „месечните се затвораат по месец, квартални по квартал“).
 */
export function apClPeriodFor(mode: ApClMode, kind: 'month' | 'quarter', td: string): string | null {
  if (mode === 'auto') return kind === 'month' ? prevMonth(td) : prevQuarter(td);
  if (mode === 'm') return kind === 'month' ? prevMonth(td) : null;
  if (mode === 'q') return kind === 'quarter' ? prevQuarter(td) : null;
  const p = apClCustom(mode);
  if (!p) return null;
  return (p.includes('Т') ? 'quarter' : 'month') === kind ? p : null;
}

export const AP_CL_MODES = (td: string): [string, string][] => {
  const pm = prevMonth(td), pq = prevQuarter(td);
  return [['auto', 'Претходен ДДВ период на секоја фирма (месец/квартал)'], ['m', `Претходен месец (${pm.slice(5)}/${pm.slice(0, 4)})`], ['q', `Претходен квартал (${pq.replace('-Т', ' – Т')})`]];
};

/** ДДВ-04 fields shown per firm (legacy `apClF`). */
export const AP_CL_FIELDS = ['01', '02', '03', '04', '05', '06', '21', '22'] as const;
