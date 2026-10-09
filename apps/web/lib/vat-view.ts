import 'server-only';
/**
 * Server helpers shared by the VAT screens (`ddv`, `ddvKnigi`) and their print views.
 */
import {
  ddvFor, perRange, periodsOfYear, vatBookIn, vatBookOut, vatBookSum, VAT_BOOK_COLUMNS,
  type VatBookInRow, type VatBookOutRow,
} from '@wise/core';
import { firmVatPeriodKind, loadVatPostingContext, type Firm, type VatSourceOrigin } from '@wise/db';
import { db } from './db';
import { vatSource } from './vat-source';

export type BookKind = 'out' | 'in';

/** Period choices of the VAT books (legacy `VIEWS.ddvKnigi` 8903). */
export const bookPeriodOptions = (year: number): [string, string][] => [
  ['Y', 'Цела година'], ['Q1', 'I тромесечје'], ['Q2', 'II тромесечје'], ['Q3', 'III тромесечје'], ['Q4', 'IV тромесечје'],
  ...Array.from({ length: 12 }, (_, i) => { const mm = String(i + 1).padStart(2, '0'); return [mm, `${mm}/${year}`] as [string, string]; }),
];

/** Date range of a book selection (legacy `dkRange` 8876). */
export function bookRange(sel: string, year: number): [string, string] {
  if (sel === 'Y') return [`${year}-01-01`, `${year}-12-31`];
  if (/^Q[1-4]$/.test(sel)) return perRange(`${year}-Т${sel.slice(1)}`);
  return perRange(`${year}-${sel}`);
}

/** Default selection: the current month (monthly filer) or quarter, as legacy. */
export const defaultBookSel = (f: Pick<Firm, 'vatPeriod'>): string => {
  const m = new Date().getMonth() + 1;
  return firmVatPeriodKind(f) === 'month' ? String(m).padStart(2, '0') : 'Q' + Math.ceil(m / 3);
};

export const validBookSel = (s: string | undefined): s is string => !!s && (s === 'Y' || /^Q[1-4]$/.test(s) || /^(0[1-9]|1[0-2])$/.test(s));

/** VAT periods (firm frequency) fully covered by a book selection (legacy `dkCheck` 8896); null when not comparable. */
function checkPeriods(sel: string, year: number, kind: 'month' | 'quarter'): string[] | null {
  if (sel === 'Y') return periodsOfYear(year, kind);
  if (sel[0] === 'Q') {
    const q = Number(sel.slice(1));
    return kind === 'month' ? [0, 1, 2].map((i) => `${year}-${String((q - 1) * 3 + 1 + i).padStart(2, '0')}`) : [`${year}-Т${q}`];
  }
  return kind === 'month' ? [`${year}-${sel}`] : null;
}

export interface VatBookData {
  t: BookKind; from: string; to: string; origin: VatSourceOrigin;
  /** Journals without a VAT document that were rebuilt from the ledger (manual nalozi etc.). */
  ledgerJournals: number;
  rows: (VatBookOutRow | VatBookInRow)[];
  sum: Record<string, number>;
  /** Columns that differ from ДДВ-04 by more than 1 den. (key, book, ДДВ-04); null when not comparable. */
  check: { k: string; book: number; ddv: number }[] | null;
}

/** One VAT book with its totals and the reconciliation against ДДВ-04 (legacy `dkOut` / `dkIn` / `dkCheck`). */
export async function loadVatBook(firm: Firm, year: number, t: BookKind, sel: string): Promise<VatBookData> {
  const [from, to] = bookRange(sel, year);
  const ctx = await loadVatPostingContext(db(), firm);
  const data = await vatSource.load(db(), firm, from, to, ctx);
  const opts = { partners: data.partners, travel: data.travel };
  const rows = t === 'out' ? vatBookOut(data.docs, from, to, ctx, opts) : vatBookIn(data.docs, from, to, ctx, opts);
  const sum = vatBookSum(rows, t);
  let check: VatBookData['check'] = null;
  const kind = firmVatPeriodKind(firm);
  const P = firm.vatRegistered ? checkPeriods(sel, year, kind) : null;
  if (P) {
    const s: Record<string, number> = {};
    const add = (k: string, v: number) => { s[k] = (s[k] ?? 0) + v; };
    for (const p of P) {
      const D = ddvFor(data.docs, p, kind, ctx, { travel: data.travel });
      for (const r of [18, 10, 5]) {
        const x = t === 'out' ? D.out[r] : D.in[r];
        add('b' + r, x?.b ?? 0); add('v' + r, x?.v ?? 0);
      }
      if (t === 'in') { add('iv', D.impV); add('av', D.art32InVat); }
    }
    check = Object.entries(s).filter(([k, v]) => Math.abs((sum[k] ?? 0) - v) > 1).map(([k, v]) => ({ k, book: sum[k] ?? 0, ddv: Math.round(v * 100) / 100 }));
  }
  return { t, from, to, origin: data.origin, ledgerJournals: data.ledgerJournals ?? 0, rows, sum, check };
}

export const bookColumns = (t: BookKind) => VAT_BOOK_COLUMNS[t];
export const bookTitle = (t: BookKind) => (t === 'out' ? 'Книга на излезни фактури' : 'Книга на влезни фактури');

/* ---------------- inspector table (legacy `ddvTab` 16803–16823) ---------------- */

/** Default columns (legacy `DT_DEF`). */
export const DT_DEF = ['01', '02', '03', '04', '05', '06', '07', '08', '11', '16', '17', '20', '21', '22', '25', '26', '27', '28', '29', '31'];
/** Short column labels (legacy `DT_SH`). */
export const DT_SH: Record<string, string> = {
  '01': 'Промет 18%', '02': 'ДДВ 18%', '03': 'Промет 10%', '04': 'ДДВ 10%', '05': 'Промет 5%', '06': 'ДДВ 5%', '07': 'Извоз',
  '08': 'Ослободен со право на одбивка', '09': 'Ослободен без право на одбивка', '10': 'Промет кон нерезиденти', '11': 'Промет во земјата (чл. 32-а)',
  '12': 'Примен од нерезиденти 18%', '13': 'ДДВ (чл. 32) 18%', '14': 'Примен од нерезиденти повл.', '15': 'ДДВ (чл. 32) повл.',
  '16': 'Примен промет во земјата (32-а)', '17': 'ДДВ (32-а)', '18': 'Примен 32-а повл.', '19': 'ДДВ 32-а повл.', '20': 'Вкупен ДДВ',
  '21': 'Влезен промет', '22': 'Влезен ДДВ', '23': 'Примен од нерезиденти (чл. 32)', '24': 'Претходен данок (чл. 32)', '25': 'Влезен промет 32-а',
  '26': 'Претходен данок 32-а', '27': 'Увоз', '28': 'ДДВ увоз', '29': 'Вкупен претходен данок', '30': 'Корекции', '31': 'Даночен долг / побарување',
};
export const DT_MON = ['Јан', 'Фев', 'Март', 'Април', 'Мај', 'Јуни', 'Јули', 'Авг', 'Септ', 'Окт', 'Ное', 'Дек'];

/** Row label of a period in the inspector table. */
export function periodShortLabel(p: string): string {
  if (p.includes('-Т')) { const q = Number(p.slice(-1)); return `Т${q} (${DT_MON[(q - 1) * 3]}–${DT_MON[q * 3 - 1]})`; }
  return DT_MON[Number(p.slice(5, 7)) - 1] ?? p;
}
