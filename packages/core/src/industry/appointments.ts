/**
 * Appointments (legacy 10111–10169): working hours and resources, time slots, clashes, reminder text.
 * Config (legacy `firm.svc`, FIX 10.4 item 7: `settings.industry.appt`).
 */
import { num } from './common';

export interface ApptResource { id: string; name: string }
export interface ApptConfig { from: string; to: string; step: number; res: ApptResource[]; /** FIX 10.4 item 5: default VAT rate of a service without an item. */ rate: number }
export const APPT_DEFAULTS: ApptConfig = { from: '08:00', to: '20:00', step: 30, res: [], rate: 18 };
export const apptConfig = (o: Partial<ApptConfig> | null | undefined): ApptConfig => ({ ...APPT_DEFAULTS, ...(o ?? {}) });

export const APPT_STATUS = {
  booked: ['закажан', 'info', '#cfe0ff'], arrived: ['пристигна', 'warn', '#ffd9a8'], done: ['завршен', 'good', '#cfeedd'],
  noshow: ['не дојде', 'bad', '#f6c9c9'], cancel: ['откажан', '', '#eee'],
} as const;

export const tMin = (t: string | null | undefined): number => {
  const [h0, m0] = String(t || '0:0').split(':').map(Number);
  return (h0 || 0) * 60 + (m0 || 0);
};
export const mTime = (n: number): string => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

/** Day slots from the working hours (legacy `VIEWS.termini`). */
export function apptSlots(c: Pick<ApptConfig, 'from' | 'to' | 'step'>): number[] {
  const S: number[] = [];
  const step = Math.max(5, num(c.step) || 30);
  for (let t = tMin(c.from); t < tMin(c.to); t += step) S.push(t);
  return S;
}

export interface ApptLike { id?: string | null; date: string; time: string; dur?: number | string | null; res: string; status?: string }

/** Legacy `aptClash`: another active appointment of the same resource overlapping in time. */
export function apptClash<T extends ApptLike>(L: readonly T[], a: ApptLike): T | undefined {
  const s = tMin(a.time), e = s + (num(a.dur) || 30);
  return L.find((x) => x.id !== a.id && x.status !== 'cancel' && x.date === a.date && x.res === a.res && s < tMin(x.time) + (num(x.dur) || 30) && e > tMin(x.time));
}

/** Legacy `apMsg`: reminder text. */
export const apptReminder = (a: { date: string; time: string; svc?: string | null }, resName: string, firm: { name: string; address?: string | null; phone?: string | null }) =>
  `Почитувани, Ве потсетуваме на Вашиот термин ${a.date.split('-').reverse().join('.')} во ${a.time}${resName ? ' кај ' + resName : ''}${a.svc ? ' (' + a.svc + ')' : ''} – ${firm.name}${firm.address ? ', ' + firm.address : ''}. За откажување јавете се на ${firm.phone ?? ''}.`;
