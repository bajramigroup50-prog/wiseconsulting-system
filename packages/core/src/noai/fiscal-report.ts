/**
 * Fiscal report of a cash register (periodic „ПЕРИОД. ФИНАНСИСКИ ИЗВЕШТАЈ“ or a series of daily Z reports „ДНЕВЕН
 * ФИНАНСИСКИ ИЗВЕШТАЈ“) read WITHOUT AI from a text export / text PDF. The result is a `FiskRead` — the shape of the
 * `FISK_PROMPT` answer — so `fiskAfterRead` / `fiskFinish` / `fiskEditorRows` and the fiskPer screen work unchanged.
 *
 * Tax groups (verified against `FISK_G0` and the fiscal-printer rules): А = 18 %, Б = 5 %, В = 0 % (ослободено),
 * Г = 10 %. A rate printed on the report („ДДВ А 18.00%“, „Б = 5%“) overrides the default.
 *
 * Accepted only when every report (each day, or the period) passes:
 *   - a total turnover > 0 and Σ „ПРОМЕТ А/Б/В/Г“ = „ВКУПЕН ПРОМЕТ“ (± 0.05),
 *   - each printed „ДДВ X“ = turnover × r / (100 + r) (± 1 den., more for many receipts: per-receipt rounding),
 *   - Σ ДДВ per group = printed „ДДВ ИЗНОС“ (± 0.05) when printed,
 *   - printed payments (готовина + картичка + друго) = total (± 1),
 *   - a date (daily) / the period „ОД … ДО …“ (periodic).
 * Otherwise `data` is null and `why` is the reason (the caller reads it with AI).
 */
import { r2 } from '../money';
import { FISK_G0, FK_LAT, type FiskRead, type FiskReadDay } from '../ai/fisk';
import { amountsIn, dateIn, lastAmount, NOAI_NOTE, up, type FreeParse } from './doc-text';

export type FiskFree = FiskRead & { noai: true; note: string };

const L_RE = '([АБВГABVG])';
const letter = (s: string) => FK_LAT[s] ?? s;
const DAY_HEAD = /ДНЕВЕН\s+(?:ФИНАНСИСКИ\s+)?ИЗВЕШТАЈ|\bZ[- ]?ИЗВЕШТАЈ|\bZ[- ]?REPORT/;
const PER_HEAD = /ПЕРИОД\S*\s+(?:ФИНАНСИСКИ\s+)?ИЗВЕШТАЈ|ФИНАНСИСКИ\s+ИЗВЕШТАЈ\s+ЗА\s+ПЕРИОД/;

interface Block extends FiskReadDay { vatTotal: number | null; rates: Record<string, number>; from: string; to: string; zFrom: string; zTo: string; paid: boolean }

/** One report (a day or the period). */
function block(L: readonly string[]): Block {
  const b: Block = { gross: {}, vat: {}, total: 0, cash: 0, card: 0, other: 0, storno: 0, receipts: 0, vatTotal: null, rates: {}, from: '', to: '', zFrom: '', zTo: '', date: '', z: '', paid: false };
  let sto = false, mk = false;
  const tot: number[] = [];
  for (const raw of L) {
    const u = up(raw);
    if (/СТОРН[ОИ]\s+СМЕТК/.test(u)) { sto = true; mk = false; continue; }
    if (/МАКЕДОНСКИ\s+ПР/.test(u)) { mk = true; continue; }
    if (/^\s*(?:ФИСКАЛНИ\s+СМЕТКИ|РЕКЛАМИРАНИ|ВКУПНО\s+ЗА\s+ПЕРИОД)/.test(u)) mk = false;
    const per = /ОД\s*:?\s*(\d{1,2}[-./]\d{1,2}[-./]\d{4})\s*ДО\s*:?\s*(\d{1,2}[-./]\d{1,2}[-./]\d{4})/.exec(u);
    if (per) { b.from = dateIn(per[1]!); b.to = dateIn(per[2]!); continue; }
    const zr = /ОД\s*:?\s*(?:Z\s*)?(\d{1,6})\s*ДО\s*:?\s*(?:Z\s*)?(\d{1,6})(?!\s*[-./]\d)/.exec(u);
    if (zr) { b.zFrom = zr[1]!; b.zTo = zr[2]!; continue; }
    const z = /(?:\bZ\s*(?:БР\.?|БРОЈ|NO\.?|#)?|БРОЈ\s+НА\s+Z(?:-ИЗВЕШТАЈ)?|ИЗВЕШТАЈ\s+БР\.?)\s*:?\s*(\d{1,6})(?![\d./-])/.exec(u);
    if (z && !b.z && !/СМЕТКИ/.test(u)) b.z = z[1]!;
    if (!b.date && !/ОД\s*:/.test(u)) { const d = dateIn(u); if (d) b.date = d; }
    // group rate definitions („А = 18%“, „ДАНОЧНА ГРУПА Б 5%“, „ДДВ А 18.00% …“)
    const rd = new RegExp('(?:^|\\s|ГРУПА\\s+|ДДВ\\s+)' + L_RE + '\\s*[=:]?\\s*(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%').exec(u);
    if (rd) b.rates[letter(rd[1]!)] = +rd[2]!.replace(',', '.');
    if (sto) { if (/ВКУПЕН\s+ПРОМЕТ/.test(u)) b.storno = Math.max(b.storno as number, lastAmount(u) ?? 0); continue; }
    if (/БРОЈ\s+(?:НА\s+)?ФИСК\S*\s*СМЕТКИ/.test(u)) { const n = /(\d+)\s*$/.exec(u); if (n) b.receipts = +n[1]!; continue; }
    if (mk) continue;
    const g = new RegExp('^\\s*ПРОМЕТ\\s+' + L_RE + '(?=[\\s:])').exec(u);
    if (g) { const a = lastAmount(u); if (a != null) { const k = letter(g[1]!); b.gross![k] = Math.max(+(b.gross![k] ?? 0), a); } continue; }
    const v = new RegExp('^\\s*ДДВ\\s+' + L_RE + '(?=[\\s:=])').exec(u);
    if (v) { const a = lastAmount(u); if (a != null && amountsIn(u).length) b.vat![letter(v[1]!)] = a; continue; }
    if (/^\s*(?:ДДВ\s+ИЗНОС|ВКУПЕН\s+ДДВ|ВКУПНО\s+ДДВ)/.test(u)) { const a = lastAmount(u); if (a != null) b.vatTotal = a; continue; }
    if (/^\s*ВКУПЕН\s+ПРОМЕТ/.test(u)) { const a = lastAmount(u); if (a != null) tot.push(a); continue; }
    if (/^\s*ГОТОВИНА/.test(u)) { const a = lastAmount(u); if (a != null) { b.cash = a; b.paid = true; } continue; }
    if (/^\s*КАРТИЧ/.test(u)) { const a = lastAmount(u); if (a != null) { b.card = a; b.paid = true; } continue; }
    if (/^\s*(?:ЧЕК|ВИРМАН|ВАУЧЕР|ДРУГ\S*\s+ПЛА|ДРУГО)/.test(u)) { const a = lastAmount(u); if (a != null) { b.other = r2((b.other as number) + a); b.paid = true; } continue; }
  }
  b.total = tot.length ? Math.max(...tot) : 0;
  return b;
}

/** Check one report; '' when it passes. */
function check(b: Block, rates: Record<string, number>, what: string): string {
  const total = b.total as number;
  if (!(total > 0)) return `${what}: нема „ВКУПЕН ПРОМЕТ“`;
  const G = b.gross as Record<string, number>;
  if (!Object.keys(G).length) return `${what}: нема промет по даночни групи`;
  const sum = r2(Object.values(G).reduce((a, x) => a + x, 0));
  if (Math.abs(sum - total) > 0.05) return `${what}: Σ групи ${sum.toFixed(2)} ≠ вкупен промет ${total.toFixed(2)}`;
  const V = b.vat as Record<string, number>;
  const n = +(b.receipts ?? 0) || 0;
  for (const [L, vat] of Object.entries(V)) {
    const g = G[L] ?? 0, r = rates[L];
    if (r == null) return `${what}: непозната стапка за група ${L}`;
    const exp = r2((g * r) / (100 + r));
    if (Math.abs(exp - vat) > Math.max(1, n * 0.01)) return `${what}: ДДВ ${L} ${vat.toFixed(2)} ≠ промет × ${r}% (${exp.toFixed(2)})`;
  }
  if (b.vatTotal != null && Object.keys(V).length) {
    const vs = r2(Object.values(V).reduce((a, x) => a + x, 0));
    if (Math.abs(vs - b.vatTotal) > 0.05) return `${what}: Σ ДДВ ${vs.toFixed(2)} ≠ ДДВ износ ${b.vatTotal.toFixed(2)}`;
  }
  if (b.paid) {
    const pay = r2((b.cash as number) + (b.card as number) + (b.other as number));
    if (Math.abs(pay - total) > 1) return `${what}: плаќања ${pay.toFixed(2)} ≠ вкупен промет ${total.toFixed(2)}`;
  }
  return '';
}

const day = (b: Block): FiskReadDay => ({ date: b.date, z: b.z, gross: b.gross, vat: b.vat, total: b.total, cash: b.cash, card: b.card, other: b.other, storno: b.storno, receipts: b.receipts });

/** Read a fiscal report from its text lines (text export or the PDF text layer). */
export function fiscalReportFromLines(L0: readonly string[]): FreeParse<FiskFree> {
  const no = (why: string): FreeParse<FiskFree> => ({ data: null, ok: false, why, checks: [] });
  const L = L0.map((s) => s.trimEnd()).filter((s) => s.trim());
  const all = up(L.join('\n'));
  if (!/ВКУПЕН\s+ПРОМЕТ/.test(all) || !new RegExp('ПРОМЕТ\\s+' + L_RE).test(all)) return no('не е фискален извештај (нема „ВКУПЕН ПРОМЕТ“ / „ПРОМЕТ А…Г“)');
  // split into daily reports when there are several day headings
  const starts = L.map((s, i) => (DAY_HEAD.test(up(s)) ? i : -1)).filter((i) => i >= 0);
  const daily = starts.length >= 2 || (starts.length === 1 && !PER_HEAD.test(all));
  const head = daily ? L.slice(0, starts[0]) : [];
  const parts = daily ? starts.map((s, k) => L.slice(s, starts[k + 1] ?? L.length)) : [L];
  const B = parts.map(block);
  const H = block(head.length ? head : L);
  const rates: Record<string, number> = { ...FISK_G0 };
  for (const b of [H, ...B]) Object.assign(rates, b.rates);
  const checks: string[] = [];
  for (const [i, b] of B.entries()) {
    const why = check(b, rates, daily ? `Z ${b.z || i + 1}` : 'извештај');
    if (why) return no(why);
  }
  checks.push('Σ групи = вкупен промет', 'ДДВ = промет × стапка', 'плаќања = промет');
  const txt = (re: RegExp) => { for (const s of L) { const m = re.exec(up(s)); if (m) return m[1]!; } return ''; };
  const device = txt(/(?:РЕГ\.?\s*БРОЈ|БР\.?\s*НА\s*ФМ|ФИСКАЛЕН\s+БРОЈ|ИД\s+НА\s+АПАРАТ)\s*:?\s*([A-ZА-Ш]{1,3}\d{5,})/);
  const edb = txt(/(?:ДАН\.?\s*БРОЈ|ЕДБ)\s*:?\s*(?:MK|МК)?\s*(\d{13})/);
  let data: FiskFree;
  if (daily) {
    const D = B.map(day);
    if (D.some((d) => !d.date)) return no('дневен извештај без датум');
    const sumDay = (k: 'total' | 'cash' | 'card' | 'other' | 'storno' | 'receipts') => r2(D.reduce((a, d) => a + (+(d[k] ?? 0) || 0), 0));
    const gross: Record<string, number> = {}, vat: Record<string, number> = {};
    for (const d of D) {
      for (const [k, x] of Object.entries(d.gross ?? {})) gross[k] = r2((gross[k] ?? 0) + +(x ?? 0));
      for (const [k, x] of Object.entries(d.vat ?? {})) vat[k] = r2((vat[k] ?? 0) + +(x ?? 0));
    }
    const ds = D.map((d) => d.date!).sort();
    const zs = D.map((d) => d.z).filter(Boolean) as string[];
    data = {
      device, edb, from: ds[0]!, to: ds[ds.length - 1]!, zFrom: zs[0] ?? '', zTo: zs[zs.length - 1] ?? '', groups: rates, days: D,
      totals: { gross, vat, total: sumDay('total'), cash: sumDay('cash'), card: sumDay('card'), other: sumDay('other'), storno: sumDay('storno'), receipts: sumDay('receipts') },
      text: L.join('\n'), noai: true, note: NOAI_NOTE,
    };
    checks.push(`${D.length} дневни извештаи`);
  } else {
    const b = B[0]!;
    if (!b.from && !b.to && !b.date) return no('нема период (ОД … ДО …) ни датум');
    data = {
      device, edb, from: b.from || b.date!, to: b.to || b.date!, zFrom: b.zFrom, zTo: b.zTo, groups: rates, days: [],
      totals: day(b), text: L.join('\n'), noai: true, note: NOAI_NOTE,
    };
  }
  return { data, ok: true, why: '', checks };
}

