/**
 * Macedonian fiscal receipt („фискална сметка“) read WITHOUT AI — only when it is an electronic receipt / text PDF
 * (photos and scans stay with AI). The result has the shape of the `BLG_PROMPT` answer (`{receipts:[…]}`, read by
 * `receiptDrafts`), plus `items` / `groups` / `time` / `edb` for the review.
 *
 * Read: merchant (first text line above ЕДБ), ЕДБ / ДДВ број, date and time, receipt number, the items
 * („Назив  1 x 40.00  40.00 Б“, the name may be on the line above), VAT per group („ДДВ А 18%  38.14“), the total
 * („ВКУПНО“ / „ВКУПЕН ИЗНОС“ / „ЗА НАПЛАТА“) and the payment (готовина / картичка, кусур).
 * Tax groups: А = 18 %, Б = 5 %, В = 0 %, Г = 10 % (`FISK_G0`), a printed rate overrides.
 *
 * Accepted only when: total > 0, a date, a 13-digit ЕДБ, Σ items (or the printed turnover per group) = total
 * (± 0.02), every printed ДДВ per group = group turnover × r / (100 + r) (± 0.05 + 0.01 per item), and the payment
 * (paid − change) = total when printed. Otherwise `data` is null and `why` is the reason (the caller uses AI).
 */
import { r2 } from '../money';
import { FISK_G0, FK_LAT } from '../ai/fisk';
import { AMT_SRC, amountsIn, dateIn, edbIn, lastAmount, NOAI_NOTE, up, type FreeParse } from './doc-text';

export interface ReceiptItem { name: string; qty: number; price: number; amount: number; group: string; rate: number }
export interface ReceiptGroup { group: string; rate: number; gross: number; vat: number }
/** One receipt in the `BLG_PROMPT` shape (+ the details of the free read). */
export interface FreeReceipt {
  country: 'MK'; currency: 'MKD'; date: string; time: string; docNo: string; merchant: string; vatId: string; edb: string;
  total: number; vatRate: number; vatAmount: number; category: string; payment: 'cash' | 'card' | 'other'; liters: number | null;
  items: ReceiptItem[]; groups: ReceiptGroup[];
}
export interface FreeReceipts { receipts: FreeReceipt[]; noai: true; note: string }

const LET = '([АБВГABVG])';
const letter = (s: string) => FK_LAT[s.toUpperCase()] ?? s;
const QTY = '(\\d+(?:[.,]\\d{1,3})?)';
const A = `(${AMT_SRC})`;
const ITEM1 = new RegExp(`^(.*?)\\s*${QTY}\\s*[XХ×*]\\s*${A}\\s*=?\\s*${A}\\s*${LET}\\s*$`);
const ITEM2 = new RegExp(`^(.*?\\D)\\s{2,}${A}\\s*${LET}\\s*$`);
const num = (s: string) => +s.replace(',', '.');
const amtOf = (s: string) => amountsIn(s)[0] ?? 0;
const SKIP = /ЕДБ|ДДВ|ФИСКАЛ|СМЕТКА|ВКУПНО|ВКУПЕН|ГОТОВИНА|КАРТИЧ|КУСУР|ВРАТЕНО|ДАН\.?\s*БРОЈ|РЕГ\.?\s*БРОЈ|БР\.?\s*НА\s*ФМ|^\s*УЛ\.?|^\s*\d/;

const FUEL = /ДИЗЕЛ|БЕНЗИН|ГОРИВО|EURO\s*DIESEL|DIESEL|БМБ|\bLPG\b|(?<![А-Я])ТНГ(?![А-Я])|ЕУРОСУПЕР|EUROSUPER/;
function category(names: string): string {
  if (FUEL.test(names)) return 'fuel';
  if (/ПАРКИНГ|PARKING/.test(names)) return 'parking';
  if (/ПАТАРИН|TOLL/.test(names)) return 'toll';
  if (/НОЌЕВАЊ|ХОТЕЛ|СМЕСТУВАЊ/.test(names)) return 'accommodation';
  if (/ХАРТИЈА|ТОНЕР|КАНЦЕЛАР/.test(names)) return 'office';
  return 'other';
}

/** Read one fiscal receipt from its text lines (e-receipt / text PDF). */
export function receiptFromLines(L0: readonly string[]): FreeParse<FreeReceipts> {
  const no = (why: string): FreeParse<FreeReceipts> => ({ data: null, ok: false, why, checks: [] });
  const L = L0.map((s) => s.trimEnd()).filter((s) => s.trim());
  const U = L.map(up);
  const all = U.join('\n');
  if (!/ФИСКАЛ|ДДВ/.test(all) || !/ВКУПНО|ВКУПЕН\s+ИЗНОС|ЗА\s+НАПЛАТА/.test(all)) return no('не е фискална сметка (нема „ВКУПНО“ / „ДДВ“)');
  if (U.filter((u) => /^\s*(?:ЕДБ|ДАН\.?\s*БРОЈ)/.test(u)).length > 1) return no('повеќе сметки во една датотека');

  const items: ReceiptItem[] = [];
  const rates: Record<string, number> = { ...FISK_G0 };
  const vat: Record<string, number> = {};
  const grossP: Record<string, number> = {};
  let total = 0, vatTotal: number | null = null, cash = 0, card = 0, other = 0, change = 0;
  let edb = '', vatId = '', date = '', time = '', docNo = '';
  let pending = '';
  for (let i = 0; i < L.length; i++) {
    const s = L[i]!, u = U[i]!;
    if (!edb && /ЕДБ|ДАН\.?\s*БРОЈ|ДАНОЧЕН\s+БРОЈ/.test(u)) edb = edbIn(u);
    if (!vatId && /ДДВ\s*БР|ДДВ\s*БРОЈ/.test(u)) { const m = /((?:MK|МК)\s*\d{13})/.exec(u); if (m) vatId = m[1]!.replace(/\s/g, '').replace('МК', 'MK'); }
    if (!date) { const d = dateIn(u); if (d && !/ВАЖИ|РОК/.test(u)) { date = d; time = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(u)?.[1] ?? ''; } }
    const dn = /(?:ФИСКАЛ\S*\s+(?:СМЕТКА\s+)?(?:БРОЈ|БР\.?)|БР(?:ОЈ)?\.?\s+НА\s+СМЕТКА|СМЕТКА\s+БР\.?|БРОЈ\s+НА\s+БОН)\s*:?\s*([A-ZА-Я0-9][\w/-]*)/.exec(u);
    if (dn && !docNo) { docNo = dn[1]!; continue; }
    const rd = new RegExp('(?:^|\\s|ГРУПА\\s+|ДДВ\\s+)' + LET + '\\s*[=:]?\\s*(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%').exec(u);
    if (rd) rates[letter(rd[1]!)] = num(rd[2]!);
    const v = new RegExp('^\\s*ДДВ\\s+' + LET + '(?=[\\s:=])').exec(u);
    if (v) { const a = lastAmount(u); if (a != null) vat[letter(v[1]!)] = a; continue; }
    const pg = new RegExp('^\\s*(?:ПРОМЕТ|ОСНОВА\\s+И\\s+ДДВ)\\s+' + LET + '(?=[\\s:=])').exec(u);
    if (pg) { const a = lastAmount(u); if (a != null) grossP[letter(pg[1]!)] = a; continue; }
    if (/^\s*(?:ВКУПНО\s+ДДВ|ВКУПЕН\s+ДДВ|ДДВ\s+ВКУПНО|ДДВ\s+ИЗНОС)/.test(u)) { const a = lastAmount(u); if (a != null) vatTotal = a; continue; }
    if (/^\s*(?:ВКУПНО|ВКУПЕН\s+ИЗНОС|ЗА\s+НАПЛАТА|ИЗНОС\s+ЗА\s+НАПЛАТА)/.test(u) && !/ДДВ|ПОПУСТ/.test(u)) { const a = lastAmount(u); if (a != null) total = Math.max(total, a); continue; }
    if (/^\s*ГОТОВИНА/.test(u)) { cash = lastAmount(u) ?? 0; continue; }
    if (/^\s*(?:КАРТИЧ|ПЛАТЕЖНА\s+КАРТ)/.test(u)) { card = lastAmount(u) ?? 0; continue; }
    if (/^\s*(?:КУСУР|ВРАТЕНО|ПОВРАТ)/.test(u)) { change = lastAmount(u) ?? 0; continue; }
    if (/^\s*(?:ЧЕК|ВАУЧЕР|ВИРМАН|ДРУГО)/.test(u)) { other = lastAmount(u) ?? 0; continue; }
    if (/ПОПУСТ|РАБАТ/.test(u) && amountsIn(u).length) return no('сметката има попуст – проверка со AI');
    const m1 = ITEM1.exec(s.toUpperCase());
    if (m1) {
      const name = (s.slice(0, m1[1]!.length).trim() || pending).trim();
      items.push({ name, qty: num(m1[2]!), price: amtOf(m1[3]!), amount: amtOf(m1[4]!), group: letter(m1[5]!), rate: 0 });
      pending = ''; continue;
    }
    const m2 = ITEM2.exec(s.toUpperCase());
    if (m2 && !SKIP.test(u)) {
      items.push({ name: s.slice(0, m2[1]!.length).trim(), qty: 1, price: amtOf(m2[2]!), amount: amtOf(m2[2]!), group: letter(m2[3]!), rate: 0 });
      pending = ''; continue;
    }
    pending = amountsIn(u).length || SKIP.test(u) ? '' : s.trim();
  }
  const merchant = (() => {
    const e = U.findIndex((u) => /ЕДБ|ДАН\.?\s*БРОЈ/.test(u));
    const top = L.slice(0, e > 0 ? e : 4);
    return top.find((s) => /[А-ЯA-Zа-яa-z]{3,}/.test(s) && !SKIP.test(up(s)))?.trim() ?? '';
  })();

  // ── checks ─────────────────────────────────────────────────────────────────────────────────────────────────────
  if (!(total > 0)) return no('нема вкупен износ');
  if (!date) return no('нема датум');
  if (edb.length !== 13 && !vatId) return no('нема ЕДБ на продавачот');
  for (const it of items) it.rate = rates[it.group] ?? 0;
  const gross: Record<string, number> = {};
  if (items.length) {
    for (const it of items) {
      if (Math.abs(r2(it.qty * it.price) - it.amount) > 0.02) return no(`ставка „${it.name}“: ${it.qty} × ${it.price} ≠ ${it.amount}`);
      gross[it.group] = r2((gross[it.group] ?? 0) + it.amount);
    }
  } else Object.assign(gross, grossP);
  if (!Object.keys(gross).length) return no('нема ставки ни промет по даночни групи');
  const sum = r2(Object.values(gross).reduce((a, x) => a + x, 0));
  if (Math.abs(sum - total) > 0.02) return no(`Σ ставки ${sum.toFixed(2)} ≠ вкупно ${total.toFixed(2)}`);
  const groups: ReceiptGroup[] = Object.entries(gross).map(([g, x]) => {
    const r = rates[g] ?? 0;
    return { group: g, rate: r, gross: x, vat: vat[g] ?? r2((x * r) / (100 + r)) };
  });
  for (const g of groups) {
    if (vat[g.group] == null) continue;
    const exp = r2((g.gross * g.rate) / (100 + g.rate));
    if (Math.abs(exp - g.vat) > 0.05 + 0.01 * items.length) return no(`ДДВ ${g.group} ${g.vat.toFixed(2)} ≠ промет × ${g.rate}% (${exp.toFixed(2)})`);
  }
  for (const g of Object.keys(vat)) if (!(g in gross) && vat[g]! > 0) return no(`ДДВ за група ${g} без промет`);
  const vatAmount = r2(groups.reduce((a, g) => a + g.vat, 0));
  if (vatTotal != null && Math.abs(vatTotal - vatAmount) > 0.05) return no(`Σ ДДВ ${vatAmount.toFixed(2)} ≠ вкупно ДДВ ${vatTotal.toFixed(2)}`);
  const paid = r2(cash + card + other - change);
  if ((cash || card || other) && Math.abs(paid - total) > 0.02) return no(`платено ${paid.toFixed(2)} ≠ вкупно ${total.toFixed(2)}`);

  const main = [...groups].sort((a, b) => b.gross - a.gross)[0]!;
  const names = up(items.map((i) => i.name).join(' '));
  const cat = category(names);
  const fuel = items.filter((i) => FUEL.test(up(i.name)));
  const payment = card > cash && card >= other ? 'card' : other > cash ? 'other' : 'cash';
  const R: FreeReceipt = {
    country: 'MK', currency: 'MKD', date, time, docNo, merchant, vatId: vatId || edb, edb, total, vatRate: main.rate, vatAmount, category: cat, payment,
    liters: cat === 'fuel' && fuel.length ? r2(fuel.reduce((a, i) => a + i.qty, 0)) : null, items, groups,
  };
  return { data: { receipts: [R], noai: true, note: NOAI_NOTE }, ok: true, why: '', checks: ['Σ ставки = вкупно', 'ДДВ = промет × стапка', 'платено = вкупно'] };
}
