/**
 * Restaurant (legacy 9959–9991): tables, open bills, kitchen queue.
 * Bills are paid through the Phase 7 POS (`posSell` → `sales_daily`), which also issues stock and BOM components.
 */
import { num, r2, r4 } from './common';

export interface OrderLine { itemId: string; name: string; qty: number; price: number; rate: number; sent?: string | null; ready?: string | null; note?: string | null }

/** Legacy `roTot`: bill total incl. VAT. */
export const orderTotal = (lines: readonly OrderLine[]) => r2(lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0));

/** Legacy `roAdd`: add one piece — merges into an unsent line of the same item without a note. */
export function orderAdd(lines: readonly OrderLine[], it: { id: string; name: string; price: number; rate: number }): OrderLine[] {
  const L = lines.map((l) => ({ ...l }));
  const ex = L.find((l) => l.itemId === it.id && !l.sent && !l.note);
  if (ex) ex.qty = r4(ex.qty + 1);
  else L.push({ itemId: it.id, name: it.name, qty: 1, price: it.price, rate: it.rate, sent: null, ready: null });
  return L;
}

/** Legacy `roQ`: change a line's quantity; a line at 0 is removed. */
export function orderQty(lines: readonly OrderLine[], i: number, d: number): OrderLine[] {
  const L = lines.map((l) => ({ ...l }));
  const l = L[i];
  if (!l) return L;
  l.qty = r4(l.qty + d);
  if (l.qty <= 0) L.splice(i, 1);
  return L;
}

/** Legacy `roSend`: mark unsent lines as sent to the kitchen. */
export const orderSend = (lines: readonly OrderLine[], now: string): OrderLine[] => lines.map((l) => (l.sent ? { ...l } : { ...l, sent: now, ready: null }));
