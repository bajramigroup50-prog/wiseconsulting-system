/**
 * Selection actions of the input calculations (legacy 17298 `ksInv`, `ksMerge`): the selected calculations' goods as
 * the lines of an outgoing invoice, and the checks + combined header / VAT groups of a merge.
 */
import { num, r2, r4 } from '../stock/num';

export interface KsStockLine { itemId: string; name?: string | null; qty: number | string; sp?: number | string | null }
export interface KsItem { id: string; name: string; unit?: string | null; rate?: number | null; price?: number | string | null; konto?: string | null }
export interface KsInvLine { itemId: string; name: string; unit: string; qty: number; price: number; rate: number; account: string }

/**
 * Legacy `ksInv`: one line per item (quantities of the same item add up), price = the item's sale price without VAT,
 * else the calculation's retail price without VAT, revenue account of the item (default 7400).
 */
export function ksInvLines(stock: readonly KsStockLine[], items: ReadonlyMap<string, KsItem>): KsInvLine[] {
  const out: KsInvLine[] = [];
  for (const s of stock) {
    if (!s.itemId || !num(s.qty)) continue;
    const ex = out.find((x) => x.itemId === s.itemId);
    if (ex) { ex.qty = r4(ex.qty + num(s.qty)); continue; }
    const it = items.get(s.itemId);
    const rate = num(it?.rate ?? 18);
    const pr = num(it?.price) || (s.sp != null && s.sp !== '' ? r2(num(s.sp) / (1 + rate / 100)) : 0);
    out.push({ itemId: s.itemId, name: it?.name || s.name || '', unit: it?.unit || 'ком', qty: num(s.qty), price: pr, rate, account: it?.konto || '7400' });
  }
  return out;
}

export interface KsCalc { id: string; number?: string | null; calcNo?: string | null; date: string; docDate?: string | null; partnerId?: string | null; supplierName?: string | null; wh?: string | null; imp?: boolean }

/** Legacy `ksMerge` checks: at least two, one supplier and one location, no import calculations. */
export function ksMergeCheck(L: readonly KsCalc[]): string | null {
  if (L.length < 2) return 'Селектирајте најмалку две калкулации.';
  const P = new Set(L.map((p) => p.partnerId || p.supplierName)), W = new Set(L.map((p) => p.wh || 'main'));
  if (P.size > 1 || W.size > 1) return 'Спојување е можно само за ист добавувач и ист објект.';
  if (L.some((p) => p.imp)) return 'Увозни калкулации не се спојуваат (различни курсеви и трошоци).';
  return null;
}

/** Legacy `ksMerge` header: supplier of the oldest, latest date, oldest document date, numbers joined with „+“. */
export function ksMergeHead(L: readonly KsCalc[]): { date: string; docDate: string; number: string; first: KsCalc } {
  const first = [...L].sort((a, b) => (a.date < b.date ? -1 : 1))[0]!;
  return { date: L.map((p) => p.date).sort().pop()!, docDate: first.docDate || first.date, number: L.map((p) => p.number).filter(Boolean).join('+'), first };
}

/** VAT groups summed per account and rate (legacy `groups[konto|rate]`). */
export function ksMergeGroups(G: readonly { account: string; rate: number | string; base: number | string; vat: number | string }[]): { account: string; rate: number; base: number; vat: number }[] {
  const M = new Map<string, { account: string; rate: number; base: number; vat: number }>();
  for (const g of G) {
    const k = g.account + '|' + num(g.rate);
    const o = M.get(k) ?? { account: g.account, rate: num(g.rate), base: 0, vat: 0 };
    o.base = r2(o.base + num(g.base));
    o.vat = r2(o.vat + num(g.vat));
    M.set(k, o);
  }
  return [...M.values()];
}
