import type { EdPurchase } from '@/components/sales/model';

/**
 * „Податоци за малопродажна калкулација“ like the old program Helix: the header of a goods document is entered first
 * (Калкулација број, ОЕ, Налог, Терк, Во магацин / Во продавница, датуми, Комитент, По документ, Број на испратница,
 * Архивски број, Генерален рабат, Повикување на, Забелешка, Тип, Салдо, Прилог, Трошок / Наплата and on „Посебни“ the
 * linked earlier / advance calculations), then the chosen Тип opens the right WISE document with the header filled in.
 *
 * The header travels to that document's editor as `?hx=` (base64url JSON) – nothing is saved before the document itself
 * („Зачувај и книжи“ of its own editor, its own posting). The fields WISE has no column for are kept in the document's
 * `data` (`hx…` keys) where the document has one (purchases).
 */

export const KALK_TIPS = [
  ['in', 'Фактура влезна'],
  ['ret', 'Повратница/производство'],
  ['disp', 'Прием по испратница'],
  ['niv', 'Нивелација'],
  ['out', 'Фактура излезна'],
  ['par', 'Парагон'],
  ['ord', 'Нарачка'],
  ['pop', 'Контролен попис'],
] as const;
export type KalkTip = (typeof KALK_TIPS)[number][0];

export interface KalkHeader {
  calcNo: string; oe: string; nalog: string; terk: string; wh: string; store: string; terkDest: string;
  date: string; docDate: string; due: string; partnerId: string; doc: string; dispNo: string; archNo: string;
  rabat: string; ref: string; note: string; tip: KalkTip; saldo: boolean; prilog: string; tn: 'nap' | 'tr';
  vid: 'red' | 'av'; links: string[];
}

export const blankHeader = (date: string, over: Partial<KalkHeader> = {}): KalkHeader => ({
  calcNo: '', oe: '', nalog: '', terk: '', wh: '', store: '', terkDest: '', date, docDate: date, due: date, partnerId: '', doc: '', dispNo: '',
  archNo: '', rabat: '', ref: '', note: '', tip: 'in', saldo: false, prilog: '', tn: 'nap', vid: 'red', links: [], ...over,
});

const b64 = (s: string) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return typeof atob === 'function' ? decodeURIComponent(escape(atob(t))) : Buffer.from(t, 'base64').toString('utf8');
};

export const encodeHeader = (h: KalkHeader) => b64(JSON.stringify(h));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The header of `?hx=` (anything malformed → null; strings are cut, dates must be ISO). */
export function decodeHeader(v: string | undefined | null): KalkHeader | null {
  if (!v) return null;
  try {
    const o = JSON.parse(unb64(v)) as Record<string, unknown>;
    const d = (k: string) => (ISO.test(str(o[k])) ? str(o[k]) : '');
    const tip = KALK_TIPS.some(([k]) => k === o.tip) ? (o.tip as KalkTip) : 'in';
    if (!d('date')) return null;
    return {
      calcNo: str(o.calcNo, 30), oe: str(o.oe, 30), nalog: str(o.nalog, 30), terk: str(o.terk, 30), wh: str(o.wh, 60), store: str(o.store, 60), terkDest: str(o.terkDest, 30),
      date: d('date'), docDate: d('docDate'), due: d('due'), partnerId: str(o.partnerId, 60), doc: str(o.doc, 60), dispNo: str(o.dispNo, 60), archNo: str(o.archNo, 60),
      rabat: /^\d+([.,]\d+)?$/.test(str(o.rabat)) ? str(o.rabat).replace(',', '.') : '', ref: str(o.ref, 100), note: str(o.note, 500), tip, saldo: o.saldo === true,
      prilog: str(o.prilog, 100), tn: o.tn === 'tr' ? 'tr' : 'nap', vid: o.vid === 'av' ? 'av' : 'red',
      links: Array.isArray(o.links) ? o.links.filter((x): x is string => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, 60)) : [],
    };
  } catch { return null; }
}

/** The object of the document: „Во продавница“ wins over „Во магацин“ (`main` = Главен магацин). */
export const headerLocation = (h: KalkHeader) => h.store || h.wh || '';

/** Where the chosen Тип opens (the WISE document type), with the header as `hx`. */
export function headerHref(h: KalkHeader): string {
  const hx = 'hx=' + encodeHeader(h);
  const loc = headerLocation(h);
  const wh = loc && loc !== 'main' ? '&wh=' + encodeURIComponent(loc) : '';
  switch (h.tip) {
    case 'in': case 'disp': return `/vlez?nov&${hx}`;
    case 'ret': return `/povratDob?nov&${hx}`;
    case 'niv': return `/nivel?nov&${hx}`;
    case 'out': return '/izlez?nov';
    case 'par': return `/m_izlez?t=sale&nov${wh}&${hx}`;
    case 'pop': return `/m_izlez?t=pop&nov${wh}&${hx}`;
    case 'ord': return `/porachki?nov&${hx}`;
  }
}

/** One line of the header that the document has no field for (its note / the purchase's `data.note`). */
export function headerNote(h: KalkHeader): string {
  const P: string[] = [];
  if (h.doc) P.push('По документ ' + h.doc);
  if (h.dispNo) P.push('Испратница ' + h.dispNo);
  if (h.archNo) P.push('Арх. бр. ' + h.archNo);
  if (h.ref) P.push('Повикување на ' + h.ref);
  return [h.note.trim(), P.join(' · ')].filter(Boolean).join(' – ');
}

/** The header fields a purchase has no column for → its `data` (strings, like the editor's other `data`). */
export function headerPurchaseData(h: KalkHeader): Record<string, string> {
  const o: Record<string, string> = { hxTip: h.tip, hxTn: h.tn, hxVid: h.vid, saldo: h.saldo ? 'Д' : 'Н' };
  const put = (k: string, v: string) => { if (v.trim()) o[k] = v.trim(); };
  // the purchase editor's own fields: Орг. ед. (ОЕ), Терк, Рабат – Редовен, Белешки
  put('oe', h.oe); put('terk', h.terk); put('hxNalog', h.nalog); put('hxTerkDest', h.terkDest); put('hxStore', h.store);
  put('hxDispNo', h.dispNo); put('hxArchNo', h.archNo); put('rabReg', h.rabat.replace(',', '.')); put('hxRef', h.ref); put('hxPrilog', h.prilog);
  put('memo', headerNote(h));
  if (h.links.length) o.hxLinks = h.links.join(',');
  return o;
}

/** A new purchase (Материјално › Влез) from the header: калк. број, датуми, комитент, По документ, објект, `data`. */
export function headerIntoPurchase(init: EdPurchase, h: KalkHeader): EdPurchase {
  const loc = headerLocation(h);
  return {
    ...init, calcNo: h.calcNo, date: h.date, docDate: h.docDate || h.date, due: h.due, partnerId: h.partnerId, number: h.doc || (h.tip === 'disp' ? h.dispNo : ''),
    warehouseId: loc === 'main' ? '' : loc, ptype: 'stock', data: { ...init.data, ...headerPurchaseData(h) },
  };
}
