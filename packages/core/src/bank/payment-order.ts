/**
 * Payment-order account helpers (legacy ПП30/ПП50: `ppDig` 15759, `ppIban` 15760, `ppIbanOn` 15761,
 * `ppAccTxt` 15762) plus validation the legacy app did not have.
 */

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Remainder of a long digit string mod 97 (ISO 7064). */
function mod97(num: string): number {
  let r = 0;
  for (const c of num) r = (r * 10 + +c) % 97;
  return r;
}

/**
 * Legacy `ppIban`: 15-digit MK account → `MKkk` + account (check digits by mod-97 over
 * account + "MK00" → "2220" + "00"). '' when the input is not 15 digits.
 */
export function ppIban(acc: unknown): string {
  const b = digits(acc);
  if (b.length !== 15) return '';
  return 'MK' + String(98 - mod97(b + '2220' + '00')).padStart(2, '0') + b;
}

/** Legacy `ppIbanOn`: payment orders show IBANs from 2026-11-01. */
export const ppIbanOn = (date: string): boolean => date >= '2026-11-01';

/** Legacy `ppAccTxt`: `XXX-XXXXXXXXXX-XX` before the IBAN date, IBAN after (or when forced). */
export function ppAccTxt(acc: unknown, date: string, forceIban?: boolean): string {
  const b = digits(acc);
  if (b.length !== 15) return String(acc ?? '');
  return (forceIban ?? ppIbanOn(date)) ? ppIban(b) : b.slice(0, 3) + '-' + b.slice(3, 13) + '-' + b.slice(13);
}

/** Generic IBAN validation (ISO 13616 mod-97 = 1). MK IBANs must be 19 characters. Spaces ignored. */
export function ibanValid(iban: unknown): boolean {
  const s = String(iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith('MK') && s.length !== 19) return false;
  const re = s.slice(4) + s.slice(0, 4);
  const num = re.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  return mod97(num) === 1;
}

/**
 * Macedonian 15-digit transaction account check (not in legacy): 3-digit bank code + 10 digits +
 * 2 control digits = 98 − (first 13 digits × 100 mod 97) (ISO 7064 MOD 97-10, NBRM rule).
 * Accepts `XXX-XXXXXXXXXX-XX` or spaces. Also accepts an MK IBAN.
 */
export function mkAccountValid(acc: unknown): boolean {
  const raw = String(acc ?? '').replace(/\s+/g, '').toUpperCase();
  if (raw.startsWith('MK')) return ibanValid(raw) && mkAccountValid(raw.slice(4));
  if (/[^\d-]/.test(raw)) return false;
  const b = digits(raw);
  if (b.length !== 15) return false;
  return 98 - mod97(b.slice(0, 13) + '00') === +b.slice(13);
}

/** Bank code (first 3 digits) of an MK account or IBAN — legacy `bankCodeOf` (12716). */
export function bankCodeOf(s: unknown): string {
  const t = String(s ?? '');
  const m = t.match(/MK\s*\d{2}\s*(\d{3})/i);
  if (m) return m[1]!;
  const d = t.replace(/\D/g, '');
  if (d.length === 15) return d.slice(0, 3);
  if (d.length === 13 && /^0/.test(d)) return '300';
  return '';
}

/** Macedonian bank registry used for detection (legacy `BANKS_MK` 12709, names + BIC only). */
export const BANKS_MK: Record<string, { n: string; bic: string }> = {
  '270': { n: 'Халк Банка', bic: 'EXPCMK22' },
  '300': { n: 'Комерцијална Банка', bic: 'KOBSMK2X' },
  '380': { n: 'ПроКредит Банка', bic: 'PRBUMK22' },
  '200': { n: 'Стопанска Банка', bic: 'STOBMK2X' },
  '210': { n: 'НЛБ Банка', bic: 'TUTNMK22' },
  srb: { n: 'Силк Роуд Банка', bic: '' },
};

/** Legacy `bankByText` (12717): detect the bank from file text or name. */
export function bankByText(text: unknown): string {
  const t = String(text ?? '');
  for (const [c, b] of Object.entries(BANKS_MK)) if (b.bic && t.includes(b.bic)) return c;
  if (/силк\s*роуд|silk\s*road/i.test(t)) return 'srb';
  if (/комерцијална банка|komercijalna|kb\.mk|KBFileFormat/i.test(t)) return '300';
  if (/халк|halk/i.test(t)) return '270';
  if (/стопанска|stopanska/i.test(t)) return '200';
  if (/нлб|nlb/i.test(t)) return '210';
  if (/прокредит|procredit/i.test(t)) return '380';
  const ib = t.match(/MK\s?07\s?(\d{3})/);
  if (ib) return ib[1]!;
  return '';
}
