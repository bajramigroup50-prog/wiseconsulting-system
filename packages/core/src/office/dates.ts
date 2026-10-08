/** Small calendar helpers for the office modules. All dates are `YYYY-MM-DD` strings (no time zone drift). */

export const MON_MK = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'] as const;

const at = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`);
export const ymd = (x: Date): string => x.toISOString().slice(0, 10);

/** Today in Europe/Skopje (the office's calendar day, regardless of server TZ). */
export const todaySkopje = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Skopje', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Whole days from `a` to `b` (b − a). */
export const daysBetween = (a: string, b: string): number => Math.round((at(b).getTime() - at(a).getTime()) / 864e5);

export const addDays = (d: string, n: number): string => { const x = at(d); x.setUTCDate(x.getUTCDate() + n); return ymd(x); };

/** Legacy `dosAddM`/`ymAdd`: add months, clamping to the month's last day. */
export function addMonths(d: string, n: number): string {
  const x = at(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const dim = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, dim));
  return ymd(x);
}

/** `YYYY-MM` + n months. */
export const ymAdd = (ym: string, n: number): string => addMonths(`${ym}-01`, n).slice(0, 7);

export const dmy = (d: string | null | undefined): string => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');

/** Legacy `fmt` (`1.234.567,89`), by hand so it doesn't depend on the runtime's ICU data. */
export const fmtMk = (n: number): string => {
  const v = Number(n) || 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.') as [string, string];
  return (v < 0 && (i !== '0' || d !== '00') ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};
