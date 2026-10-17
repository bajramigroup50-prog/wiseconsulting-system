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
import { readBankTable } from '../bank-parsers';
import { prepBankGrid, type BankRole } from '../bank/table';
import { fimpParse, fimpVatFlag, fimpVatPeriod } from '../firms/firmimp';
import { dropSummaryRows, parseOpeningSheet, type ObRow } from '../ledger';
import { partnerSplit, tbAmountCols, tbBlocks, tbKontoCol, tbPreferredBlock, tbRebuild, tbTotals, type TbBlock, type TbSkipWhy } from '../tb-rows';
import { plxParse, PXL_COLS, type PxlKey } from '../payroll/xlsx-import';
import { IMP_T, impAuto, impDate, impHeaderRow, impN, impNum, impNumFormats, type DecMode, type ImpType } from '../retail/import';
import { parseXml, type XmlEl } from '../sales/xml';
import { colFormat, numStr } from '../numfmt';

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
  build?: (recs: readonly ConvRec[], meta?: ConvMeta) => ConvCell[][];
  /**
   * Normalise a source grid for this target (bank: header over several rows, multi-line transactions, split cells,
   * statement data from the header block). Null = the grid is used as it is.
   */
  prepare?: (grid: readonly (readonly unknown[])[], hi?: number) => ConvPrep | null;
  /** Read a target grid back with the importer's own parser → records keyed like `fields` (normalised values). */
  check: (grid: readonly (readonly unknown[])[]) => { rows: ConvRec[]; error?: string };
}

/** Statement-level data of a source (bank: number, date, account, balances as printed). */
export type ConvMeta = Record<string, string | null | undefined>;

/** A source grid prepared for a target (`ConvTarget.prepare`). */
export interface ConvPrep {
  /** Rows above the header as they were, the (combined) header row, one row per record. */
  grid: unknown[][];
  hi: number;
  /** Column per field found by the target itself. */
  map: Record<string, number>;
  /** Values for fields from the header block („од заглавјето“), in the form typed in the converter (dates dd.mm.yyyy). */
  hdr: Record<string, string>;
  meta: ConvMeta;
  /** Source row number (1-based) of each record row, for messages. */
  rowNos: number[];
  /** What was recognised (shown above the mapping). */
  note: string;
}

const syn = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const NUMK = new Set(['price', 'rate', 'min', 'weight', 'netBase', 'coef', 'qty', 'cost', 'amount', 'mpc', 'cnt', 'd', 'p', 'amt', 'curAmt', 'disc',
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
      const body = grid.slice(hi + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
      const NF = impNumFormats(body, fields.filter((f) => f.kind === 'num').map((f) => ({ key: f.key, label: f.label, idx: map[f.key] })));
      if (NF.ambiguous.length) return { rows: [], error: 'Износите не се еднозначни: ' + NF.ambiguous.join(', ') };
      const rows: ConvRec[] = [];
      for (const r of grid.slice(hi + 1)) {
        if (!r.some((c) => String(c ?? '').trim() !== '')) continue;
        const o: ConvRec = {};
        for (const f of fields) {
          const i = map[f.key];
          if (i == null) continue;
          const v = r[i];
          if (String(v ?? '').trim() === '') continue;
          o[f.key] = f.kind === 'num' ? impNum(v, NF.dec[f.key] ?? '') : f.kind === 'date' ? impDate(v) : String(v).trim();
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
    if (!P) {
      // the headings written by `build` are always recognised: no rows here means no row with a konto and a saldo
      const head = (grid[0] ?? []).map((c) => String(c ?? '').trim());
      if (OB_HEAD.every((h, i) => head[i] === h)) return { rows: [], ...(grid.length > 1 ? { error: 'Ниту еден ред нема конто (3–8 цифри) и салдо различно од нула.' } : {}) };
      return { rows: [], error: 'Не се најдени колони „Конто“ и „Салдо / Должи / Побарува“.' };
    }
    return { rows: P.rows.map(([konto, name, partner, code, debit, credit]) => ({ konto, name, partner, code, debit: r2(debit), credit: r2(credit) })) };
  },
};

/* ------------------------------------------------------------------ bank statement */

const BANK_HEAD = ['Датум', 'Налогодавач / примач', 'Сметка', 'Цел на дознака', 'Референца', 'Шифра на плаќање', 'Прилив', 'Одлив'];
const ROLE_FIELD: Partial<Record<BankRole, string>> = { date: 'date', name: 'name', account: 'acc', purpose: 'purpose', ref: 'ref', code: 'osnov', credit: 'in', debit: 'out', amount: 'amount' };
const DIR_HEAD = /^(д\s*\/\s*п|d\s*\/\s*c|db\s*\/\s*cr|тип|tip|насока)$/i;
const bankTarget: ConvTarget = {
  id: 'bank', title: 'Банкарски извод', href: '/banka', where: 'Банка › Увоз на извод (Excel)', file: 'Izvod',
  fields: [
    { key: 'date', label: 'Датум', req: true, syn: syn('датум на книжење,датум,дата,date,data,valuta'), kind: 'date' },
    { key: 'name', label: 'Налогодавач / примач', syn: syn('налогодавач,примач,партнер,назив,корисник,name,partner,emri,nalogodavac,primac'), kind: 'text' },
    { key: 'acc', label: 'Сметка на налогодавач / примач', syn: syn('сметка на налогодавач,жиро сметка,број на сметка,account,iban'), kind: 'text' },
    { key: 'purpose', label: 'Цел на дознака', syn: syn('цел на дознака,цел,опис,намена,детали,purpose,description,pershkrimi,opis'), kind: 'text' },
    { key: 'ref', label: 'Референца', syn: syn('референца,реф,reference,ref,повикување'), kind: 'text' },
    { key: 'osnov', label: 'Шифра на плаќање', syn: syn('шифра на плаќање,шифра,основ,sifra,code'), kind: 'text' },
    { key: 'in', label: 'Прилив', syn: syn('прилив,побарува,одобрува,одобрување,во корист,уплата,credit,hyrje,priliv'), kind: 'num' },
    { key: 'out', label: 'Одлив', syn: syn('одлив,должи,задолжува,задолжување,на товар,исплата,debit,dalje,odliv'), kind: 'num' },
    { key: 'amount', label: 'Износ (+ прилив / − одлив)', syn: syn('износ,amount,shuma,iznos'), kind: 'num' },
  ],
  // statement data above / below the table, so the bank import reads number, account and balances as from the bank
  build: (R, meta = {}) => {
    const pre: ConvCell[][] = [];
    if (meta.no) pre.push([`Извод бр. ${meta.no}`]);
    if (meta.date) pre.push([`Датум на извод: ${meta.date}`]);
    if (meta.account) pre.push([`Сметка: ${meta.account}`]);
    if (meta.opening) pre.push(['Претходна состојба:', meta.opening]);
    const post: ConvCell[][] = [
      ...(meta.debit ? [['Вкупно задолжување:', meta.debit]] : []), ...(meta.credit ? [['Вкупно одобрување:', meta.credit]] : []),
      ...(meta.closing ? [['Нова состојба:', meta.closing]] : []),
    ];
    return [...pre, BANK_HEAD, ...R.map((r) => {
      let i = Number(r.in) || 0, o = Number(r.out) || 0;
      if (!i && !o && r.amount !== undefined) { const a = Number(r.amount) || 0; i = a > 0 ? a : 0; o = a < 0 ? -a : 0; }
      return [String(r.date ?? ''), String(r.name ?? ''), String(r.acc ?? ''), String(r.purpose ?? ''), String(r.ref ?? ''), String(r.osnov ?? ''), i ? r2(i) : '', o ? r2(o) : ''];
    }), ...post];
  },
  check: (grid) => {
    const R = readBankTable(grid.map((r) => [...r]));
    if (!R.st) return { rows: [], error: R.error ?? 'Не се препознаени колоните „Датум“ и „Износ / Прилив / Одлив“.' };
    return { rows: R.st.lines.map((l) => ({ date: l.date, name: l.counterparty, ...(l.iban ? { acc: l.iban } : {}), purpose: l.purpose, ref: l.ref, osnov: l.osnov ?? '', amount: r2(l.amount / 100) })) };
  },
  prepare: (grid, hi) => {
    const P = prepBankGrid(grid, hi);
    if (!P) return null;
    const head = P.cols.map((c) => c.header);
    const map: Record<string, number> = {};
    P.cols.forEach((c, i) => { const k = c.role ? ROLE_FIELD[c.role] : undefined; if (k && map[k] == null) map[k] = i; });
    // a „Д/П“ indicator next to a single amount column → signed amounts
    const iDir = P.cols.findIndex((c) => c.role === null && DIR_HEAD.test(c.header.trim()));
    const rows = P.items.map((it) => P.cols.map((c, i): unknown => {
      if (c.role === 'date') return it.rawDate ?? '';
      if (c.role === 'valDate') return it.rawValDate ?? '';
      const v = it.cells[i] ?? '';
      if (c.role === 'amount' && iDir >= 0 && v !== '') {
        const d = String(it.cells[iDir] ?? '').trim();
        if (/^(д|d|-|дб|db)/i.test(d)) return typeof v === 'number' ? -Math.abs(v) : '-' + String(v).replace(/^-/, '');
      }
      return v;
    }));
    const M = P.meta;
    const hdr: Record<string, string> = {};
    if (M.date && map.date == null) hdr.date = dmyOf(M.date);
    const meta: ConvMeta = { no: M.no, date: M.date ? dmyOf(M.date) : '', account: M.account, opening: M.opening, closing: M.closing, debit: M.debit ?? P.totals.debit, credit: M.credit ?? P.totals.credit };
    const note = [
      `Насловот е во ред ${P.hi + 1}${P.hn > 1 ? `–${P.hi + P.hn} (${P.hn} реда споени)` : ''}`,
      `${P.items.length} ставки`,
      M.no ? `извод бр. ${M.no}` : '', M.date ? `датум на изводот ${dmyOf(M.date)}` : '', M.account ? `сметка ${M.account}` : '',
      M.opening != null ? `претходна состојба ${M.opening}` : '', M.closing != null ? `нова состојба ${M.closing}` : '',
    ].filter(Boolean).join(' · ');
    return { grid: [...grid.slice(0, P.hi).map((r) => [...r]), head, ...rows], hi: P.hi, map, hdr, meta, rowNos: P.items.map((it) => it.row + 1), note };
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
    const P = plxParse(grid.map((r) => r.map((c) => (typeof c === 'number' ? numStr(c) : String(c ?? '')))));
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
    // synonyms in their order of priority („продажна“ before „цена“)
    for (const y of s) {
      if (y.length <= 2) continue;
      const i = H.findIndex((x, j) => !used.has(j) && x && x.includes(y));
      if (i >= 0) { map[f.key] = i; used.add(i); break; }
    }
  }
  return map;
}

/** Header signature of a layout (for presets): normalised headings joined. */
export const convSig = (hdr: readonly unknown[]): string => hdr.map(impN).join('|').replace(/\|+$/, '');

const TOTAL = /^(вкупно|збир|сума|total|gjithsej|toplam|салдо на крај|ново салдо)/i;

/** Why a source row is not in the result although it is not an error. */
export type ConvSkipWhy = TbSkipWhy | 'нулто салдо';
export interface ConvResult {
  grid: ConvCell[][]; recs: ConvRec[]; errors: { row: number; msg: string }[]; skipped: number;
  /** Rows left out on purpose (totals, headings, continuation lines merged into the row above, zero saldo). */
  skippedRows: { row: number; why: ConvSkipWhy; text: string }[];
  /** Numeric columns with only ambiguous amounts („10.000“) and no „Децимали“ chosen: the result must not be used. */
  ambiguous: string[]; ambExamples: string[]; blocked: boolean;
  /** Statement data carried into the result (bank: number, date, account, balances as numbers). */
  meta?: ConvMeta;
  /** Checks on the whole file (bank: opening + movements = closing). */
  notes: { ok: boolean; msg: string }[];
}

/** Konto / text / amount fields of the targets whose rows are trial-balance or journal lines (row reconstruction). */
const KONTO_T: Record<string, { k: string; name?: string; partner?: string; code?: string; amt: string[] }> = {
  ob: { k: 'konto', name: 'name', partner: 'partner', code: 'code', amt: ['debit', 'credit', 'saldo'] },
  'imp:journal': { k: 'k', name: 'desc', partner: 'partner', code: 'pcode', amt: ['d', 'p', 'amt'] },
};

/**
 * Source rows (below the header) → records of the target fields → target grid. `consts` fills a field with a fixed
 * value (e.g. the date of a stock list). Rows without the required fields are reported and left out; empty rows and
 * total rows are skipped. For the opening balance and the journal the rows are first rebuilt (`tb-rows.ts`): lines
 * split in two are joined, page headers / class headings / totals are left out (listed in `skippedRows`, not errors).
 * `pre` = the rows above the header (repeated page headers are recognised by them).
 */
export function convApply(t: ConvTarget, rows: readonly (readonly unknown[])[], map: Readonly<Record<string, number | undefined>>, o: {
  dec?: DecMode; consts?: Readonly<Record<string, string>>; firstRow?: number; pre?: readonly (readonly unknown[])[];
  /** Values from the header block for unmapped fields (`ConvPrep.hdr`); a typed constant wins. */
  hdr?: Readonly<Record<string, string>>; meta?: ConvMeta; rowNos?: readonly number[];
} = {}): ConvResult {
  // number format per numeric column (`numfmt.ts`): the column's own evidence, or the chosen „Децимали“; a column with
  // only ambiguous values („10.000“) blocks the result until a choice is made (never guessed)
  const NF = impNumFormats(rows, t.fields.filter((f) => f.kind === 'num').map((f) => ({ key: f.key, label: f.label, idx: map[f.key] })));
  const sel: DecMode = o.dec ?? '';
  const decOf = (k: string): DecMode => sel || NF.dec[k] || '';
  const recs: ConvRec[] = [];
  const errors: { row: number; msg: string }[] = [];
  const skippedRows: ConvResult['skippedRows'] = [];
  const first = o.firstRow ?? 1;
  let skipped = 0;
  // trial balance / journal: rebuild the rows first
  const KC = KONTO_T[t.id];
  const kc = KC ? map[KC.k] : undefined;
  let src: { ri: number; r: readonly unknown[]; sub: string; k: string }[];
  if (KC && kc != null && kc >= 0) {
    const fmt = decOf(KC.amt[0]!) === 'dot' ? 'dot' : 'mk';
    const RB = tbRebuild(rows, { k: kc, name: KC.name ? map[KC.name] : undefined, partner: KC.partner ? map[KC.partner] : undefined, code: KC.code ? map[KC.code] : undefined, amt: KC.amt.map((k) => map[k]) }, { pre: o.pre, fmt });
    for (const x of RB.skipped) { if (x.why === 'празен') skipped++; else skippedRows.push({ ...x, row: first + x.row }); }
    src = RB.items.filter((x) => x.kind === 'data').map((x) => ({ ri: x.row, r: x.cells, sub: x.sub, k: x.k }));
  } else src = rows.map((r, ri) => ({ ri, r, sub: '', k: '' }));
  let curK = '';
  const rowOf = new Map<ConvRec, number>();
  src.forEach(({ ri, r, sub, k }) => {
    const rowNo = o.rowNos?.[ri] ?? first + ri;
    if (!r.some((c) => String(c ?? '').trim() !== '')) { skipped++; return; }
    if (!KC && r.slice(0, 3).some((c) => TOTAL.test(String(c ?? '').trim()))) { skipped++; return; }
    const rec: ConvRec = {};
    const bad: string[] = [];
    for (const f of t.fields) {
      const i = map[f.key];
      const raw = i != null && i >= 0 ? r[i] : (o.consts?.[f.key] || o.hdr?.[f.key]);
      const s = raw instanceof Date ? impDate(raw) : String(raw ?? '').trim();
      if (!s) continue;
      if (f.kind === 'num') {
        const n = impNum(raw, decOf(f.key));
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
    if (t.id === 'ob') {
      const hasAmt = rec.debit !== undefined || rec.credit !== undefined || rec.saldo !== undefined;
      // analytic rows under an account heading (no konto of their own): the konto above, the text is the partner
      if (k) curK = k;
      else if (rec.konto === undefined && curK && hasAmt && (rec.partner || rec.name)) {
        rec.konto = curK;
        if (!rec.partner) { rec.partner = rec.name!; delete rec.name; }
      }
      // „1029 МАЈАНЦЕ“: partner code + name; „1200-001“: the analytic suffix as the code
      if (rec.partner && !rec.code) { const ps = partnerSplit(rec.partner); if (ps.code) { rec.partner = ps.name; rec.code = ps.code; } }
      if (sub && !rec.code) rec.code = sub;
      if (hasAmt && rec.konto !== undefined && !r2(Number(rec.debit) || 0) && !r2(Number(rec.credit) || 0) && !r2(Number(rec.saldo) || 0)) {
        skippedRows.push({ row: rowNo, why: 'нулто салдо', text: [rec.konto, rec.name, rec.partner].filter(Boolean).join(' ') });
        return;
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
    rowOf.set(rec, rowNo);
    recs.push(rec);
  });
  let out = recs;
  if (t.id === 'ob') {
    // synthetic rows that are the sum of their analytic rows (legacy `obDropSums`, the same rule as the import)
    const R = recs.map((r): ObRow => { const d = obDP(r); return [String(r.konto ?? ''), String(r.name ?? ''), String(r.partner ?? ''), String(r.code ?? ''), d[0], d[1]]; });
    const keep = new Set(dropSummaryRows(R).rows);
    out = recs.filter((r, i) => {
      if (keep.has(R[i]!)) return true;
      skippedRows.push({ row: rowOf.get(r) ?? 0, why: 'збир', text: [r.konto, r.name, r.partner].filter(Boolean).join(' ') });
      return false;
    });
  }
  skippedRows.sort((a, b) => a.row - b.row);
  // statement data: balances in the numbers' format; opening + movements = closing
  const notes: ConvResult['notes'] = [];
  let meta: ConvMeta | undefined;
  if (o.meta) {
    const numKeys = t.fields.filter((f) => f.kind === 'num').map((f) => f.key);
    const own = colFormat([o.meta.opening, o.meta.closing, o.meta.debit, o.meta.credit].filter(Boolean));
    const dec: DecMode = sel || numKeys.map((k) => NF.dec[k]).find(Boolean) || (own === 'mk' ? 'comma' : own === 'dot' ? 'dot' : '');
    const num = (v: string | null | undefined) => (v ? r2(impNum(v, dec)) : null);
    const op = num(o.meta.opening), cl = num(o.meta.closing), td = num(o.meta.debit), tc = num(o.meta.credit);
    const ns = (v: number | null) => (v == null ? '' : numStr(v));
    meta = { ...o.meta, opening: ns(op), closing: ns(cl), debit: ns(td), credit: ns(tc) };
    const amt = (r: ConvRec) => Math.round((r.in !== undefined || r.out !== undefined ? (Number(r.in) || 0) - (Number(r.out) || 0) : Number(r.amount) || 0) * 100);
    // HARD CHECK (blocks the download): Σ debits / credits = the printed totals („Вкупно“ row, „Вкупно задолжување“)
    if (t.id === 'bank') {
      const sOut = -out.map(amt).filter((a) => a < 0).reduce((a, b) => a + b, 0), sIn = out.map(amt).filter((a) => a > 0).reduce((a, b) => a + b, 0);
      if (td != null && Math.round(td * 100) !== sOut) notes.push({ ok: false, msg: `Збирот на одливите (задолжување) е ${mkC(sOut)}, а во изводот „Вкупно задолжување“ е ${mkC(td * 100)} (разлика ${mkC(Math.round(td * 100) - sOut)}). Проверете ги колоните „Одлив“ / „Прилив“ / „Износ“.` });
      if (tc != null && Math.round(tc * 100) !== sIn) notes.push({ ok: false, msg: `Збирот на приливите (одобрување) е ${mkC(sIn)}, а во изводот „Вкупно одобрување“ е ${mkC(tc * 100)} (разлика ${mkC(Math.round(tc * 100) - sIn)}). Проверете ги колоните „Одлив“ / „Прилив“ / „Износ“.` });
    }
    if (t.id === 'bank' && op != null && cl != null) {
      const sum = out.reduce((a, r) => a + amt(r), 0);
      const exp = Math.round(op * 100) + sum, ok = exp === Math.round(cl * 100);
      notes.push({ ok, msg: ok ? `Салдата се совпаѓаат: претходна состојба ${mkC(op * 100)} + промет ${mkC(sum)} = нова состојба ${mkC(cl * 100)}.`
        : `Салдата НЕ се совпаѓаат: претходна состојба ${mkC(op * 100)} + промет ${mkC(sum)} = ${mkC(exp)}, а во изводот новата состојба е ${mkC(cl * 100)} (разлика ${mkC(Math.round(cl * 100) - exp)}). Проверете ги ставките и „Децимали“.` });
    }
  }
  return { grid: convGrid(t, out, meta), recs: out, errors, skipped, skippedRows, ambiguous: NF.ambiguous, ambExamples: NF.examples, blocked: NF.ambiguous.length > 0 && !sel, ...(meta ? { meta } : {}), notes };
}

/** Debit / credit of an opening-balance record (a signed saldo split like `obTarget.build`). */
function obDP(r: ConvRec): [number, number] {
  let d = Number(r.debit) || 0, p = Number(r.credit) || 0;
  if (r.saldo !== undefined && r.saldo !== '' && !d && !p) { const s = Number(r.saldo) || 0; d = s > 0 ? s : 0; p = s < 0 ? -s : 0; }
  return [r2(d), r2(p)];
}

/**
 * Debit = credit check and per-class sums of a converted opening balance / journal (null for other targets). Sums in
 * cents (`tbTotals`).
 */
export function convTotals(t: ConvTarget, recs: readonly ConvRec[]): ReturnType<typeof tbTotals> | null {
  if (t.id === 'ob') return tbTotals(recs.map((r) => { const [d, p] = obDP(r); return { k: String(r.konto ?? ''), d, p }; }));
  if (t.id === 'imp:journal') return tbTotals(recs.map((r) => ({ k: String(r.k ?? ''), d: Number(r.d) || 0, p: Number(r.p) || 0 })));
  return null;
}

/**
 * Headings of a source grid with a two-row header: a block row („Почетно салдо | Промет | Салдо“, merged cells) above
 * a „Д | П“ row is combined into one heading per column („Салдо Д“). `start` = first data row.
 */
export function convHeads(grid: readonly (readonly unknown[])[], hi: number): { head: string[]; start: number } {
  const cell = (v: unknown) => (v instanceof Date ? '' : String(v ?? '').trim());
  const DP = /^(д\.?|п\.?|должи|побарува|dolzi|pobaruva|debit|credit|duguje|potrazuje|dug\.?|pot\.?|d\.?|p\.?)$/i;
  const isDP = (r: readonly unknown[] | undefined) => {
    const c = (r ?? []).map(cell).filter(Boolean);
    return c.length >= 2 && c.filter((x) => DP.test(x)).length >= c.length * 0.6;
  };
  const ff = (r: readonly unknown[] | undefined) => { let l = ''; return (r ?? []).map((c) => (cell(c) ? (l = cell(c)) : l)); };
  const comb = (top: readonly unknown[] | undefined, low: readonly unknown[] | undefined) => {
    const T = ff(top), L = (low ?? []).map(cell);
    return Array.from({ length: Math.max(T.length, L.length) }, (_, i) => (L[i] ? ((T[i] ?? '') + ' ' + L[i]).trim() : cell(top?.[i])));
  };
  const H = grid[hi] ?? [];
  if (isDP(grid[hi + 1]) && !isDP(H)) return { head: comb(H, grid[hi + 1]), start: hi + 2 };
  if (hi > 0 && isDP(H) && (grid[hi - 1] ?? []).some((c) => cell(c))) return { head: comb(grid[hi - 1], H), start: hi + 1 };
  return { head: H.map(cell), start: hi + 1 };
}

/** Debit / credit blocks of a trial balance (почетно салдо / промет / вкупно / салдо) for the „Користи“ choice. */
export const convBlocks = (t: ConvTarget, head: readonly unknown[]): TbBlock[] => (t.id === 'ob' ? tbBlocks(head, latN) : []);

/**
 * Mapping by headings (`convAuto`) completed from the values: the closing saldo block of a multi-block trial balance,
 * the konto column (3–8 digit codes) and the amount columns when their headings are not recognised.
 */
export function convGuess(t: ConvTarget, head: readonly unknown[], data: readonly (readonly unknown[])[]): Record<string, number> {
  const map = convAuto(t, head);
  const KC = KONTO_T[t.id];
  if (!KC) return map;
  const B = tbPreferredBlock(convBlocks(t, head));
  if (B) { map.debit = B.d; map.credit = B.p; delete map.saldo; }
  const used = () => new Set(Object.values(map));
  if (map[KC.k] == null) { const k = tbKontoCol(data, used()); if (k >= 0) map[KC.k] = k; }
  if (KC.amt.every((k) => map[k] == null)) {
    const N = tbAmountCols(data, used(), 'mk', map[KC.k] != null ? map[KC.k]! + 1 : 0);
    if (N.length >= 2) { map[KC.amt[0]!] = N[N.length - 2]!; map[KC.amt[1]!] = N[N.length - 1]!; }
    else if (N.length === 1 && KC.amt[2]) map[KC.amt[2]] = N[0]!;
  }
  return map;
}

/** Cents as „1.234,56“. */
const mkC = (c: number): string => {
  const v = Math.round(c), s = (Math.abs(v) / 100).toFixed(2).split('.');
  return (v < 0 ? '-' : '') + s[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1];
};

/** Records → target grid. */
export function convGrid(t: ConvTarget, recs: readonly ConvRec[], meta?: ConvMeta): ConvCell[][] {
  if (t.build) return t.build(recs, meta);
  return [t.fields.map((f) => f.label), ...recs.map((r) => t.fields.map((f) => r[f.key] ?? ''))];
}

/**
 * Check the converted grid with the importer's own parser and compare it with what was converted: count and the
 * values of every field the parser returns. `diff` lists the first differences (empty = the importer reads exactly
 * what the converter produced).
 */
export function convCheck(t: ConvTarget, res: Pick<ConvResult, 'grid' | 'recs'> & { blocked?: boolean; ambiguous?: string[] }): { n: number; error?: string; diff: string[]; rows: ConvRec[] } {
  if (res.blocked) return { n: 0, error: 'Изберете „Децимали“: износите во колоните ' + (res.ambiguous ?? []).join(', ') + ' не се еднозначни („10.000“ = десет илјади или десет).', diff: [], rows: [] };
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
    // account numbers come back as digits („300-0000012345-67“ → „300000001234567“)
    const acc = /(?:MK\s?\d{2}\s?)?(\d{3})[-\s]?(\d{10})[-\s]?(\d{2})/.exec(String(o.acc ?? ''));
    if (acc && o.acc !== undefined) o.acc = String(o.acc).replace(acc[0], acc[1]! + acc[2]! + acc[3]!).trim();
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

/** Header row of a source grid for a target: the target's own recognition (bank: the statement table) first. */
export const convHeaderRowFor = (t: ConvTarget, grid: readonly (readonly unknown[])[]): number => t.prepare?.(grid)?.hi ?? impHeaderRow(grid);

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
