/**
 * Finance parity — partner cards (`kartici`): supplier warnings (legacy `supWarn` 8485 + wrapper 8621). Pure.
 */
import { r2 } from './money';

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
