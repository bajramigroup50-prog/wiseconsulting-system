/**
 * Amount in Macedonian words — legacy `mkWords` (index.html 4210), ported verbatim.
 * Only the whole part is spelled out; callers append the cents as `и NN/100`.
 */
const U = ['', 'еден', 'два', 'три', 'четири', 'пет', 'шест', 'седум', 'осум', 'девет'];
const UF = ['', 'една', 'две', 'три', 'четири', 'пет', 'шест', 'седум', 'осум', 'девет'];
const TEEN = ['десет', 'единаесет', 'дванаесет', 'тринаесет', 'четиринаесет', 'петнаесет', 'шеснаесет', 'седумнаесет', 'осумнаесет', 'деветнаесет'];
const TENS = ['', '', 'дваесет', 'триесет', 'четириесет', 'педесет', 'шеесет', 'седумдесет', 'осумдесет', 'деведесет'];
const HUN = ['', 'сто', 'двесте', 'триста', 'четиристотини', 'петстотини', 'шестстотини', 'седумстотини', 'осумстотини', 'деветстотини'];

const tri = (x: number, fem?: boolean): string[] => {
  const p: string[] = [];
  const hh = Math.floor(x / 100), r = x % 100;
  if (hh) p.push(HUN[hh]!);
  if (r >= 10 && r < 20) p.push(TEEN[r - 10]!);
  else {
    if (r >= 20) p.push(TENS[Math.floor(r / 10)]!);
    if (r % 10) p.push((fem ? UF : U)[r % 10]!);
  }
  return p;
};
const join = (p: string[]): string => (p.length > 1 ? p.slice(0, -1).join(' ') + ' и ' + p[p.length - 1] : p.join(''));
const one = (x: number) => x % 10 === 1 && x % 100 !== 11;

export function mkWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (!n) return 'нула';
  const mil = Math.floor(n / 1e6), th = Math.floor(n / 1000) % 1000, rest = n % 1000;
  const out: string[] = [];
  if (mil) out.push(mil === 1 ? 'еден милион' : join(tri(mil)) + (one(mil) ? ' милион' : ' милиони'));
  if (th) out.push(th === 1 ? 'илјада' : join(tri(th, true)) + (one(th) ? ' илјада' : ' илјади'));
  if (rest) {
    const p = tri(rest);
    out.push(out.length && p.length === 1 ? 'и ' + p[0] : join(p));
  }
  return out.join(' ');
}

/** "… денари и NN/100" as printed on invoices (legacy docHTML). */
export function amountInWords(amount: number, currency = 'денари'): string {
  const a = Math.abs(amount);
  const cents = Math.round((a - Math.floor(a)) * 100) % 100;
  return `${mkWords(a)} ${currency}${cents ? ' и ' + cents + '/100' : ''}`;
}
