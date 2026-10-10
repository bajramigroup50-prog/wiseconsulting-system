/**
 * Supplier return / credit note read by AI (legacy `scrFromScan` 16213 + the checks of `scrScanFile` 16229): the
 * SCR_PROMPT result → a supplier-credit draft (kind, supplier, original purchase, rows) and the review messages.
 */
import { matchItem, type MatchItem, type MatchPartner } from './scan';

export interface ScrScanResult {
  docType?: string; supplierName?: string; supplierEdb?: string; number?: string; date?: string; refInvoice?: string; reason?: string;
  lines?: { code?: string; barcode?: string; name?: string; unit?: string; qty?: number | string; price?: number | string; amount?: number | string; rate?: number | string }[];
  groups?: { rate?: number | string; base?: number | string; vat?: number | string }[];
  total?: number | string;
}
export interface ScrScanPurchase { id: string; number: string; date: string; partnerId: string | null; warehouseId: string | null; itemIds: string[]; groups: { rate: number; account: string }[] }
export interface ScrScanDraft {
  kind: 'ret' | 'disc'; date: string; supNo: string; note: string; partnerId: string; refPurchaseId: string; warehouseId: string;
  rows: { itemId: string; name: string; qty: number; price: number; rate: number; account: string }[];
  newSupplier: { name: string; edb: string } | null;
}

const dig = (x: unknown) => String(x ?? '').replace(/\D/g, '');
const nn = (x: unknown) => String(x ?? '').toLowerCase().replace(/[^0-9a-zа-шѓќљњџѕј]/gi, '');
const num = (x: unknown) => Number(x) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function scrDraftFromScan(r: ScrScanResult, o: {
  partners: readonly MatchPartner[]; items: readonly MatchItem[]; purchases: readonly ScrScanPurchase[]; today: string;
  /** Stock konto of an item type in a warehouse (legacy `stockK`). */
  stockKonto: (type: string, wh: string) => string;
}): { draft: ScrScanDraft; msgs: string[]; total: number } {
  const kind: 'ret' | 'disc' = r.docType === 'credit' ? 'disc' : 'ret';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') ? r.date! : o.today;
  const ed = dig(r.supplierEdb);
  let P: MatchPartner | undefined = ed.length >= 7 ? o.partners.find((p) => dig(p.edb) === ed) : undefined;
  if (!P && r.supplierName) {
    const n = nn(r.supplierName);
    P = o.partners.find((p) => n && nn(p.name) === n) ?? o.partners.find((p) => n.length > 5 && nn(p.name).includes(n.slice(0, 12)));
  }
  const L = (r.lines ?? []).filter((l) => num(l.qty) || num(l.amount));
  const its = L.map((l) => matchItem(o.items, l.name, l.code, l.barcode, P?.id ?? null));
  let ref: ScrScanPurchase | undefined;
  if (P) {
    const PS = o.purchases.filter((p) => p.partnerId === P!.id).sort((a, b) => b.date.localeCompare(a.date));
    const rf = nn(r.refInvoice);
    if (rf) {
      ref = PS.find((p) => nn(p.number) === rf);
      if (!ref && rf.length >= 3) { const C = PS.filter((p) => { const n = nn(p.number); return n.length >= 3 && (n.endsWith(rf) || rf.endsWith(n)); }); if (C.length === 1) ref = C[0]; }
    }
    if (!ref && kind === 'ret') {
      const ids = its.filter((x): x is MatchItem => !!x).map((i) => i.id);
      ref = PS.find((p) => p.date <= date && ids.length > 0 && ids.every((id) => p.itemIds.includes(id))) ?? PS.find((p) => p.date <= date && ids.some((id) => p.itemIds.includes(id)));
    }
  }
  const wh = ref?.warehouseId ?? '';
  const rows = kind === 'ret'
    ? L.map((l, i) => {
      const it = its[i];
      const q = num(l.qty) || 1;
      const pr = num(l.price) || (num(l.amount) ? r4(num(l.amount) / q) : 0);
      return { itemId: it?.id ?? '', name: it ? it.name : String(l.name ?? ''), qty: q, price: pr, rate: l.rate != null && l.rate !== '' ? num(l.rate) : it?.rate ?? 18, account: o.stockKonto(it?.type ?? 'goods', wh || 'main') };
    })
    : ((r.groups ?? []).filter((g) => num(g.base)).length ? (r.groups ?? []).filter((g) => num(g.base)) : [{ rate: 18, base: r2(num(r.total) / 1.18) }]).map((g) => ({
      itemId: '', name: 'Одобрение ' + (r.number ?? '') + (r.refInvoice ? ' кон ф-ра ' + r.refInvoice : ''), qty: 1, price: num(g.base), rate: num(g.rate),
      account: ref?.groups.find((x) => x.rate === num(g.rate))?.account ?? '4000',
    }));
  const draft: ScrScanDraft = {
    kind, date, supNo: String(r.number ?? ''), note: [r.reason, r.refInvoice ? 'кон ф-ра ' + r.refInvoice : ''].filter(Boolean).join(' · '),
    partnerId: P?.id ?? '', refPurchaseId: ref?.id ?? '', warehouseId: wh, rows, newSupplier: P ? null : { name: String(r.supplierName ?? ''), edb: String(r.supplierEdb ?? '') },
  };
  const msgs: string[] = [];
  const miss = kind === 'ret' ? L.filter((_, i) => !its[i]).map((l) => String(l.name ?? '')) : [];
  if (miss.length) msgs.push('Непрепознати артикли: ' + miss.slice(0, 4).join(', ') + ' – изберете ги од шифрарникот');
  if (!ref) msgs.push('Не е најдена оригиналната фактура' + (r.refInvoice ? ' (' + r.refInvoice + ')' : '') + ' – изберете ја');
  return { draft, msgs, total: num(r.total) };
}
