/**
 * „Аконтативна пресметка“ from УЈП е-ПДД (PDF): the payer's data and one row per recipient (ЕМБГ, name, account,
 * income type, gross, deductions, ПДД, net) → the rows of „Закупнина, бонуси и услуги“ (`PddRow`, gross mode).
 * The PDF is a landscape page: depending on the producer its text runs along x or along y, so rows are banded on the
 * axis along which the ЕМБГs differ and the columns are read in order on the other one.
 */
import type { PdfItem } from './noai/pdf-lines';

export interface AkontRow { embg: string; name: string; acct: string; code: string; vid: string; pod: string; gross: number; ded: number; tax: number; net: number }
export interface Akont { number: string; date: string; payDate: string; edb: string; rows: AkontRow[] }

const MONEY = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const money = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const iso = (d: string) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d.trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

export function parseAkontativna(items: readonly PdfItem[]): Akont | null {
  const I = items.map((i) => ({ ...i, s: i.s.trim() })).filter((i) => i.s);
  if (!I.some((i) => /Аконтативна пресметка/i.test(i.s))) return null;
  const E = I.filter((i) => /^\d{13}$/.test(i.s));
  // the recipients' ЕМБГ (the payer's ЕДБ is also 13 digits: it sits in the header, next to „ЕДБ/ЕМБГ“)
  const hdr = I.find((i) => /^ЕДБ\/ЕМБГ$/.test(i.s));
  const near = (a: PdfItem, b: PdfItem) => Math.abs(a.x - b.x) < 6 || Math.abs(a.y - b.y) < 6;
  const edbItem = hdr ? E.find((e) => near(e, hdr) && E.filter((x) => x !== e).every((x) => !near(x, hdr))) : undefined;
  const R = E.filter((e) => e !== edbItem);
  if (!R.length) return null;
  // the table's header labels („ЕМБГ“ … „Име и Презиме“) lie on one line: the rows run across that line's axis (also
  // with a single recipient); without the labels, the axis on which the recipients differ
  const h1 = I.find((i) => /^ЕМБГ$/.test(i.s)), h2 = I.find((i) => /^Име и Презиме$/i.test(i.s));
  const spread = (k: 'x' | 'y') => Math.max(...R.map((r) => r[k])) - Math.min(...R.map((r) => r[k]));
  const band: 'x' | 'y' = h1 && h2 ? (Math.abs(h1.x - h2.x) < Math.abs(h1.y - h2.y) ? 'x' : 'y') : R.length < 2 ? 'y' : spread('x') >= spread('y') ? 'x' : 'y';
  const col: 'x' | 'y' = band === 'x' ? 'y' : 'x';
  const rows: AkontRow[] = [];
  for (const e of R) {
    const own = I.filter((i) => i !== e && i[band] >= e[band] - 3 && i[band] <= e[band] + 13).sort((a, b) => a[col] - b[col]);
    const after = own.filter((i) => i[col] > e[col]);
    const name = after.find((i) => /\p{L}/u.test(i.s) && !/^T\d|^S\d|Доход|Примања|извршени|Трансак/i.test(i.s))?.s ?? '';
    const acct = after.find((i) => /^\d{15}$/.test(i.s))?.s ?? '';
    const sIdx = after.findIndex((i) => /^S\d+\.\d+/.test(i.s));
    const code = /S\d+\.\d+/.exec(after[sIdx]?.s ?? '')?.[0] ?? '';
    // income type („T1. Доход од работа“) and subtype – the subtype text may run over two lines
    const vid = after.find((i) => /^T\d+\./.test(i.s))?.s ?? '';
    const pod = sIdx < 0 ? '' : [after[sIdx]!.s, ...after.slice(sIdx + 1).filter((i) => Math.abs(i[col] - after[sIdx]![col]) < 3).map((i) => i.s)].join(' ').replace(/\s+/g, ' ').trim();
    const M = after.filter((i) => MONEY.test(i.s)).map((i) => money(i.s));
    // gross, deductions, ПДД, net – in this order along the row
    if (M.length < 4) continue;
    const [gross, ded, tax, net] = M as [number, number, number, number];
    rows.push({ embg: e.s, name, acct, code, vid, pod, gross, ded, tax, net });
  }
  if (!rows.length) return null;
  const valueAfter = (label: RegExp, re: RegExp) => {
    const l = I.find((i) => label.test(i.s));
    if (!l) return '';
    const cand = I.filter((i) => re.test(i.s) && Math.abs(i[band === 'x' ? 'x' : 'y'] - l[band === 'x' ? 'x' : 'y']) < 6 && i[col] > l[col]).sort((a, b) => a[col] - b[col]);
    return cand[0]?.s ?? '';
  };
  const D = /^\d{2}\.\d{2}\.\d{4}$/;
  return {
    number: valueAfter(/^Број на пресметка/i, /^\d{6,}$/),
    date: iso(valueAfter(/^Датум на поднесување/i, D)),
    payDate: iso(valueAfter(/^Датум на плаќање/i, D)),
    edb: edbItem?.s ?? '',
    rows,
  };
}
