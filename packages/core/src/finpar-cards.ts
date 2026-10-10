/**
 * Finance parity — partner cards (`kartici`): supplier warnings (legacy `supWarn` 8485 + wrapper 8621). Pure.
 */
import { r2 } from './money';
import { recKeys, recMatch, type OurRow, type TheirRow } from './finance';

const ymAdd = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export interface SupWarn { pid: string; lvl: 'warn' | 'bad'; txt: string }

/**
 * a) a regular supplier (an invoice in each of the 3 months before last month) has no invoice for the last finished
 *    month (checked from the 10th of the month);
 * b) payments to the supplier on 22x not linked to an invoice exceed the open invoices;
 * plus (wrapper 8621) the supplier's 22x balance is in debit (> 1): paid more than the invoices entered.
 */
export function supplierWarnings(a: {
  pid: string; name: string; today: string; year: string;
  purchaseMonths: readonly string[];
  unlinkedPays: readonly { date: string; amount: number }[];
  openInvoices: number;
  balance22: number;
  fmt: (n: number) => string;
}): SupWarn[] {
  const W: SupWarn[] = [];
  if (a.balance22 > 1) W.push({ pid: a.pid, lvl: 'bad', txt: `Салдото на добавувачот е во должи ${a.fmt(a.balance22)} ден. – платено е повеќе отколку што има внесени фактури. Недостасува влезна фактура (или аванс).` });
  const cm = a.today.slice(0, 7), pm = ymAdd(cm, -1), pp = [1, 2, 3].map((i) => ymAdd(pm, -i));
  const M = new Set(a.purchaseMonths);
  if (+a.today.slice(8, 10) >= 10 && pp.every((m) => M.has(m)) && !M.has(pm) && !M.has(cm)) {
    W.push({ pid: a.pid, lvl: 'warn', txt: `${a.name || 'Добавувач'} доставува фактура секој месец (${pp.slice().reverse().map((m) => m.slice(5)).join(', ')}) – за ${pm.slice(5)}/${pm.slice(0, 4)} нема влезна фактура.` });
  }
  const P = a.unlinkedPays.filter((p) => p.date.startsWith(a.year) && p.amount);
  const sum = r2(P.reduce((s, p) => s + Math.abs(p.amount), 0));
  if (P.length && sum > a.openInvoices + 1) {
    const last = P.map((p) => p.date).sort().pop()!;
    W.push({ pid: a.pid, lvl: 'warn', txt: `${a.name || 'Добавувач'}: ${P.length} плаќања (${a.fmt(sum)} ден., последно ${last.split('-').reverse().join('.')}) не се поврзани со фактура, а отворени фактури има само ${a.fmt(a.openInvoices)} ден. – фактурата веројатно не е внесена.` });
  }
  return W;
}

const RF_OPEN = /почет|пренос|салдо од|состојба на|opening|initial|prenos/i;

export type RfMode = 'auto' | 'year' | 'all' | 'custom';

/**
 * Legacy `rfRun` v433 (13817, „Период за споредба“) + v432 (13803): compare two cards in the chosen period —
 * `auto` = common period of both cards, `year` = one year, `all` = whole cards, `custom` = from–to. Rows before the period
 * form the opening balance (compared only when card 2 has an opening, starts before the period, or both start
 * together); `difPer` = difference inside the period, `difTot` = with the opening difference when compared.
 */
export function compareCardsPeriod(a: readonly TheirRow[], b: readonly TheirRow[], o: { mode?: RfMode; year?: number; from?: string; to?: string; mirror?: boolean } = {}) {
  const isOpen = (r: TheirRow) => RF_OPEN.test(String(r.desc || '') + ' ' + String(r.doc || ''));
  const oA = a.filter(isOpen), oB = b.filter(isOpen), A0 = a.filter((r) => !isOpen(r)), B0 = b.filter((r) => !isOpen(r));
  const range = (rows: readonly TheirRow[]) => { const d = rows.map((r) => r.date).filter(Boolean).sort(); return d.length ? { from: d[0]!, to: d[d.length - 1]! } : null; };
  const rA = range(A0), rB = range(B0);
  if (!rA || !rB) return null;
  const md = o.mode ?? 'auto';
  const y = String(o.year ?? new Date().getFullYear());
  let from: string, to: string;
  if (md === 'year') { from = y + '-01-01'; to = y + '-12-31'; }
  else if (md === 'all') { from = rA.from < rB.from ? rA.from : rB.from; to = rA.to > rB.to ? rA.to : rB.to; }
  else if (md === 'custom') { from = o.from || rA.from; to = o.to || rA.to; }
  else { from = rA.from > rB.from ? rA.from : rB.from; to = rA.to < rB.to ? rA.to : rB.to; }
  const inP = (r: TheirRow) => r.date >= from && r.date <= to;
  const sum = (L: readonly TheirRow[]) => r2(L.reduce((s, r) => s + (+r.debit || 0) - (+r.credit || 0), 0));
  const preA = r2(sum(A0.filter((r) => r.date < from)) + sum(oA)), preBraw = r2(sum(B0.filter((r) => r.date < from)) + sum(oB));
  const ours: OurRow[] = A0.filter(inP).map((x, i) => ({ i, date: x.date, doc: x.doc, label: x.desc || '', keys: [...recKeys(x.doc), ...recKeys(x.desc)], amt: r2((+x.debit || 0) - (+x.credit || 0)), k: '', open: false }));
  const Bp = B0.filter(inP);
  const run = (mir: boolean) => { const B = mir ? Bp : Bp.map((x) => ({ ...x, debit: x.credit, credit: x.debit })); return { B, M: recMatch(ours, B) }; };
  let mir = o.mirror;
  if (mir == null) { const x1 = run(true), x2 = run(false); mir = !(x2.M.pairs.length > x1.M.pairs.length); }
  const { B, M } = run(mir);
  const preB = mir ? r2(-preBraw) : preBraw;
  const hasOpenB = oB.length > 0;
  const cmpPre = md !== 'all' && (hasOpenB || rB.from < from || (md === 'auto' && rA.from >= rB.from));
  const difPer = r2(M.onlyO.reduce((s, x) => s + x.amt, 0) - M.onlyT.reduce((s, t) => s + t.credit - t.debit, 0) + M.adiff.reduce((s, d) => s + d.diff, 0));
  const preDif = r2(preA - preB);
  return {
    from, to, rA, rB, mode: md, mirror: mir, auto: o.mirror == null, M, preA, preB, preDif, hasOpenB, cmpPre, difPer, difTot: r2(difPer + (cmpPre ? preDif : 0)),
    outA: A0.filter((r) => !inP(r)).length, outB: B0.filter((r) => !inP(r)).length,
    sA: r2(ours.reduce((s, x) => s + x.amt, 0) + preA), sB: r2(B.reduce((s, t) => s + t.credit - t.debit, 0) + preB),
  };
}

/** Legacy `recParse` 12923–12924: a `REC_PROMPT` read (partner card from PDF / image) → card rows + opening balance. */
export function cardFromRead(res: unknown): { rows: { date: string; doc: string; desc: string; debit: number; credit: number }[]; opening: number } {
  const r = (Array.isArray(res) ? { rows: res } : (res ?? {})) as { rows?: unknown[]; opening?: unknown };
  const d = (v: unknown) => {
    const s = String(v ?? '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
    return !m ? '' : m[1]!.length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  };
  const rows = (r.rows ?? []).map((x0) => {
    const x = (x0 ?? {}) as Record<string, unknown>;
    return { date: d(x.date), doc: String(x.doc ?? ''), desc: String(x.desc ?? ''), debit: r2(+(x.debit as number) || 0), credit: r2(+(x.credit as number) || 0) };
  }).filter((x) => x.debit || x.credit);
  return { rows, opening: r2(+(r.opening as number) || 0) };
}
