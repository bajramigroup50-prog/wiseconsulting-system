/** GDPR / ЗЗЛП register — legacy `ZZ_SUB_DEF` / `ZZ_CHK` (15364–15375) and the `zzlp` screen. */

/** Default sub-processors [name, address, purpose, transfer basis]. */
export const ZZ_SUB_DEF = [
  ['Hetzner Online GmbH', 'Industriestr. 25, 91710 Gunzenhausen, Германија', 'Хостинг на серверите (центри за податоци во Германија и Финска – ЕУ)', 'ЕУ'],
  ['Anthropic PBC', '548 Market St, San Francisco, CA 94104, САД', 'Автоматско читање (AI) на скенирани документи – само кога се користи скенирање', 'САД – со стандардни договорни клаузули (DPA на Anthropic)'],
] as const;

/** Office compliance checklist [id, text]. */
export const ZZ_CHK = [
  ['hz', 'Договор за обработка (DPA) со Hetzner – прифатен во Hetzner Console'],
  ['an', 'DPA со Anthropic (AI) – проверен/прифатен (console.anthropic.com)'],
  ['cl', 'Договор за обработка потпишан со секој клиент (табела долу)'],
  ['iz', 'Изјави за доверливост потпишани од сите вработени'],
  ['bk', 'Дневна шифрирана копија се чува и во канцеларијата (Македонија)'],
  ['uj', 'Барање за мислење до УЈП (чл. 47 ст. 3 ЗДП) – испратено'],
] as const;

/** Register record kinds. */
export const GDPR_KINDS = {
  dpa: 'Договор за обработка на лични податоци (со клиент)',
  izjava: 'Изјава за доверливост (вработен)',
  activity: 'Збирка / активност на обработка',
  breach: 'Инцидент / повреда на безбедноста',
  request: 'Барање од субјект (пристап, бришење…)',
} as const;
export type GdprKind = keyof typeof GDPR_KINDS;
export const isGdprKind = (k: unknown): k is GdprKind => typeof k === 'string' && k in GDPR_KINDS;

/**
 * Breach notification deadline: 72 hours from discovery (ЗЗЛП чл. 37 / GDPR чл. 33).
 * Subject requests: answer within 30 days (ЗЗЛП чл. 15).
 */
export function gdprDue(kind: GdprKind, from: string): string | null {
  const d = new Date(`${from.slice(0, 10)}T12:00:00Z`);
  if (kind === 'breach') d.setUTCDate(d.getUTCDate() + 3);
  else if (kind === 'request') d.setUTCDate(d.getUTCDate() + 30);
  else return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Mask an ЕМБГ for lists (FIX(#5): legacy kept typed ЕМБГ values in localStorage and showed them in full;
 * the rebuild stores them only server-side and masks them in overviews).
 */
export const maskEmbg = (e: string | null | undefined) => {
  const s = String(e ?? '').replace(/\D/g, '');
  return s.length >= 6 ? `${s.slice(0, 2)}${'•'.repeat(s.length - 4)}${s.slice(-2)}` : s ? '•'.repeat(s.length) : '';
};
