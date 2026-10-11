/**
 * Employees from Excel (legacy `XT.employees` 6906 template `Vraboteni.xlsx` + `IMP_T.employees` 5384 aliases): header
 * row first, columns found by name; values as strings ready for the `employees` table (numeric columns as decimal text).
 */
import { impDate, impN, impNum } from '../retail/import';

export interface EmpImportRow {
  no: string; name: string; embg: string; position: string; netBase: string; coef: string; stazPrev: string; start: string; end: string;
  bankAcc: string; bank: string; address: string; city: string; oe: string; email: string; mpOps: string; mpZan: string; leaveDays: string;
}

const COLS: readonly (readonly [keyof EmpImportRow, string, string])[] = [
  ['no', 'Бр.', 'бр,број,шифра,no,nr'],
  ['name', 'Име и презиме', 'име и презиме,име,презиме,name,emri,mbiemri,вработен,punetori'],
  ['embg', 'ЕМБГ', 'ембг,embg,matični,nr personal'],
  ['position', 'Работно место', 'работно место,позиција,position,pozita,vendi'],
  ['netBase', 'Основна нето плата', 'нето,плата,net,paga,rroga'],
  ['coef', 'Коефициент', 'коеф,coef,koef'],
  ['stazPrev', 'Стаж (години)', 'стаж,staz,stazh,минат труд'],
  ['start', 'Датум на вработување', 'вработување,почеток,start,fillimi,data e punesimit'],
  ['end', 'Договор до', 'договор до,end,mbarimi'],
  ['bankAcc', 'Сметка за плата', 'сметка,account,llogaria,iban'],
  ['bank', 'Банка', 'банка,bank,banka'],
  ['address', 'Адреса', 'адреса,address,adresa'],
  ['city', 'Град', 'град,city,qyteti,место'],
  ['oe', 'Подружница / единица', 'подружница,единица,пункт,oe'],
  ['email', 'Е-пошта', 'е-пошта,email,mail,e-mail'],
  ['mpOps', 'Општина МПИН 3.4ц', 'општина,opstina'],
  ['mpZan', 'ФЗО МПИН 3.4б', 'фзо,подрачна'],
  ['leaveDays', 'Денови одмор', 'одмор,leave'],
];

/** Legacy `XT.employees` template + the extra import columns; two example rows. */
export const EMP_TEMPLATE: readonly (readonly (string | number)[])[] = [
  COLS.map((c) => c[1]),
  ['25', 'Абдулау Адем', '0101990450001', '', 26046, 1, 5],
  ['26', 'Марко Марковски', '0202985450002', '', 30000, 1, 12],
];

export function empParse(rows: readonly (readonly unknown[])[]): EmpImportRow[] | { error: string } {
  const H = (rows[0] ?? []).map(impN);
  const map: Partial<Record<keyof EmpImportRow, number>> = {};
  const used = new Set<number>();
  for (const [k, lab, al] of COLS) {
    const A = [impN(lab), ...al.split(',').map(impN)];
    let i = H.findIndex((h, j) => !used.has(j) && A.includes(h));
    if (i < 0) i = H.findIndex((h, j) => !used.has(j) && A.some((a) => a.length > 2 && h.includes(a)));
    if (i >= 0) { map[k] = i; used.add(i); }
  }
  if (map.name == null) return { error: 'Нема колона „Име и презиме“. Користете го „Excel образец“.' };
  const g = (r: readonly unknown[], k: keyof EmpImportRow) => (map[k] == null ? '' : String(r[map[k]!] ?? '').trim());
  const n = (s: string) => (s === '' ? '' : String(impNum(s)));
  const d = (s: string) => (s === '' ? '' : impDate(/^\d{5}$/.test(s) ? +s : s));
  return rows.slice(1).filter((r) => g(r, 'name')).map((r) => {
    let embg = g(r, 'embg').replace(/\D/g, '');
    if (embg && embg.length < 13) embg = embg.padStart(13, '0');
    return {
      no: g(r, 'no'), name: g(r, 'name').slice(0, 200), embg, position: g(r, 'position'), netBase: n(g(r, 'netBase')), coef: n(g(r, 'coef')),
      stazPrev: n(g(r, 'stazPrev')), start: d(g(r, 'start')), end: d(g(r, 'end')), bankAcc: g(r, 'bankAcc').replace(/\s/g, ''), bank: g(r, 'bank'),
      address: g(r, 'address'), city: g(r, 'city'), oe: g(r, 'oe'), email: g(r, 'email'), mpOps: g(r, 'mpOps').replace(/\D/g, ''), mpZan: g(r, 'mpZan').replace(/\D/g, ''),
      leaveDays: n(g(r, 'leaveDays')),
    };
  });
}

export const EMP_EXPORT_HEAD = COLS.map((c) => c[1]);
export const EMP_EXPORT_KEYS = COLS.map((c) => c[0]);
