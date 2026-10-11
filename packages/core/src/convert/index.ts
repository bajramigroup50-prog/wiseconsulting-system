/**
 * „🔄 Конвертор на датотеки“ — a file of another program / bank / supplier (Excel, CSV, XML, PDF with text) is turned
 * into the import format of one of the program's importers, without AI:
 *
 *   source grid → header row → column mapping (automatic by heading, saved as a preset per layout) → target grid
 *   (the importer's own headings, numbers as numbers, dates as dd.mm.yyyy) → checked with the importer's OWN parser
 *   (`check`) → downloaded as .xlsx and imported on the target screen as usual.
 *
 * Targets: the generic importer (`IMP_T`: partners, items, employees, purchases, invoices, stock, journal, in, pop,
 * nivel), the opening balance / trial balance (`parseOpeningSheet`), bank statements (`parseBankTable`), firms
 * (`fimpParse`) and the payroll month (`plxParse`).
 */
import { parseBankTable } from '../bank-parsers';
import { fimpParse, fimpVatFlag, fimpVatPeriod } from '../firms/firmimp';
import { parseOpeningSheet } from '../ledger';
import { plxParse, PXL_COLS, type PxlKey } from '../payroll/xlsx-import';
import { detectDec, IMP_T, impAuto, impDate, impHeaderRow, impN, impNum, type DecMode, type ImpType } from '../retail/import';
import { parseXml, type XmlEl } from '../sales/xml';

export type ConvKind = 'text' | 'num' | 'date';
export interface ConvField {
  key: string; label: string; req?: boolean; syn: string[]; kind: ConvKind;
  /** Text value → the form the importer understands ('' = not recognised). */
  norm?: (s: string) => string;
}
export type ConvCell = string | number;
export type ConvRec = Record<string, ConvCell>;

export interface ConvTarget {
  id: string;
  title: string;
  /** Screen where the converted file is imported. */
  href: string;
  where: string;
  fields: readonly ConvField[];
  /** File / sheet name of the download. */
  file: string;
  /** Rows → target grid (header = the importer's headings). Default: one column per field, in field order. */
  build?: (recs: readonly ConvRec[]) => ConvCell[][];
  /** Read a target grid back with the importer's own parser → records keyed like `fields` (normalised values). */
  check: (grid: readonly (readonly unknown[])[]) => { rows: ConvRec[]; error?: string };
}

const syn = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const NUMK = new Set(['price', 'rate', 'min', 'weight', 'netBase', 'coef', 'qty', 'cost', 'amount', 'mpc', 'cnt', 'd', 'p', 'disc',
  'base18', 'vat18', 'base10', 'vat10', 'base5', 'vat5', 'base0', 'total']);
const DATEK = new Set(['date', 'due', 'start', 'end']);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** dd.mm.yyyy of an ISO date (what every importer reads). */
export const dmyOf = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

/* ------------------------------------------------------------------ generic importer (IMP_T) */

function impTarget(t: ImpType): ConvTarget {
  const T = IMP_T[t];
  const fields: ConvField[] = T.f.map(([key, label, s]) => {
    const l0 = label.replace('*', '');
    // the heading written into the file must be one the importer recognises for this field („OE броеви“ is not: „OE“)
    const head = [l0, ...syn(s)].find((h) => impAuto(t, [h])[key] === 0) ?? l0;
    return { key, label: head, req: label.includes('*'), syn: [l0, ...syn(s)], kind: NUMK.has(key) ? 'num' : DATEK.has(key) ? 'date' : 'text' };
  });
  return {
    id: 'imp:' + t, title: T.t, href: '/uvoz?t=' + t, where: 'Увоз од Excel / CSV / XML › ' + T.t,
    fields, file: 'Uvoz_' + t,
    // the importer itself: header row (`impHeaderRow`), columns by heading (`impAuto`), numbers / dates as in `importer.tsx`
    check: (grid) => {
      const hi = impHeaderRow(grid);
      const map = impAuto(t, grid[hi] ?? []);
      const dec = detectDec(grid.slice(hi + 1));
      const rows: ConvRec[] = [];
      for (const r of grid.slice(hi + 1)) {
        if (!r.some((c) => String(c ?? '').trim() !== '')) continue;
        const o: ConvRec = {};
        for (const f of fields) {
          const i = map[f.key];
          if (i == null) continue;
          const v = r[i];
          if (String(v ?? '').trim() === '') continue;
          o[f.key] = f.kind === 'num' ? impNum(v, dec) : f.kind === 'date' ? impDate(v) : String(v).trim();
        }
        rows.push(o);
      }
      const miss = fields.filter((f) => f.req && map[f.key] == null).map((f) => f.label);
      return { rows, ...(miss.length ? { error: 'Не се препознаени колоните: ' + miss.join(', ') } : {}) };
    },
  };
}

/* ------------------------------------------------------------------ opening balance / trial balance */

const OB_HEAD = ['Конто', 'Назив на конто', 'Комитент', 'Шифра на комитент / ЕДБ', 'Салдо должи', 'Салдо побарува'];
const obTarget: ConvTarget = {
  id: 'ob', title: 'Почетна состојба / бруто биланс', href: '/pocetna', where: 'Почетна состојба › Увоз од Excel', file: 'Pocetna_sostojba',
  fields: [
    { key: 'konto', label: 'Конто', req: true, syn: syn('конто,сметка,konto,account,llogaria,racun,шифра на конто'), kind: 'text' },
    { key: 'name', label: 'Назив на конто', syn: syn('назив на конто,назив,опис,naziv,name,emri'), kind: 'text' },
    { key: 'partner', label: 'Комитент', syn: syn('комитент,партнер,купувач,добавувач,partner,komitent,subjekt'), kind: 'text' },
    { key: 'code', label: 'Шифра на комитент / ЕДБ', syn: syn('шифра на комитент,едб,edb,даночен,embs,шифра на партнер'), kind: 'text' },
    { key: 'debit', label: 'Салдо должи', syn: syn('салдо должи,салдо д,должи,dolzi,duguje,debit,debi'), kind: 'num' },
    { key: 'credit', label: 'Салдо побарува', syn: syn('салдо побарува,салдо п,побарува,pobaruva,potrazuje,credit,kredi'), kind: 'num' },
    { key: 'saldo', label: 'Салдо (+ должи / − побарува)', syn: syn('салдо,saldo,balance,bilanc'), kind: 'num' },
  ],
  build: (R) => [OB_HEAD, ...R.map((r) => {
    let d = Number(r.debit) || 0, p = Number(r.credit) || 0;
    if (r.saldo !== undefined && r.saldo !== '' && !d && !p) { const s = Number(r.saldo) || 0; d = s > 0 ? s : 0; p = s < 0 ? -s : 0; }
    return [String(r.konto ?? ''), String(r.name ?? ''), String(r.partner ?? ''), String(r.code ?? ''), r2(d), r2(p)];
  })],
  check: (grid) => {
    const P = parseOpeningSheet(grid, 'excel');
    if (!P) return { rows: [], error: 'Не се најдени колони „Конто“ и „Салдо / Должи / Побарува“.' };
    return { rows: P.rows.map(([konto, name, partner, code, debit, credit]) => ({ konto, name, partner, code, debit: r2(debit), credit: r2(credit) })) };
  },
};

/* ------------------------------------------------------------------ bank statement */

const BANK_HEAD = ['Датум', 'Налогодавач / примач', 'Цел на дознака', 'Референца', 'Шифра на плаќање', 'Прилив', 'Одлив'];
const bankTarget: ConvTarget = {
  id: 'bank', title: 'Банкарски извод', href: '/banka', where: 'Банка › Увоз на извод (Excel)', file: 'Izvod',
  fields: [
    { key: 'date', label: 'Датум', req: true, syn: syn('датум на книжење,датум,дата,date,data,valuta'), kind: 'date' },
    { key: 'name', label: 'Налогодавач / примач', syn: syn('налогодавач,примач,партнер,назив,корисник,name,partner,emri,nalogodavac,primac'), kind: 'text' },
    { key: 'purpose', label: 'Цел на дознака', syn: syn('цел на дознака,цел,опис,намена,детали,purpose,description,pershkrimi,opis'), kind: 'text' },
    { key: 'ref', label: 'Референца', syn: syn('референца,реф,reference,ref,повикување'), kind: 'text' },
    { key: 'osnov', label: 'Шифра на плаќање', syn: syn('шифра на плаќање,основ,sifra,code'), kind: 'text' },
    { key: 'in', label: 'Прилив', syn: syn('прилив,побарува,во корист,уплата,credit,hyrje,priliv'), kind: 'num' },
    { key: 'out', label: 'Одлив', syn: syn('одлив,должи,на товар,исплата,debit,dalje,odliv'), kind: 'num' },
    { key: 'amount', label: 'Износ (+ прилив / − одлив)', syn: syn('износ,amount,shuma,iznos'), kind: 'num' },
  ],
  build: (R) => [BANK_HEAD, ...R.map((r) => {
    let i = Number(r.in) || 0, o = Number(r.out) || 0;
    if (!i && !o && r.amount !== undefined) { const a = Number(r.amount) || 0; i = a > 0 ? a : 0; o = a < 0 ? -a : 0; }
    return [String(r.date ?? ''), String(r.name ?? ''), String(r.purpose ?? ''), String(r.ref ?? ''), String(r.osnov ?? ''), i ? r2(i) : '', o ? r2(o) : ''];
  })],
  check: (grid) => {
    const st = parseBankTable(grid.map((r) => [...r]));
    if (!st) return { rows: [], error: 'Не се препознаени колоните „Датум“ и „Износ / Прилив / Одлив“.' };
    return { rows: st.lines.map((l) => ({ date: l.date, name: l.counterparty, purpose: l.purpose, ref: l.ref, osnov: l.osnov ?? '', amount: r2(l.amount / 100) })) };
  },
};

/* ------------------------------------------------------------------ firms */

/** VAT flag / period of another program („da“, „DA“, „mesecno“, „3M“ …) → the words the firm import reads. */
function normDdv(s: string): string {
  const l = latN(s);
  const b = /^(da|d|j|ja|po)$/.test(l) ? true : /^(ne|n)$/.test(l) ? false : fimpVatFlag(s);
  return b == null ? '' : b ? 'да' : 'не';
}
function normPer(s: string): string {
  const l = latN(s);
  const p = /tromes|kvartal|^3m?$|^q/.test(l) ? 'quarter' : /^mes|^1m?$|^m$/.test(l) ? 'month' : fimpVatPeriod(s);
  return p === 'month' ? 'месечно' : p === 'quarter' ? 'тромесечно' : '';
}

const firmsTarget: ConvTarget = {
  id: 'firms', title: 'Фирми (клиенти на канцеларијата)', href: '/firmiImp', where: 'Фирми › 📥 Увоз од Excel', file: 'Firmi',
  fields: [
    { key: 'code', label: 'Шифра', syn: syn('шифра,code,sifra,kodi'), kind: 'text' },
    { key: 'name', label: 'Име на фирма', req: true, syn: syn('име на фирма,назив,фирма,name,naziv,firma,emri'), kind: 'text' },
    { key: 'lf', label: 'Правна форма', syn: syn('правна форма,legal form,forma'), kind: 'text' },
    { key: 'edb', label: 'ЕДБ', syn: syn('едб,даночен број,edb,vat,nipt,tax'), kind: 'text' },
    { key: 'embs', label: 'Матичен број', syn: syn('матичен,embs,maticen'), kind: 'text' },
    { key: 'address', label: 'Адреса', syn: syn('адреса,address,adresa'), kind: 'text' },
    { key: 'city', label: 'Град', syn: syn('град,место,city,grad,qyteti'), kind: 'text' },
    { key: 'phone', label: 'Телефон', syn: syn('телефон,тел,phone,tel'), kind: 'text' },
    { key: 'email', label: 'Е-пошта', syn: syn('е-пошта,email,e-mail,маил'), kind: 'text' },
    { key: 'activity', label: 'Дејност', syn: syn('дејност,activity,dejnost'), kind: 'text' },
    { key: 'bank', label: 'Жиро сметка', syn: syn('жиро сметка,жиро,сметка,iban,account,ziro'), kind: 'text' },
    { key: 'bankName', label: 'Банка', syn: syn('банка,bank,banka'), kind: 'text' },
    { key: 'contact', label: 'Лице за контакт', syn: syn('лице за контакт,контакт,contact,управител'), kind: 'text' },
    { key: 'ddv', label: 'ДДВ (да/не)', syn: syn('ддв,ддв обврзник,vat payer,tvsh'), kind: 'text', norm: normDdv },
    { key: 'per', label: 'ДДВ период (месечно/тромесечно)', syn: syn('ддв период,период,vat period'), kind: 'text', norm: normPer },
  ],
  check: (grid) => {
    const P = fimpParse(grid);
    if ('error' in P) return { rows: [], error: P.error };
    return {
      rows: P.L.map((f) => {
        const o: ConvRec = {};
        for (const [k, v] of Object.entries(f)) {
          if (k === 'ddv') o.ddv = v === true ? 'да' : 'не';
          else if (k === 'per') o.per = v === 'month' ? 'месечно' : 'тромесечно';
          else o[k] = String(v);
        }
        return o;
      }),
    };
  },
};

/* ------------------------------------------------------------------ payroll month */

const PX_USE: PxlKey[] = ['embg', 'name', 'pos', 'oe', 'net', 'gross', 'coef', 'staz', 'start', 'reg', 'hol', 'odm', 'bol', 'bol30', 'ot', 'sun', 'night', 'holw', 'paid', 'bonus', 'ops', 'fzo'];
const PX_NUM = new Set<PxlKey>(['net', 'gross', 'coef', 'staz', 'reg', 'hol', 'odm', 'bol', 'bol30', 'ot', 'sun', 'night', 'holw', 'paid', 'bonus']);
const payTarget: ConvTarget = {
  id: 'pay', title: 'Плата (месец од Excel)', href: '/plati', where: 'Плати › 📥 Плата од Excel', file: 'Plata',
  fields: PX_USE.map((k) => {
    const c = PXL_COLS.find((x) => x[0] === k)!;
    return { key: k, label: c[1], req: k === 'embg' || k === 'name', syn: [c[1], ...syn(c[2])], kind: PX_NUM.has(k) ? 'num' : k === 'start' ? 'date' : 'text' } as ConvField;
  }),
  check: (grid) => {
    const P = plxParse(grid.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : String(c ?? '')))));
    if ('error' in P) return { rows: [], error: P.error };
    return {
      rows: P.rows.map((x) => {
        const o: ConvRec = {};
        if (x.embg) o.embg = x.embg;
        if (x.name) o.name = x.name;
        if (x.pos) o.pos = x.pos;
        if (x.oe) o.oe = x.oe;
        if (x.ops) o.ops = x.ops;
        if (x.fzo) o.fzo = x.fzo;
        if (x.start) o.start = x.start;
        for (const k of ['net', 'gross', 'coef', 'staz', 'reg', 'bonus'] as const) if (x[k] != null) o[k] = x[k]!;
        for (const [k, v] of Object.entries(x.hours)) if (v != null) o[k] = v;
        return o;
      }),
    };
  },
};

export const CONV_TARGETS: readonly ConvTarget[] = [
  bankTarget, obTarget,
  ...(['partners', 'items', 'employees', 'purchases', 'invoices', 'journal', 'stock', 'in', 'pop', 'nivel'] as ImpType[]).map(impTarget),
  firmsTarget, payTarget,
];
export const convTarget = (id: string): ConvTarget | undefined => CONV_TARGETS.find((t) => t.id === id);

/* ------------------------------------------------------------------ mapping */

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'g', е: 'e', ж: 'z', з: 'z', ѕ: 'dz', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', ќ: 'k', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's', ђ: 'd', ћ: 'c', й: 'j', ы: 'i', э: 'e', ю: 'ju', я: 'ja', щ: 's', ь: '', ъ: '',
};
/** Heading normalised to plain Latin (Cyrillic, „Šifra“, „Količina“ and „Sifra“ / „Kolicina“ compare equal). */
export const latN = (s: unknown): string =>
  impN(String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[а-яѓѕјљњќџђћ]/g, (c) => CYR[c] ?? c)).replace(/\s+/g, ' ');

/** Column per field from the source headings: exact heading / synonym first, then a synonym (> 2 chars) contained in it. */
export function convAuto(t: ConvTarget, hdr: readonly unknown[]): Record<string, number> {
  const H = hdr.map(latN);
  const map: Record<string, number> = {};
  const used = new Set<number>();
  const S = t.fields.map((f) => ({ f, s: [...new Set(f.syn.map(latN).filter(Boolean))] }));
  for (const { f, s } of S) {
    const i = H.findIndex((x, j) => !used.has(j) && x && s.includes(x));
    if (i >= 0) { map[f.key] = i; used.add(i); }
  }
  for (const { f, s } of S) {
    if (map[f.key] != null) continue;
    const i = H.findIndex((x, j) => !used.has(j) && x && s.some((y) => y.length > 2 && x.includes(y)));
    if (i >= 0) { map[f.key] = i; used.add(i); }
  }
  return map;
}

/** Header signature of a layout (for presets): normalised headings joined. */
export const convSig = (hdr: readonly unknown[]): string => hdr.map(impN).join('|').replace(/\|+$/, '');

const TOTAL = /^(вкупно|збир|сума|total|gjithsej|toplam|салдо на крај|ново салдо)/i;

export interface ConvResult { grid: ConvCell[][]; recs: ConvRec[]; errors: { row: number; msg: string }[]; skipped: number }

/**
 * Source rows (below the header) → records of the target fields → target grid. `consts` fills a field with a fixed
 * value (e.g. the date of a stock list). Rows without the required fields are reported and left out; empty rows and
 * total rows are skipped.
 */
export function convApply(t: ConvTarget, rows: readonly (readonly unknown[])[], map: Readonly<Record<string, number | undefined>>, o: { dec?: DecMode; consts?: Readonly<Record<string, string>>; firstRow?: number } = {}): ConvResult {
  const dec = o.dec ?? detectDec(rows);
  const recs: ConvRec[] = [];
  const errors: { row: number; msg: string }[] = [];
  let skipped = 0;
  rows.forEach((r, ri) => {
    const rowNo = (o.firstRow ?? 1) + ri;
    if (!r.some((c) => String(c ?? '').trim() !== '')) { skipped++; return; }
    if (r.slice(0, 3).some((c) => TOTAL.test(String(c ?? '').trim()))) { skipped++; return; }
    const rec: ConvRec = {};
    const bad: string[] = [];
    for (const f of t.fields) {
      const i = map[f.key];
      const raw = i != null && i >= 0 ? r[i] : o.consts?.[f.key];
      const s = raw instanceof Date ? impDate(raw) : String(raw ?? '').trim();
      if (!s) continue;
      if (f.kind === 'num') {
        const n = impNum(raw, dec);
        if (!n && !/^[-+]?0*([.,]0*)?$/.test(s.replace(/\s|ден\.?|mkd/gi, ''))) { bad.push(`${f.label}: „${s}“ не е број`); continue; }
        rec[f.key] = r4(n);
      } else if (f.kind === 'date') {
        const d = impDate(raw instanceof Date || typeof raw === 'number' ? raw : s);
        if (!d) { bad.push(`${f.label}: „${s}“ не е датум`); continue; }
        rec[f.key] = dmyOf(d);
      } else {
        const v = f.norm ? f.norm(s) : s;
        if (!v) { bad.push(`${f.label}: „${s}“ не е препознаено`); continue; }
        rec[f.key] = v;
      }
    }
    const miss = t.fields.filter((f) => f.req && (rec[f.key] === undefined || rec[f.key] === ''));
    // bank: either in / out or a signed amount; ob: debit / credit or saldo
    const noAmt = t.id === 'bank' ? rec.in === undefined && rec.out === undefined && rec.amount === undefined
      : t.id === 'ob' ? rec.debit === undefined && rec.credit === undefined && rec.saldo === undefined : false;
    if (miss.length || noAmt) {
      if (Object.keys(rec).length) errors.push({ row: rowNo, msg: 'недостасува: ' + [...miss.map((f) => f.label), ...(noAmt ? ['износ'] : [])].join(', ') });
      else skipped++;
      return;
    }
    if (bad.length) errors.push({ row: rowNo, msg: bad.join('; ') });
    recs.push(rec);
  });
  return { grid: convGrid(t, recs), recs, errors, skipped };
}

/** Records → target grid. */
export function convGrid(t: ConvTarget, recs: readonly ConvRec[]): ConvCell[][] {
  if (t.build) return t.build(recs);
  return [t.fields.map((f) => f.label), ...recs.map((r) => t.fields.map((f) => r[f.key] ?? ''))];
}

/**
 * Check the converted grid with the importer's own parser and compare it with what was converted: count and the
 * values of every field the parser returns. `diff` lists the first differences (empty = the importer reads exactly
 * what the converter produced).
 */
export function convCheck(t: ConvTarget, res: Pick<ConvResult, 'grid' | 'recs'>): { n: number; error?: string; diff: string[]; rows: ConvRec[] } {
  const c = t.check(res.grid);
  const diff: string[] = [];
  if (c.error) return { n: 0, error: c.error, diff, rows: [] };
  const exp = res.recs.map((r) => expected(t, r));
  if (c.rows.length !== exp.length) diff.push(`Програмата чита ${c.rows.length} реда, конвертирани се ${exp.length}.`);
  for (let i = 0; i < Math.min(c.rows.length, exp.length) && diff.length < 20; i++) {
    for (const [k, v] of Object.entries(exp[i]!)) {
      const got = c.rows[i]![k];
      if (!same(v, got)) diff.push(`Ред ${i + 1}, ${t.fields.find((f) => f.key === k)?.label ?? k}: „${v}“ → програмата чита „${got ?? ''}“`);
    }
  }
  return { n: c.rows.length, diff, rows: c.rows };
}

const same = (a: ConvCell, b: ConvCell | undefined) => {
  if (typeof a === 'number' || typeof b === 'number') return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
  return String(a ?? '').trim() === String(b ?? '').trim();
};

/** A converted record in the form `check` returns it (ISO dates, signed bank amount, debit / credit from saldo). */
function expected(t: ConvTarget, r: ConvRec): ConvRec {
  const o: ConvRec = {};
  const iso = (v: ConvCell) => impDate(String(v));
  for (const f of t.fields) {
    const v = r[f.key];
    if (v === undefined || v === '') continue;
    o[f.key] = f.kind === 'date' ? iso(v) : v;
  }
  if (t.id === 'bank') {
    const a = r.in !== undefined || r.out !== undefined ? (Number(r.in) || 0) - (Number(r.out) || 0) : Number(r.amount) || 0;
    delete o.in; delete o.out; o.amount = r2(a);
  }
  if (t.id === 'ob') {
    if (o.saldo !== undefined && !r.debit && !r.credit) { const s = Number(r.saldo) || 0; o.debit = s > 0 ? s : 0; o.credit = s < 0 ? -s : 0; }
    delete o.saldo;
    o.debit = r2(Number(o.debit) || 0); o.credit = r2(Number(o.credit) || 0);
  }
  if (t.id === 'firms') {
    for (const k of ['edb', 'embs', 'bank']) if (o[k] !== undefined) o[k] = String(o[k]).replace(/\s/g, '');
  }
  if (t.id === 'pay') {
    if (o.embg !== undefined) { const e = String(o.embg).replace(/\D/g, ''); o.embg = e.length < 13 ? e.padStart(13, '0') : e; }
    for (const k of ['ops', 'fzo']) if (o[k] !== undefined) o[k] = String(o[k]).replace(/\D/g, '');
  }
  return o;
}

/* ------------------------------------------------------------------ sources */

/** XML → grid: the most frequent repeated element with child data becomes the row; its leaf values (path) the columns. */
export function xmlToGrid(txt: string): string[][] | null {
  let root: XmlEl;
  try { root = parseXml(txt); } catch { return null; }
  const groups = new Map<string, XmlEl[]>();
  const walk = (e: XmlEl, path: string) => {
    for (const c of e.children) {
      const p = path + '/' + c.name;
      if (c.children.length) (groups.get(p) ?? groups.set(p, []).get(p)!).push(c);
      walk(c, p);
    }
  };
  walk(root, '');
  const leaves = (e: XmlEl, pre: string, out: Map<string, string>) => {
    for (const [k, v] of Object.entries(e.attrs)) out.set(pre + '@' + k, v);
    for (const c of e.children) {
      const p = pre + c.name;
      if (c.children.length) leaves(c, p + '/', out);
      else {
        let key = p, n = 2;
        while (out.has(key)) key = p + '#' + n++;
        out.set(key, c.text.trim());
        for (const [k, v] of Object.entries(c.attrs)) out.set(p + '@' + k, v);
      }
    }
  };
  let best: { recs: Map<string, string>[]; score: number } | null = null;
  for (const E of groups.values()) {
    if (E.length < 2) continue;
    const recs = E.map((e) => { const m = new Map<string, string>(); leaves(e, '', m); return m; });
    const cols = new Set(recs.flatMap((m) => [...m.keys()])).size;
    const score = E.length * Math.min(cols, 30);
    if (cols >= 2 && (!best || score > best.score)) best = { recs, score };
  }
  if (!best) {
    const m = new Map<string, string>();
    leaves(root, '', m);
    return m.size ? [[...m.keys()], [...m.values()]] : null;
  }
  const cols: string[] = [];
  for (const m of best.recs) for (const k of m.keys()) if (!cols.includes(k)) cols.push(k);
  return [cols, ...best.recs.map((m) => cols.map((c) => m.get(c) ?? ''))];
}

/** Header row of a source grid: the importer's rule (most text cells in the first 15 rows). */
export const convHeaderRow = (grid: readonly (readonly unknown[])[]): number => impHeaderRow(grid);

/* ------------------------------------------------------------------ presets */

export interface ConvPreset { id: string; name: string; target: string; sig: string; hi: number; map: Record<string, number>; dec?: DecMode; consts?: Record<string, string> }

/** The preset saved for this layout (same target and header signature), else one for the same layout of any target. */
export function convPresetFor(P: readonly ConvPreset[], hdr: readonly unknown[], target?: string): ConvPreset | undefined {
  const s = convSig(hdr);
  if (!s) return undefined;
  return P.find((p) => p.sig === s && (!target || p.target === target)) ?? (target ? undefined : P.find((p) => p.sig === s));
}

/** Validate a preset coming from the client / storage. */
export function convPresetClean(x: unknown): ConvPreset | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const t = convTarget(String(o.target ?? ''));
  const name = String(o.name ?? '').trim().slice(0, 80);
  if (!t || !name) return null;
  const map: Record<string, number> = {};
  for (const [k, v] of Object.entries((o.map ?? {}) as Record<string, unknown>)) if (t.fields.some((f) => f.key === k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) < 500) map[k] = v as number;
  const consts: Record<string, string> = {};
  for (const [k, v] of Object.entries((o.consts ?? {}) as Record<string, unknown>)) if (t.fields.some((f) => f.key === k) && String(v ?? '').trim()) consts[k] = String(v).slice(0, 100);
  const dec = o.dec === 'comma' || o.dec === 'dot' ? o.dec : '';
  return {
    id: /^[\w-]{6,40}$/.test(String(o.id ?? '')) ? String(o.id) : Math.random().toString(36).slice(2, 12), name, target: t.id,
    sig: String(o.sig ?? '').slice(0, 2000), hi: Math.max(0, Math.min(200, Math.trunc(Number(o.hi) || 0))), map, ...(dec ? { dec } : {}), ...(Object.keys(consts).length ? { consts } : {}),
  };
}
