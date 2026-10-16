'use client';
/**
 * Invoice / credit note / proforma / dispatch editor — legacy `invEditor` 4140 → 14299, `invHeader` 4077, `qaBar` 4162,
 * `totBox` 4183, `readInvForm` 4186 (one React state instead of the global DOM listeners).
 * FIX (LEGACY-MAP 3.4 item 17): legacy's SELECT change handler recomputed the totals without the advances
 * (`totBox(...)` without `d`); here the totals box always includes them.
 */
import Link from 'next/link';
import { Fragment, useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  addDays, CURRENCIES, creditGrossLines, DT, fuelInvoiceCheck, invoiceTotals, isDraftNo, PARITY, PAYM, plansFromSavedRun, prodSummary, PTERMS, specText, workOrderLabel, type DtKey,
} from '@wise/core/sales';
import type { FuelRule } from '@wise/core/law';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { createInvoiceNalogAction, createProductAction, saveInvoiceAction, setSvcOnlyAction } from '@/app/(app)/izlez/actions';
import { fxDefaultRate } from '@/app/(app)/_fx/actions';
import { blankCostEls, blankLine, blankSpec, mainProdLine, OTHER_COSTS, type EdInvoice, type EdLine } from './model';
import { lineCalc, LineProdPanel, reProd, startProd } from './prod-panel';
import { MainProductCard, WorkOrderBox, type WorkOrderOpt } from './prod-invoice';
import { buyerHint, EDB_HINT, firstEmptyRow, headerMissing, headerMissingText, headerSummary } from './invoice-steps';
import type { ProdBom, ProdCostInput, ProdSpec } from '@wise/core/sales';

export interface InvItemOpt { id: string; code: string | null; name: string; unit: string | null; price: number; rate: number; type: string; account: string | null; barcodes: string[]; sp: Record<string, number> }
export interface RefInvoice { id: string; number: string; date: string; partnerId: string | null; total: number; art32: boolean; export: boolean; lines: EdLine[];
  /** Other credit notes on this invoice (legacy `crOthers`): numbers, credited total and returned qty per item. */
  others?: { numbers: string[]; total: number; returned: Record<string, number> } }
export interface AdvanceOpt { id: string; number: string; date: string; partnerId: string | null; base: number; used: number; art32: boolean; lines: EdLine[] }

export interface InvoiceEditorProps {
  initial: EdInvoice;
  title: string;
  sub?: string;
  partners: { id: string; code: string | null; name: string; edb: string | null; address?: string | null; city?: string | null }[];
  items: InvItemOpt[];
  /** Stock quantity per item and location id ('main' = main warehouse). */
  stock: Record<string, Record<string, number>>;
  locations: { id: string; code: string | null; name: string; kind: string }[];
  accounts: [string, string][];
  refInvoices: RefInvoice[];
  advances: AdvanceOpt[];
  revDefault: string;
  /** Revenue konto per item type from the scheme (legacy REV_K). */
  revByType: Record<string, string>;
  /** Advance konto from the scheme — FIX (LEGACY-MAP 3.4 item 2): the callout used to say 2270 while posting used 2220. */
  advanceKonto: string;
  nonVat: boolean;
  /** Number of the nalog the saved invoice is booked in. */
  nalogNo?: string | null;
  /** „Налог за книжење“: open sale nalozi of the year and the number „+ Креирај налог“ proposes. */
  nalozi?: NalogOpt[];
  nextNalog?: string;
  /** Next number of the issued series (a draft gets it when it is booked). */
  nextNumber?: string;
  /** The draft was just created / saved („Креирај фактура“); warnings of that save. */
  drafted?: string | null;
  back: string;
  firmAddress?: string | null;
  scanInfo?: string;
  /** Firm offers only services (legacy `svcMode` 14296). */
  svcOnly?: boolean;
  /** Remembered free-text services (legacy `firm.svcTexts`). */
  svcTexts?: string[];
  /** Vehicle code-book (legacy `vehList`) and driver names (`drvList`). */
  vehicles?: { code: string; name: string }[];
  drivers?: string[];
  /** Partners that are not VAT payers (legacy art. 32-a warning). */
  nonVatPartners?: string[];
  fuelRule?: FuelRule | null;
  canSettings?: boolean;
  /** Production from the invoice: normativi, average cost per item and location, the saved run. */
  boms?: Record<string, ProdBom>;
  avg?: Record<string, Record<string, number>>;
  prodRun?: InvoiceProdRun | null;
  /** „🏭 Фактура од производство“: earlier work orders of the firm and the proposed number of a new one. */
  workOrders?: WorkOrderOpt[];
  nextWorkOrder?: string;
}
export interface NalogOpt { number: string; description: string; from: string; to: string; periodFrom: string | null; periodTo: string | null; invoices: number; collective: boolean }

export interface InvoiceProdRun {
  wh: string | null; extra: number; saveBom: boolean;
  lines: { lineNo: number; productId: string; qty: number; materials: { itemId: string; qty: number }[]; wh?: string | null; extra?: number | null; saveBom?: boolean; main?: boolean; spec?: ProdSpec | null; calc?: ProdCostInput | null }[];
  orders: { id: string; number: string; productId: string; lineNo: number; lab?: number }[];
  notes?: string[];
}

const s0 = (v: unknown) => (v == null ? '' : String(v));
/** Saved cost elements → editor strings (the standard other-cost rows first). */
function costEls(c: ProdCostInput | null | undefined) {
  const B = blankCostEls();
  if (!c) return B;
  const other = [...(c.other ?? []).map((o) => ({ label: o.label, amount: s0(o.amount) }))];
  for (const l of OTHER_COSTS) if (!other.some((o) => o.label === l)) other.push({ label: l, amount: '' });
  return { hours: s0(c.hours), rate: s0(c.rate), labour: s0(c.labour), ovhPct: s0(c.ovhPct), other };
}

/**
 * The editor lines of a saved invoice with their „🏭 производство“ markers. An older invoice saved with the
 * invoice-level „Производство = Да“ (no per-line fields) is read back as marked lines.
 */
function withSavedProd(x: EdInvoice, run: InvoiceProdRun | null | undefined, items: readonly InvItemOpt[]): EdInvoice {
  if (x.kind !== 'invoice') return x;
  const perLine = !!run?.lines.some((l) => l.saveBom !== undefined || l.extra != null || l.wh !== undefined);
  const plans = plansFromSavedRun(run, x.lines, { legacyFlag: x.data.prod === 'Д' && !perLine, isProduct: (id) => items.find((i) => i.id === id)?.type === 'product' });
  if (!plans.some(Boolean)) return x;
  return {
    ...x, lines: x.lines.map((l, i) => {
      const P = plans[i];
      if (!P) return l;
      const prod = { wh: P.wh ?? '', extra: P.extra ? String(P.extra) : '', saveBom: P.saveBom, materials: P.materials.map((m) => ({ itemId: m.itemId, qty: String(m.qty) })), fromBom: false, open: !P.materials.length };
      if (!P.main) return { ...l, prod };
      // main product of a production invoice: the specification printed after the name goes back to its own fields
      const sp = P.spec ?? null;
      const tail = specText(sp);
      const name = tail && l.name.endsWith(' – ' + tail) ? l.name.slice(0, -(tail.length + 3)) : l.name;
      return {
        ...l, name, prod: {
          ...prod, open: true, main: true, cost: costEls(P.calc),
          spec: sp ? { text: s0(sp.text), l: s0(sp.l), w: s0(sp.w), h: s0(sp.h), mode: (sp.mode || '') as '' | 'm' | 'm2' | 'm3', pcs: s0(sp.pcs) } : blankSpec(),
        },
      };
    }),
  };
}

const RATES = ['18', '10', '5', '0'];
const toItems = (L: readonly EdLine[]) => L.map((l) => ({ qty: Number(l.qty) || 0, price: Number(l.price) || 0, disc: Number(l.disc) || 0, rate: Number(l.rate) || 0, konto: l.account }));
const d0svc = (x: EdInvoice) => x.kind === 'invoice' && x.svc;
const lineAmt = (l: EdLine) => (Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.disc) || 0) / 100);

export function InvoiceEditor(p: InvoiceEditorProps) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveInvoiceAction, {});
  // a draft's provisional number („НАЦРТ-n“) is not shown as the invoice number: the series number comes at booking
  const [d, setD] = useState<EdInvoice>(() => {
    let x = withSavedProd(p.initial, p.prodRun, p.items);
    if (isDraftNo(x.number)) x = { ...x, number: '' };
    // a draft created from its header opens with the first main product card (production) or an empty row
    if (x.kind === 'invoice' && x.data.prodInv === '1' && !x.lines.some((l) => l.prod?.main)) x = { ...x, lines: [mainProdLine(p.revByType.product || p.revDefault, x.warehouseId, x.export ? '0' : '18'), ...x.lines] };
    else if (!x.lines.length) x = { ...x, lines: [blankLine(p.revDefault, x.export ? '0' : '18')] };
    return x;
  });
  const [nalozi, setNalozi] = useState<NalogOpt[]>(p.nalozi ?? []);
  const [newNal, setNewNal] = useState<{ number: string; date: string; description: string; from: string; to: string } | null>(null);
  const [nalBusy, setNalBusy] = useState(false);
  // header first: a new invoice is created as a draft from its header, then the lines are entered „from inside“
  const [direct, setDirect] = useState(false);
  const [tab, setTab] = useState<'osn' | 'dop' | 'pos'>('osn');
  const [qa, setQa] = useState({ q: '', sel: '' as string, qty: '1', i: 0 });
  const [toast, setToast] = useState('');
  // finished products created from an invoice line („+ Креирај производ“) before the page reloads
  const [newItems, setNewItems] = useState<InvItemOpt[]>([]);
  const [creating, setCreating] = useState<number | null>(null);
  const items = useMemo(() => [...p.items, ...newItems.filter((n) => !p.items.some((i) => i.id === n.id))], [p.items, newItems]);
  const boms = p.boms ?? {}, avgs = p.avg ?? {};
  const [svcOnly, setSvcOnly] = useState(!!p.svcOnly);
  const [, startT] = useTransition();
  const qaRef = useRef<HTMLInputElement>(null), qtyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // two steps: „Заглавие“ (open) → „Понатаму → Ставки“ folds it into one summary line and opens the lines in place;
  // a saved document opens folded, with the lines visible
  const [headOpen, setHeadOpen] = useState(() => !p.initial.id);
  const [headErr, setHeadErr] = useState('');
  const sumRef = useRef<HTMLDivElement>(null), linesRef = useRef<HTMLDivElement>(null), headRef = useRef<HTMLDivElement>(null);
  /** Grid row whose first field gets the focus after the next render (keyboard-first line entry). */
  // a draft just created from its header („Креирај фактура →“) opens with the cursor in the first empty line (row -2 = find it)
  const focusRow = useRef<{ row: number; f: string; scroll?: boolean } | null>(p.drafted != null && p.initial.id ? { row: -2, f: 'name' } : null);
  const svcMode = svcOnly || d0svc(p.initial);
  const set = (x: Partial<EdInvoice>) => setD((o) => ({ ...o, ...x }));
  const setData = (k: string, v: string) => setD((o) => ({ ...o, data: { ...o.data, [k]: v } }));
  // 💱 default rate from the rate list (NBRM / manual, the last list on or before the date); a typed rate stays
  const [fxSrc, setFxSrc] = useState<string | null>(null);
  const autoFx = (cur: string, date: string) => {
    if (cur === 'MKD' || !date) { setFxSrc(null); return; }
    startT(async () => { const r = await fxDefaultRate(cur, date); if (r.rate > 0) { set({ fx: String(r.rate) }); setFxSrc(r.src); } });
  };
  // a produced line follows its normativ when the quantity or the product changes
  const setLine = (i: number, x: Partial<EdLine>) => setD((o) => ({ ...o, lines: o.lines.map((l, k) => (k === i ? reProd({ ...l, ...x }, boms, x.itemId !== undefined && x.itemId !== l.itemId) : l)) }));
  const canProd = d.kind === 'invoice' && !d.advance;
  // „🏭 Фактура од производство“: chosen at the start; the main products open the invoice, the calculation follows them
  const prodInv = canProd && d.data.prodInv === '1';
  const isMain = (l: EdLine) => prodInv && !!l.prod?.main;
  const nonEmpty = (l: EdLine) => !!(l.itemId || l.name.trim() || Number(l.price));
  /** A line with an article or a name — empty rows (and unnamed rows marked 🏭) are ignored, never block. */
  const named = (l: EdLine) => !!(l.itemId || l.name.trim());
  const setMode = (on: boolean) => setD((o) => {
    if (!on) {
      // back to a normal invoice: typed main products stay as lines marked „🏭“, empty ones go
      const L = o.lines.filter((l) => !(l.prod?.main && !nonEmpty(l)));
      return { ...o, data: { ...o.data, prodInv: '' }, lines: L.length ? L : [blankLine(p.revDefault, o.export ? '0' : '18')] };
    }
    const has = o.lines.some((l) => l.prod?.main);
    // production invoice: production is done in the main product cards above, the other lines are ordinary lines
    if (has) return { ...o, data: { ...o.data, prodInv: '1' }, lines: o.lines.map((l) => (l.prod && !l.prod.main ? { ...l, prod: undefined } : l)) };
    const rest = o.lines.filter(nonEmpty).map((l) => (l.prod ? { ...l, prod: undefined } : l));
    return { ...o, data: { ...o.data, prodInv: '1' }, lines: has ? o.lines : [mainProdLine(p.revByType.product || p.revDefault, o.warehouseId, o.export ? '0' : '18'), ...rest] };
  });
  const addMain = () => setD((o) => {
    const L = [...o.lines];
    const at = L.reduce((a, l, k) => (l.prod?.main ? k + 1 : a), 0);
    L.splice(at, 0, mainProdLine(p.revByType.product || p.revDefault, o.warehouseId, o.export ? '0' : '18'));
    return { ...o, lines: L };
  });
  /** Typing the main product's name links an existing finished product of the same name; another name = a new variant. */
  const setMainName = (i: number, v: string) => {
    const l = d.lines[i]!;
    const found = items.find((x) => x.type === 'product' && x.name.trim().toLowerCase() === v.trim().toLowerCase());
    if (found) setLine(i, { name: v, itemId: found.id, code: found.code ?? '', unit: l.unit || found.unit || 'ком', account: found.account || p.revByType.product || l.account, price: l.price || String(priceOf(found)) });
    else setLine(i, { name: v, ...(l.itemId ? { itemId: '', code: '' } : {}) });
  };
  const toggleProd = (i: number) => setD((o) => ({ ...o, lines: o.lines.map((l, k) => (k !== i ? l : l.prod ? { ...l, prod: undefined } : { ...l, prod: startProd(l, boms, o.warehouseId) })) }));
  const setProdOf = (i: number, pr: NonNullable<EdLine['prod']>) => setD((o) => ({ ...o, lines: o.lines.map((l, k) => (k === i ? { ...l, prod: pr } : l)) }));
  /** „+ Креирај производ“: the free-text line becomes the finished-product article (name, unit, VAT, price from the line). */
  const createProduct = async (i: number) => {
    const l = d.lines[i];
    if (!l) return;
    setCreating(i);
    try {
      const r = await createProductAction({ name: l.name.trim(), unit: l.unit, rate: Number(l.rate) || 0, price: l.price || '0' });
      if (r.error || !r.item) { setToast(r.error ?? 'Производот не е креиран.'); return; }
      const it = r.item;
      setNewItems((x) => [...x.filter((y) => y.id !== it.id), it]);
      setD((o) => ({ ...o, lines: o.lines.map((x, k) => (k !== i ? x : reProd({ ...x, itemId: it.id, code: it.code ?? '', unit: x.unit || it.unit || 'ком', account: it.account || p.revByType.product || x.account, prod: x.prod ?? startProd(x, boms, o.warehouseId) }, boms, true))) }));
      setToast(r.ok ?? '');
    } finally { setCreating(null); }
  };
  const dt: DtKey = d.kind === 'invoice' && d.svc ? 'service' : d.kind;
  const isInv = d.kind === 'invoice';
  const W = d.warehouseId || 'main';
  const stockOf = (id: string): number | undefined => { const t = itemById.get(id)?.type; return t && t !== 'service' ? p.stock[id]?.[W] ?? 0 : undefined; };
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const loc = p.locations.find((l) => l.id === d.warehouseId);
  const priceOf = (it: InvItemOpt) => (loc?.kind === 'store' && it.sp[W] != null ? Math.round((it.sp[W]! / (1 + it.rate / 100)) * 100) / 100 : it.price);
  const fromItem = (it: InvItemOpt): Partial<EdLine> => ({
    itemId: it.id, code: it.code ?? '', name: it.name, unit: it.unit || 'ком', price: String(priceOf(it)),
    rate: d.export ? '0' : String(it.rate), account: it.account || p.revByType[it.type] || p.revDefault,
  });

  const advRows = p.advances.filter((a) => !d.partnerId || a.partnerId === d.partnerId).map((a) => ({ ...a, rest: Math.round((a.base - a.used) * 100) / 100 }))
    .filter((a) => a.rest > 0.009 || d.advances.some((x) => x.advanceId === a.id && Number(x.amount)));
  const T = invoiceTotals({
    items: toItems(d.lines), art32: d.art32, advance: d.advance, credit: d.kind === 'credit',
    advances: d.advances.filter((x) => Number(x.amount)).map((x) => {
      const a = p.advances.find((y) => y.id === x.advanceId);
      return { amount: Number(x.amount), invoice: { id: x.advanceId, number: a?.number, items: toItems(a?.lines ?? []), art32: a?.art32 } };
    }),
  }, { nonVat: p.nonVat });
  const ref = p.refInvoices.find((r) => r.id === d.refInvoiceId);
  const cur = d.currency === 'MKD' ? 'ден.' : d.currency;
  const fxN = d.currency === 'MKD' ? 1 : Number(d.fx) || 0;

  // „🏭 производство“ per line: the produced lines, their live calculation and the invoice summary
  const prodLines = canProd ? d.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.prod && named(l) && (!prodInv || l.prod.main)) : [];
  const calcs = new Map(prodLines.filter(({ l }) => l.itemId && itemById.get(l.itemId)?.type !== 'service').map(({ l, i }) => [i, lineCalc(l, p.stock, avgs, fxN)]));
  const PS = prodSummary([...calcs.values()]);
  // production order of the saved invoice per line (orders follow the produced lines of the same product)
  const orderNo = (i: number) => {
    const l = d.lines[i]!;
    const same = prodLines.filter((x) => x.l.itemId === l.itemId).map((x) => x.i);
    return (p.prodRun?.orders ?? []).filter((o) => o.productId === l.itemId)[same.indexOf(i)]?.number ?? null;
  };
  /** Lines sent to the server: rows with nothing typed (no article, name or price) are dropped, never block. */
  const keepLine = (l: EdLine) => nonEmpty(l);
  /** The payload of the produced lines: `lineNo` = the line's index among the saved (non-empty) lines. */
  const woRef = prodInv && d.data.woNo?.trim() ? { number: d.data.woNo.trim(), from: d.data.woFrom || null, to: d.data.woTo || null } : null;
  const production = (() => {
    if (!prodLines.length) return null;
    const keep = d.lines.map(keepLine);
    const idx = (i: number) => keep.slice(0, i).filter(Boolean).length;
    return {
      wh: null, extra: '0', saveBom: false, mode: prodInv ? 'prodInv' as const : null, workOrder: woRef,
      lines: prodLines.filter(({ l }) => l.itemId && keep[d.lines.indexOf(l)]).map(({ l, i }) => {
        const main = !!l.prod!.main;
        const S = l.prod!.spec;
        return {
          lineNo: idx(i), productId: l.itemId, qty: l.qty, wh: l.prod!.wh || null, saveBom: l.prod!.saveBom,
          // a main product's extra cost (labour + other + overhead) is recomputed by the server on the issued materials
          extra: main ? String(calcs.get(i)?.extra ?? 0) : l.prod!.extra || '0',
          materials: l.prod!.materials.filter((m) => m.itemId && Number(m.qty) > 0),
          ...(main ? {
            main: true, calc: (({ hours, rate, labour, ovhPct, other }) => ({ hours, rate, labour, ovhPct, other: other.filter((o) => Number(o.amount)) }))(l.prod!.cost ?? blankCostEls()),
            spec: S ? { text: S.text, l: S.l, w: S.w, h: S.h, mode: S.mode, pcs: S.pcs } : null,
          } : {}),
        };
      }),
    };
  })();
  /** The invoice line of a main product carries its specification after the name. */
  const lineOut = (l: EdLine) => {
    if (!l.prod?.main || !canProd) return l;
    const t = specText(l.prod.spec ? { ...l.prod.spec } : null);
    return t && l.name.trim() ? { ...l, name: `${l.name.trim()} – ${t}` } : l;
  };

  const qaList = useMemo(() => {
    const q = qa.q.toLowerCase().trim();
    if (!q || qa.sel) return [];
    const ex = items.filter((i) => i.barcodes.includes(q) || (i.code ?? '').toLowerCase() === q);
    if (ex.length) return ex;
    return items.filter((i) => (i.code ?? '').toLowerCase().startsWith(q) || i.barcodes.some((b) => b.includes(q)) || i.name.toLowerCase().includes(q)).slice(0, 10);
  }, [qa.q, qa.sel, items]);
  const qaAdd = () => {
    const it = itemById.get(qa.sel);
    const q = Number(qa.qty.replace(',', '.')) || 0;
    if (!it) { setToast('Изберете артикл од листата.'); return; }
    if (!q) { setToast('Внесете количина.'); return; }
    const sq = stockOf(it.id);
    if (sq != null && d.kind !== 'proforma' && q > sq + 1e-9) setToast('Внимание: на залиха има само ' + fq(sq) + ' ' + (it.unit ?? ''));
    setD((o) => {
      const L = [...o.lines];
      const ex = L.findIndex((l) => l.itemId === it.id && !Number(l.disc) && !l.prod?.main);
      if (ex >= 0) L[ex] = { ...L[ex]!, qty: String(Math.round(((Number(L[ex]!.qty) || 0) + q) * 1e4) / 1e4) };
      else {
        const row = { ...blankLine(p.revDefault), ...fromItem(it), qty: String(q) } as EdLine;
        const e0 = L.findIndex((l) => !l.prod && !l.itemId && !l.name.trim() && !Number(l.price));
        if (e0 >= 0) L[e0] = row; else L.push(row);
      }
      return { ...o, lines: L };
    });
    setQa({ q: '', sel: '', qty: '1', i: 0 });
    setTimeout(() => qaRef.current?.focus(), 20);
  };
  // legacy `addSvc` (14304): a free-text service row, unit „усл.“, the service revenue konto
  const addSvc = () => setD((o) => {
    const row: EdLine = { ...blankLine(p.revByType.service || p.revDefault, o.export ? '0' : '18'), unit: 'усл.' };
    const L = [...o.lines];
    const e0 = L.findIndex((l) => !l.prod && !l.itemId && !l.name.trim() && !Number(l.price));
    if (e0 >= 0) L[e0] = { ...row, qty: L[e0]!.qty || '1' }; else L.push(row);
    return { ...o, lines: L };
  });
  // legacy `crQty` / `crRest` (8726–8729): what is left to credit on the referenced invoice
  const crRest = (r: RefInvoice) => Math.round((r.total - (r.others?.total ?? 0)) * 100) / 100;
  const crCopy = (r: RefInvoice, kind = d.creditKind) => {
    const base = { partnerId: r.partnerId ?? d.partnerId, art32: r.art32, export: r.export };
    if (kind === 'gross') { applyGross(r, d.creditGross); set(base); return; }
    const lines = r.lines.map((l) => ({ ...l, qty: kind === 'ret' && l.itemId ? String(Math.max(0, Math.min(Number(l.qty) || 0, (Number(l.qty) || 0) - (r.others?.returned[l.itemId] ?? 0)))) : l.qty }))
      .filter((l) => kind !== 'ret' || Number(l.qty));
    set({ ...base, lines });
    setToast(kind === 'ret' ? 'Копирани се ставките – оставете ја количината што се враќа.' : 'Копирани се ставките – сменете ја цената/количината на износот на попустот.');
  };
  const applyGross = (r: RefInvoice, g: string) => set({ lines: Number(g) ? creditGrossLines({ number: r.number, items: toItems(r.lines), art32: r.art32 }, Number(g) || 0).map((l) => ({ ...blankLine(String(l.konto)), name: String(l.name), unit: '', qty: '1', price: String(l.price), rate: String(l.rate) })) : [] });
  /** legacy `saveInv` confirm chain (7017 → 14359): fuel VAT, stock shortage, lines without an item, art. 32-a buyer. */
  const beforeSave = (e: React.FormEvent<HTMLFormElement>) => {
    const NL = '\n';
    // a draft is not booked: no stock / VAT / production checks until „Зачувај и прокнижи“
    if (((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.name === 'asDraft') return;
    const noName = d.lines.findIndex((l) => !named(l) && Number(l.price));
    if (noName >= 0) { e.preventDefault(); setToast(`Редот ${noName + 1} има цена, но нема назив ни артикл – внесете назив или избришете го редот (✕).`); return; }
    if (!d.export && !d.art32 && !d.data.fuelOk) {
      const m = fuelInvoiceCheck(d.lines, d.pdate || d.date, p.fuelRule ?? null, 'Фактура');
      if (m) {
        if (window.confirm(m.text + NL + NL + `Да се поправи автоматски на ${m.rate}%? (Откажи = Зачувај како што е)`)) {
          e.preventDefault();
          set({ lines: d.lines.map((l, i) => (m.bad.includes(i) ? { ...l, rate: String(m.rate) } : l)) });
          setToast('ДДВ за горивото е поправен на ' + m.rate + '%.');
          setTimeout(() => formRef.current?.requestSubmit(), 50);
          return;
        }
        setD((o) => ({ ...o, data: { ...o.data, fuelOk: '1' } }));
      }
    }
    if (prodInv && !d.lines.some((l) => l.prod?.main && named(l)) && !window.confirm('Фактурата е „🏭 од производство“, но нема внесено главен производ. Сепак да се зачува како обична фактура?')) { e.preventDefault(); return; }
    const used = prodLines;
    if (canProd && used.length) {
      const bad = used.filter(({ l }) => !l.itemId || itemById.get(l.itemId)?.type === 'service');
      if (bad.length) {
        e.preventDefault();
        const b = bad[0]!.l;
        setToast(b.prod?.main
          ? 'Главниот производ „' + (b.name || '…') + '“ уште не е креиран – притиснете „✓ Креирај го производот“ (се креира веднаш, без шифрарник).'
          : 'Ставката „' + (b.name || '…') + '“ е означена за производство, а не е производ од шифрарникот – притиснете „+ Креирај производ“ под ставката или исклучете го 🏭.');
        return;
      }
      const empty = used.filter(({ l, i }) => !l.prod!.materials.some((m) => m.itemId && Number(m.qty) > 0) && !((calcs.get(i)?.extra ?? 0) > 0));
      if (empty.length && !window.confirm('Овие ставки се означени за производство, но немаат ни репроматеријали ни трошоци – ќе се продадат од залиха без производство:' + NL + empty.map(({ l }) => l.name).join(NL) + NL + NL + 'Сепак да се зачува?')) { e.preventDefault(); return; }
      // warnings, never blocks: materials short at the date (the calculation keeps a note) and selling below cost
      const short = used.filter(({ i }) => calcs.get(i)?.short);
      if (short.length && !window.confirm('⚠ Недостига репроматеријал на залиха за:' + NL + short.map(({ l }) => l.name).join(NL) + NL + NL + 'Материјалите ќе се раздолжат во минус (проверете ги приемите); на калкулацијата ќе стои напомена. Сепак да се зачува?')) { e.preventDefault(); return; }
      if (PS.below && !window.confirm(`⚠ ${PS.below} ставки за производство се продаваат под цената на чинење (вкупно трошок ${fmt(PS.cost)}, продажба ${fmt(PS.sale)}). Сепак да се зачува?`)) { e.preventDefault(); return; }
    }
    if ((d.kind === 'invoice' || d.kind === 'dispatch') && !d.fromDocId) {
      const need = new Map<string, number>();
      // a produced line is received on stock by its production order before the invoice issues it
      // (main products of a production invoice: their stock 0 is no shortage — they are being produced now)
      d.lines.forEach((l, i) => {
        const produced = canProd && !!l.prod && (l.prod.materials.some((m) => m.itemId && Number(m.qty) > 0) || (calcs.get(i)?.extra ?? 0) > 0 || !!l.prod.main);
        if (l.itemId && stockOf(l.itemId) != null && itemById.get(l.itemId)?.type !== 'material' && !produced) need.set(l.itemId, (need.get(l.itemId) ?? 0) + (Number(l.qty) || 0));
      });
      const short = [...need].filter(([id, q]) => q > (stockOf(id) ?? 0) + 1e-9).map(([id, q]) => `${itemById.get(id)!.name}: се бара ${fq(q)}, на залиха ${fq(stockOf(id) ?? 0)} ${itemById.get(id)!.unit ?? ''}`);
      if (short.length && !window.confirm('Нема доволно залиха во ' + (loc?.name ?? 'Главен магацин') + ':' + NL + short.slice(0, 8).join(NL) + NL + NL + 'Според законот не може да се продаде повеќе отколку што е примено. Проверете дали влезната фактура/преносот е заведен. Сепак да се зачува?')) { e.preventDefault(); return; }
      const free = d.lines.filter((l) => !l.itemId && l.name.trim() && Number(l.qty) && !/услуг|транспорт|превоз|трошок|надомест/i.test(l.name)).map((l) => l.name);
      if (free.length && !svcMode && !window.confirm('Овие ставки не се поврзани со артикл од шифрарникот и НЕМА да ја намалат залихата:' + NL + free.slice(0, 8).join(NL) + NL + NL + 'Изберете го артиклот од листата (шифра/назив) за да се раздолжи залихата. Сепак да се зачува?')) { e.preventDefault(); return; }
    }
    if (d.kind === 'credit' && d.creditKind === 'ret') {
      const free = d.lines.filter((l) => !l.itemId && l.name.trim() && Number(l.qty)).map((l) => l.name);
      if (free.length && !window.confirm('Овие ставки не се поврзани со артикл и НЕМА да се вратат на залиха:' + NL + free.join(NL) + NL + NL + 'Сепак да се зачува?')) { e.preventDefault(); return; }
    }
    if (d.art32 && d.partnerId && (p.nonVatPartners ?? []).includes(d.partnerId)) setToast('Внимание: член 32-а важи само кога купувачот е ДДВ обврзник.');
  };

  const I = (k: string, l: string, o: { b?: boolean; type?: string; list?: string; w?: number } = {}) => (
    <label className={'fl' + (o.b ? ' b' : '')}><span>{l}</span>
      <input value={d.data[k] ?? ''} type={o.type} list={o.list} style={o.w ? { maxWidth: o.w } : undefined} onChange={(e) => setData(k, e.target.value)} /></label>
  );
  const RB = (k: string, opts: [string, string][], def: string) => opts.map(([v, n]) => (
    <label key={v} className="rb"><input type="radio" checked={(d.data[k] ?? def) === v} onChange={() => setData(k, v)} /> {n}</label>
  ));
  const pOpts = <>{<option value="">— избери —</option>}{p.partners.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name}</option>)}</>;
  const saveLbl = d.kind === 'proforma' ? 'Зачувај' : d.kind === 'dispatch' ? 'Зачувај и раздолжи залиха' : 'Зачувај и прокнижи';
  /** An unbooked draft invoice (not a cancelled one — the page marks those `cancelled`). */
  const isDraftDoc = isInv && d.status === 'draft';
  /** New invoice, nothing entered yet: only the header and „Креирај фактура“ (the draft then opens with the lines). */
  const headerStage = isInv && !d.id && !direct && p.initial.scanDocId == null && !d.fromDocId && !p.initial.lines.some((l) => !l.prod?.main && nonEmpty(l));
  const canDraft = isInv && (!d.id || isDraftDoc) && p.initial.scanDocId == null;

  // ── „Заглавие“ → „Ставки“ ──────────────────────────────────────────────────────────────────────────────────
  const partnerOf = p.partners.find((x) => x.id === d.partnerId);
  // soft hint (never blocking, never on the print): a legal-entity buyer without ЕДБ / address on a document with VAT
  const hasVat = !p.nonVat && !d.export && d.kind !== 'dispatch' && (!d.lines.some(nonEmpty) || d.lines.some((l) => nonEmpty(l) && Number(l.rate) > 0));
  const hint = buyerHint(partnerOf, hasVat);
  /** Focus a field of grid row `row` (`f` = name | qty | price | disc); no scrolling — the lines are already in view. */
  const focusField = (row: number, f: string) => {
    const el = linesRef.current?.querySelector<HTMLInputElement>(`[data-row="${row}"] [data-f="${f}"]`);
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (f !== 'name') el.select?.();
    return true;
  };
  useEffect(() => {
    const t = focusRow.current;
    if (!t) return;
    focusRow.current = null;
    // the summary line goes to the top of the window, the lines right under it (the page never jumps to the bottom)
    if (t.scroll) sumRef.current?.scrollIntoView?.({ block: 'start' });
    if (t.row === -2) {
      const r = firstEmptyRow(d.lines);
      if (!(prodInv && d.lines.some((l) => l.prod?.main && !nonEmpty(l))) && r >= 0) { focusField(r, t.f); return; }
      if (!prodInv) return;
    }
    if (t.row < 0) linesRef.current?.querySelector<HTMLInputElement>('[data-testid="main-products"] input')?.focus({ preventScroll: true });
    else focusField(t.row, t.f);
  });
  /** „Понатаму → Ставки“: partner and date are required; the header folds, the first empty line gets the cursor. */
  const goLines = () => {
    const m = headerMissing(d);
    if (m.length) { setHeadErr(headerMissingText(m)); return; }
    setHeadErr('');
    setHeadOpen(false);
    if (headerStage) setDirect(true);
    if (prodInv && d.lines.some((l) => l.prod?.main && !nonEmpty(l))) { focusRow.current = { row: -1, f: 'name', scroll: true }; return; }
    let r = firstEmptyRow(d.lines);
    if (r < 0) { r = d.lines.length; set({ lines: [...d.lines, blankLine(p.revDefault, d.export ? '0' : '18')] }); }
    focusRow.current = { row: r, f: 'name', scroll: true };
  };
  /** Enter in a header field (not the new-nalog box, not a button / the note) = „Понатаму“ instead of sending the form. */
  const headKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (!(t.tagName === 'INPUT' || t.tagName === 'SELECT') || t.closest('[data-testid="new-nalog"]')) return;
    if (t.tagName === 'INPUT' && ['button', 'submit', 'reset', 'file'].includes((t as HTMLInputElement).type)) return;
    e.preventDefault();
    goLines();
  };
  /** Keyboard-first lines: Enter = article → quantity → price → the next empty row (added when there is none). */
  const lineKey = (i: number, f: 'name' | 'qty' | 'price' | 'disc') => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    if (f === 'name') { focusField(i, 'qty'); return; }
    if (f === 'qty') { focusField(i, 'price'); return; }
    const l = d.lines[i];
    if (!l || !nonEmpty(l)) return;
    const r = firstEmptyRow(d.lines, i + 1);
    if (r >= 0) { focusField(r, 'name'); return; }
    focusRow.current = { row: d.lines.length, f: 'name' };
    set({ lines: [...d.lines, blankLine(p.revDefault, d.export ? '0' : '18')] });
  };
  // „Налог за книжење“: nalozi of the invoice's year whose period (or, without one, whose months) cover the date
  const ym = d.date.slice(0, 7);
  const nalOpts = nalozi.filter((n) => n.number === (d.data.nalogNo ?? '') || (n.from.slice(0, 4) === d.date.slice(0, 4) && (n.periodFrom || n.periodTo
    ? (!n.periodFrom || d.date >= n.periodFrom) && (!n.periodTo || d.date <= n.periodTo)
    : n.from.slice(0, 7) <= ym && ym <= n.to.slice(0, 7)))).sort((a, b) => Number(b.collective) - Number(a.collective) || a.number.localeCompare(b.number, 'mk', { numeric: true }));
  const nalSel = newNal ? '__new' : d.data.nalogNo ?? '';
  const monthEnd = (x: string) => { const [y, m] = x.split('-').map(Number) as [number, number]; return `${x.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  const createNalog = async () => {
    if (!newNal) return;
    setNalBusy(true);
    try {
      const r = await createInvoiceNalogAction({ number: newNal.number, date: newNal.date, description: newNal.description, periodFrom: newNal.from, periodTo: newNal.to });
      if (r.error || !r.nalog) { setToast(r.error ?? 'Налогот не е креиран.'); return; }
      const n = r.nalog;
      setNalozi((L) => [...L.filter((x) => x.number !== n.number), { number: n.number, description: n.description, from: n.date, to: n.date, periodFrom: n.periodFrom, periodTo: n.periodTo, invoices: 0, collective: true }]);
      setData('nalogNo', n.number);
      setNewNal(null);
      setToast(r.ok ?? '');
    } finally { setNalBusy(false); }
  };

  return (
    <form action={action} ref={formRef} onSubmit={beforeSave}>
      <input type="hidden" name="payload" value={JSON.stringify({
        ...d, number: headerStage ? '' : d.number, back: p.back, lines: d.lines.filter(keepLine).map((x) => { const { prod: _p, ...l } = lineOut(x); return l; }), production,
        data: isInv ? { ...d.data, prod: production ? 'Д' : 'Н', prodCost: production ? PS.cost.toFixed(2) : '', prodInv: prodInv ? '1' : '', ...(prodInv ? {} : { woNo: '', woFrom: '', woTo: '' }) } : d.data,
      })} />
      <div className="hd">
        <h1>{p.title}{p.sub && <span className="mk">{p.sub}</span>}</h1>
        <div className="row"><Link className="btn" href={p.back}>Откажи</Link>
          {headerStage
            ? <button className="btn pri" name="asDraft" value="1" disabled={pending} data-testid="create-draft">Креирај фактура →</button>
            : <><button className="btn pri" disabled={pending}>{saveLbl}</button>
              {canDraft && <button className="btn" name="asDraft" value="1" disabled={pending} title="Се чува без книжење (нема налог, ДДВ ни залиха); бројот се доделува при книжење">💾 Зачувај нацрт</button>}</>}</div>
      </div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {toast && <div className="callout info" role="status" onClick={() => setToast('')}>{toast}</div>}
      {p.scanInfo && <div className="callout good">{p.scanInfo}</div>}
      {d.status === 'pending' && <div className="callout warn">Внесено од клиентот – чека одобрување (не е прокнижено).</div>}
      {p.drafted != null && <div className="callout good" role="status">Фактурата е креирана како <b>нацрт</b>. Сега внесете ги {prodInv ? <>главните производи и калкулацијата, па другите ставки</> : <>ставките</>} и на крајот „Зачувај и прокнижи“.
        {p.drafted && <>{p.drafted.split(' | ').map((w, k) => <span key={k}><br />⚠ {w}</span>)}</>}</div>}
      {isDraftDoc && <div className="callout info" data-testid="draft-note">✎ <b>Нацрт</b> – не е издадена и не е прокнижена: нема налог, ДДВ ни движење на залиха. Бројот од серијата се доделува при книжење{p.nextNumber ? <> (следен: <b>{p.nextNumber}</b>)</> : null}, па бришењето на нацрт не остава прескокнат број.</div>}
      {headerStage && <div className="callout info" data-testid="header-stage">Прво заглавието: вид на фактура, купувач, датуми, валута/курс, налог{prodInv ? ', работен налог' : ''}. Со <b>„Креирај фактура“</b> се зачувува како нацрт (без книжење) и се отвора за ставките{prodInv ? ', главниот производ и калкулацијата' : ''}.{' '}
        <button type="button" className="btn sm ghost" onClick={() => setDirect(true)}>или внеси ги ставките веднаш</button></div>}
      <div ref={headRef} hidden={!headOpen} data-testid="header-step" onKeyDown={headKey} style={{ scrollMarginTop: 64 }}>
      {canProd && !d.svc && <div className="card invmode" data-testid="inv-mode" role="radiogroup" aria-label="Вид на фактура" style={{ padding: '8px 12px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>Вид на фактура:</b>
        <label className="rb"><input type="radio" name="invMode" checked={!prodInv} onChange={() => setMode(false)} /> 📄 Обична фактура</label>
        <label className="rb"><input type="radio" name="invMode" checked={prodInv} onChange={() => setMode(true)} /> <b>🏭 Фактура од производство</b></label>
        <small className="note" style={{ flex: '1 1 280px' }}>{prodInv
          ? 'Прво заглавието (комитент, датуми, курс, работен налог), потоа главниот производ и калкулацијата на производство. При зачувување: налог за производство, раздолжување на материјалите, прием на производот по цена на чинење и продажба.'
          : 'За нарачки по мерка (пр. тераса, пергола) изберете „🏭 Фактура од производство“. Кај обична фактура, поединечна ставка може да се означи со „🏭 Производство“.'}</small>
      </div>}
      <div className="card invhead">
        <div className="ftabs" role="tablist">
          {([['osn', 'Основно'], ['dop', 'Дополнителни'], ['pos', 'Посебни']] as const).map(([id, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{n}{id === 'pos' && (d.art32 || d.advance || d.advances.length) ? ' •' : ''}</button>
          ))}
          {d.art32 && <span className="pill info" style={{ marginLeft: 'auto', alignSelf: 'center' }}>член 32-а</span>}
          {d.advance && <span className="pill warn" style={{ alignSelf: 'center' }}>авансна</span>}
          {d.export && <span className="pill" style={{ alignSelf: 'center' }}>извозна</span>}
        </div>
        <div className="fpane" hidden={tab !== 'osn'}>
          <div className="igrid">
            <div className="fcol">
              <label className="fl b"><span>{d.kind === 'proforma' ? 'Профактура бр.' : d.kind === 'dispatch' ? 'Испратница бр.' : 'Калкулација / фактура бр.'}</span><input value={headerStage ? '' : d.number} disabled={headerStage} aria-label="Број на документ"
                placeholder={isInv && (headerStage || isDraftDoc) ? `при книжење${p.nextNumber ? ' (следен: ' + p.nextNumber + ')' : ''}` : undefined} onChange={(e) => set({ number: e.target.value })} /></label>
              {I('oe', 'Орг. ед. (ОЕ)', { w: 120 })}
              {(d.kind === 'invoice' || d.kind === 'credit') ? <>
                <label className="fl"><span>Налог за книжење</span><select value={nalSel} aria-label="Налог за книжење" data-testid="nalog-select" onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__new') { setNewNal({ number: p.nextNalog ?? '', date: d.date, description: `Излезни фактури ${d.date.slice(5, 7)}/${d.date.slice(0, 4)}`, from: `${d.date.slice(0, 7)}-01`, to: monthEnd(d.date) }); return; }
                  setNewNal(null); setData('nalogNo', v);
                }}>
                  <option value="">Нов налог (автоматски број)</option>
                  {nalOpts.map((n) => <option key={n.number} value={n.number}>бр. {n.number}{n.description ? ' · ' + n.description : ''}{n.invoices ? ` · ${n.invoices} док.` : ''}</option>)}
                  <option value="__new">+ Креирај налог…</option>
                </select></label>
                {p.nalogNo && <small className="note">Прокнижено во налог бр. <Link href={`/nalozi?n=${encodeURIComponent(p.nalogNo)}`}>{p.nalogNo}</Link>{d.data.nalogNo && d.data.nalogNo !== p.nalogNo ? <> → при зачувување се префрла во бр. <b>{d.data.nalogNo}</b></> : null}</small>}
                {newNal && <fieldset className="fs" data-testid="new-nalog"><legend>Нов налог за книжење (збирен)</legend>
                  <label className="fl"><span>Број</span><input value={newNal.number} aria-label="Број на налог" onChange={(e) => setNewNal({ ...newNal, number: e.target.value })} /></label>
                  <label className="fl"><span>Датум</span><input type="date" value={newNal.date} aria-label="Датум на налог" onChange={(e) => setNewNal({ ...newNal, date: e.target.value })} /></label>
                  <label className="fl"><span>Опис</span><input value={newNal.description} aria-label="Опис на налог" onChange={(e) => setNewNal({ ...newNal, description: e.target.value })} /></label>
                  <label className="fl"><span>Период од – до</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input type="date" value={newNal.from} aria-label="Налог период од" onChange={(e) => setNewNal({ ...newNal, from: e.target.value })} />
                    <input type="date" value={newNal.to} aria-label="Налог период до" onChange={(e) => setNewNal({ ...newNal, to: e.target.value })} /></div></label>
                  <div className="row" style={{ gap: 8 }}><button type="button" className="btn sm pri" disabled={nalBusy} onClick={() => void createNalog()}>{nalBusy ? 'Се креира…' : 'Креирај налог'}</button>
                    <button type="button" className="btn sm ghost" onClick={() => setNewNal(null)}>Откажи</button></div>
                  <small className="note">Во истиот налог може да се книжат повеќе фактури од периодот; секоја фактура си ги чува своите ставки во налогот.</small>
                </fieldset>}
              </> : <label className="fl"><span>Налог</span><input value={p.nalogNo ? 'бр. ' + p.nalogNo : 'се доделува при зачувување'} disabled /></label>}
              <label className="fl b"><span>Комитент</span><select value={d.partnerId} onChange={(e) => set({ partnerId: e.target.value, ...(d.kind === 'credit' ? { refInvoiceId: '' } : {}) })}>{pOpts}</select></label>
              <label className="fl"><span>Комитент носител</span><select value={d.data.payerId ?? ''} onChange={(e) => setData('payerId', e.target.value)}>{pOpts}</select></label>
              <label className="fl b"><span>Датум</span><input type="date" value={d.date} onChange={(e) => { set({ date: e.target.value, ...(d.data.days ? { due: addDays(e.target.value, d.data.days) } : {}) }); if (fxSrc && !d.pdate) autoFx(d.currency, e.target.value); }} /></label>
              {d.kind !== 'dispatch' && <label className="fl"><span>{d.kind === 'proforma' ? 'Важи до' : 'Валута (рок на плаќање)'}</span><input type="date" value={d.due} onChange={(e) => set({ due: e.target.value })} /></label>}
              {d.kind !== 'dispatch' && (
                <label className="fl"><span>Рок за наплата</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="number" min={0} value={d.data.days ?? ''} style={{ maxWidth: 90 }} onChange={(e) => setD((o) => ({ ...o, data: { ...o.data, days: e.target.value }, due: e.target.value !== '' ? addDays(o.date, e.target.value) : o.due }))} />
                  <small className="note">дена од датумот</small></div></label>
              )}
              {I('refDoc', 'По документ (бр. нарачка / ф-ра)', { b: true })}
              {isInv && <label className="fl"><span>Дат. на испорака (промет)</span><input type="date" value={d.pdate || d.date} onChange={(e) => set({ pdate: e.target.value })} /></label>}
              {prodInv && <WorkOrderBox data={d.data} date={d.date} list={p.workOrders ?? []} next={p.nextWorkOrder ?? ''} onChange={(x) => setD((o) => ({ ...o, data: { ...o.data, ...x } }))} />}
              {I('dispNo', 'Испратница бр.')}{I('archNo', 'Архивски број')}
              {d.kind === 'credit' && <>
                <label className="fl b"><span>Кон фактура</span><select value={d.refInvoiceId} onChange={(e) => {
                  const r = p.refInvoices.find((x) => x.id === e.target.value);
                  set({ refInvoiceId: e.target.value, ...(r ? { partnerId: r.partnerId ?? d.partnerId, art32: r.art32, export: r.export } : {}) });
                }}><option value="">— избери —</option>{p.refInvoices.filter((r) => !d.partnerId || r.partnerId === d.partnerId).map((r) => <option key={r.id} value={r.id}>{r.number} · {r.date.split('-').reverse().join('.')} · {fmt(crRest(r))}</option>)}</select></label>
                <label className="fl b"><span>Вид на одобрение</span><select value={d.creditKind} onChange={(e) => { const k = e.target.value as EdInvoice['creditKind']; set({ creditKind: k }); if (ref && k !== 'price') crCopy(ref, k); }}>
                  <option value="price">Одобрение по ставки (цена/количина за секој артикл)</option>
                  <option value="gross">Одобрение со еден бруто износ (се дели по ДДВ стапки)</option>
                  <option value="ret">Повратница – купувачот ја враќа стоката (се враќа на залиха)</option></select></label>
                {d.creditKind === 'gross' && <label className="fl b"><span>Бруто износ (со ДДВ)</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="number" step="0.01" min={0} value={d.creditGross} onChange={(e) => { set({ creditGross: e.target.value }); if (ref) applyGross(ref, e.target.value); }} placeholder="на пр. 5000" />
                  <button type="button" className="btn sm" disabled={!ref} onClick={() => ref && set({ lines: creditGrossLines({ number: ref.number, items: toItems(ref.lines), art32: ref.art32 }, Number(d.creditGross) || 0).map((l) => ({ ...blankLine(String(l.konto)), name: String(l.name), unit: '', qty: '1', price: String(l.price), rate: String(l.rate) })) })}>Подели по стапки</button></div></label>}
                {ref && <label className="fl"><span></span><button type="button" className="btn sm" onClick={() => crCopy(ref)}>⤵ Копирај ги ставките од фактурата</button></label>}
                {ref && <div className="mini" style={{ padding: '6px 8px', borderRadius: 6, background: T.total > crRest(ref) + 0.5 ? '#fde8e8' : 'var(--accent-soft)' }}>Фактура {ref.number}: {fmt(ref.total)}{ref.others?.numbers.length ? ` · претходни одобренија (${ref.others.numbers.join(', ')}): ${fmt(ref.others.total)}` : ''} · <b>може да се одобри уште: {fmt(crRest(ref))}</b>{T.total > crRest(ref) + 0.5 ? ` · ⚠ ова одобрение (${fmt(T.total)}) е поголемо` : ''}</div>}
              </>}
            </div>
            <div className="fcol">
              {(d.kind === 'invoice' || d.kind === 'dispatch') && p.locations.length > 0 && (
                <fieldset className="fs"><legend>Крајна дестинација (излез од)</legend>
                  <label className="fl"><span>Магацин / продавница</span><select value={d.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}><option value="">01 Главен магацин</option>{p.locations.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
                </fieldset>
              )}
              <fieldset className="fs"><legend>Тип</legend><div className="row">
                <label className="rb"><input type="radio" checked={!d.export} onChange={() => set({ export: false })} /> Денарска</label>
                <label className="rb"><input type="radio" checked={d.export} onChange={() => set({ export: true, lines: d.lines.map((l) => ({ ...l, rate: '0' })) })} /> Извозна</label>
              </div>{d.export && <small className="note">Извоз: ДДВ 0%, оди во поле 07 на ДДВ-04.</small>}</fieldset>
              {I('priceList', 'Ценовник')}
              <div className="fl"><span>Валута / курс</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                <select value={d.currency} style={{ maxWidth: 90 }} onChange={(e) => { set({ currency: e.target.value, ...(e.target.value === 'MKD' ? { fx: '1' } : {}) }); autoFx(e.target.value, d.pdate || d.date); }}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                <input type="number" step="any" value={d.fx} style={{ maxWidth: 110 }} aria-label="Курс" disabled={d.currency === 'MKD'} onChange={(e) => { set({ fx: e.target.value }); setFxSrc(null); }} />
              </div>{fxSrc && d.currency !== 'MKD' && <small className="mini">{fxSrc}</small>}</div>
              {d.currency !== 'MKD' && <small className="note">Цените се во {d.currency}; се книжи во денари по курс {d.fx}, а на побарувањето се води и девизниот износ.</small>}
              {I('icd', 'ИЦД (царинска декларација)')}{I('decl', 'Вид декларација')}{I('distrib', 'Дистрибутер')}
              <div className="fl"><span>Генерален рабат %</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="number" step="any" value={d.data.gdisc ?? ''} style={{ maxWidth: 90 }} onChange={(e) => setData('gdisc', e.target.value)} />
                <button type="button" className="btn sm" onClick={() => set({ lines: d.lines.map((l) => ({ ...l, disc: d.data.gdisc ?? '' })) })}>Примени на сите редови</button></div></div>
              <label className="fl"><span>Начин на плаќање</span><select value={d.data.payMethod ?? 'Вирман'} onChange={(e) => setData('payMethod', e.target.value)}>{PAYM.map((x) => <option key={x}>{x}</option>)}</select></label>
              {I('salePlace', 'Продажно место')}{I('city', 'Град')}
              <div className="fl"><span>Раб. налог / приоритет</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                <input value={d.data.workOrder ?? ''} onChange={(e) => setData('workOrder', e.target.value)} />
                <input value={d.data.prio ?? ''} style={{ maxWidth: 70 }} aria-label="Приоритет" onChange={(e) => setData('prio', e.target.value)} /></div></div>
              {I('attachNote', 'Прилог')}
              <div className="row" style={{ gap: 18 }}>
                <fieldset className="fs" style={{ flex: 1 }}><legend>Салдо</legend><div className="row">{RB('saldo', [['Д', 'Да'], ['Н', 'Не']], 'Н')}</div></fieldset>
                {isInv && <fieldset className="fs" style={{ flex: 1 }}><legend>Производство</legend>
                  <small className="note">{prodInv ? <>🏭 Фактура од производство: главните производи и калкулацијата се внесуваат горе, во документот{prodLines.length ? <> · трошок {fmt(PS.cost)}</> : null}.</>
                    : prodLines.length ? <>🏭 {prodLines.length} ставки се произведуваат · трошок {fmt(PS.cost)}</> : <>Кликнете <b>„🏭 Производство“</b> на крајот од ставката (до ✕) што се произведува.</>}</small></fieldset>}
              </div>
              {isInv && p.prodRun?.orders.map((o) => <Link key={o.id} className="btn sm" href="/prod">🏭 Налог за производство бр. {o.number}</Link>)}
            </div>
          </div>
          <label className="f" style={{ marginTop: 8 }}>Напомена<textarea rows={3} value={d.note} data-testid="header-note" onChange={(e) => set({ note: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); goLines(); } }} /></label>
        </div>
        <div className="fpane" hidden={tab !== 'dop'}>
          <div className="igrid">
            <div className="fcol">
              <fieldset className="fs"><legend>Параметри за финансово книжење</legend>{I('grp1', 'Група 1')}{I('grp2', 'Група 2')}
                <label className="fl"><span>Тип на трошок</span><select value={d.data.costType ?? ''} onChange={(e) => setData('costType', e.target.value)}>{['', 'Материјален', 'Нематеријален', 'Транспорт', 'Услуга'].map((x) => <option key={x} value={x}>{x || '—'}</option>)}</select></label></fieldset>
              <fieldset className="fs"><legend>Дестинација</legend>{I('placeFrom', 'Место од')}{I('placeTo', 'Место до')}</fieldset>
              <div className="row" style={{ gap: 18 }}>
                <fieldset className="fs" style={{ flex: 1 }}><legend>Купувам домашно</legend><div className="row">{RB('domestic', [['Н', 'Не'], ['Д', 'Да']], 'Н')}</div></fieldset>
                <fieldset className="fs" style={{ flex: 1 }}><legend>Репро зависност</legend>{RB('repro', [['nedef', 'Недефинирано'], ['zav', 'Зависни'], ['nezav', 'Независни']], 'nedef')}</fieldset>
              </div>
              <fieldset className="fs"><legend>Паритет и услови за плаќање</legend>
                <label className="fl"><span>Паритет</span><select value={d.data.parity ?? ''} onChange={(e) => setData('parity', e.target.value)}>{PARITY.map((x) => <option key={x} value={x}>{x || '—'}</option>)}</select></label>
                <datalist id="ptList">{PTERMS.map((x) => <option key={x} value={x} />)}</datalist>
                {I('pay1', 'Услови за плаќање 1', { list: 'ptList' })}{I('pay2', 'Услови за плаќање 2', { list: 'ptList' })}{I('pay3', 'Услови за плаќање 3', { list: 'ptList' })}
              </fieldset>
            </div>
            <div className="fcol"><fieldset className="fs"><legend>Товарен лист</legend>
              <label className="fl"><span>Превозник</span><select value={d.data.carrierId ?? ''} onChange={(e) => setData('carrierId', e.target.value)}>{pOpts}</select></label>
              <datalist id="vehList">{(p.vehicles ?? []).map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}</datalist>
              <datalist id="drvList">{(p.drivers ?? []).map((n) => <option key={n} value={n} />)}</datalist>
              {I('vehicle', 'Возило', { list: 'vehList' })}{I('trailer', 'Приколка')}{I('driver', 'Шофер', { list: 'drvList' })}
              <label className="fl"><span>Дата на утовар</span><input type="date" value={d.data.loadDate || d.date} onChange={(e) => setData('loadDate', e.target.value)} /></label>
              <label className="fl"><span>Место на утовар</span><input value={d.data.loadPlace ?? ''} placeholder={p.firmAddress ?? ''} onChange={(e) => setData('loadPlace', e.target.value)} /></label>
              {I('unloadDate', 'Дата на истовар', { type: 'date' })}{I('dAddr', 'Место на истовар')}
            </fieldset></div>
          </div>
        </div>
        <div className="fpane" hidden={tab !== 'pos'}>
          {d.kind !== 'dispatch' && <label className="chk"><input type="checkbox" checked={d.art32} onChange={(e) => set({ art32: e.target.checked, lines: e.target.checked ? d.lines.map((l) => ({ ...l, rate: '18' })) : d.lines })} /> Фактура по <b>член 32-а</b> без ДДВ (градежништво — пренесување на даночна обврска)</label>}
          {d.art32 && <div className="callout">Без ДДВ за плаќање; ДДВ 18% ({fmt(T.transferredVat)}) се прикажува како пренесен.</div>}
          {isInv && <>
            <fieldset className="fs" style={{ maxWidth: 420 }}><legend>Изберете тип</legend><div className="row">
              <label className="rb"><input type="radio" checked={!d.advance} onChange={() => set({ advance: false })} /> Редовна</label>
              <label className="rb"><input type="radio" checked={d.advance} onChange={() => set({ advance: true, advances: [] })} /> Авансна</label>
            </div></fieldset>
            {d.advance
              ? <div className="callout">Авансна фактура: основицата се книжи на <b>{p.advanceKonto} Примени аванси</b>, ДДВ се пресметува веднаш. Подоцна, во конечната фактура на истиот купувач, авансот се одбива во оваа картичка.</div>
              : <><h3 className="fh">Одбивање аванси</h3>
                {advRows.length ? <div className="tw"><table><thead><tr><th>Број на калкулација</th><th>Документ</th><th className="n">Износ (основица)</th><th className="n">Реализиран вк.</th><th className="n">Остаток</th><th className="n">Одбиј сега</th></tr></thead><tbody>
                  {advRows.map((a) => {
                    const v = d.advances.find((x) => x.advanceId === a.id)?.amount ?? '';
                    const setV = (val: string) => set({ advances: [...d.advances.filter((x) => x.advanceId !== a.id), { advanceId: a.id, amount: val }] });
                    return <tr key={a.id}><td>{a.number}</td><td>Авансна ф-ра · {a.date.split('-').reverse().join('.')}</td><td className="n">{fmt(a.base)}</td><td className="n">{fmt(a.used)}</td><td className="n">{fmt(a.rest)}</td>
                      <td className="n"><input type="number" step="any" min={0} max={a.rest} value={v} style={{ width: 120, textAlign: 'right' }} onChange={(e) => setV(e.target.value)} /> <button type="button" className="btn sm" onClick={() => setV(String(a.rest))}>сè</button></td></tr>;
                  })}</tbody></table></div> : <p className="note">{d.partnerId ? 'Нема отворени авансни фактури за овој купувач.' : 'Изберете купувач за да се прикажат неговите аванси.'}</p>}
                <p className="note">Износот се внесува без ДДВ; ДДВ на авансот се одбива пропорционално.</p></>}
          </>}
        </div>
      </div>
      </div>
      {headOpen
        ? <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn pri" data-testid="header-next" onClick={goLines}>Понатаму → Ставки</button>
          {headErr && <span className="callout bad" role="alert" data-testid="header-err" style={{ margin: 0 }}>{headErr}</span>}
          <small className="note">Enter во поле од заглавието (или Tab на „Напомена“) = понатаму на ставките.</small></div>
        : <div ref={sumRef} className="card invsum" data-testid="header-summary" style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', scrollMarginTop: 64 }}>
          <b style={{ flex: 1 }}>{headerSummary(d, partnerOf?.name ?? '', { number: headerStage ? '' : d.number, prodInv })}</b>
          <button type="button" className="btn sm ghost" data-testid="header-edit" aria-label="Измени го заглавието" title="Измени го заглавието"
            onClick={() => { setHeadOpen(true); setTimeout(() => headRef.current?.scrollIntoView?.({ block: 'start' }), 0); }}>✎</button></div>}
      {hint.length > 0 && <div className="callout info" data-testid="edb-hint">ℹ {EDB_HINT} – недостасува: {hint.join(', ')}. (Само напомена – фактурата може да се зачува и испечати.)</div>}

      {!headerStage && <div ref={linesRef} data-testid="lines-step">
      {prodInv && <section data-testid="main-products">
        <datalist id="prodNameList">{items.filter((i) => i.type === 'product').map((i) => <option key={i.id} value={i.name}>{i.code ?? ''}</option>)}</datalist>
        {d.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.prod?.main).map(({ l, i }, k, all) => (
          <div key={i} id={`mainprod-${i}`}><MainProductCard k={k} line={l} items={items} stock={p.stock} avg={avgs} boms={boms} locations={p.locations} fx={fxN} cur={cur} rates={RATES} vatLocked={d.art32 || d.export}
            head={{ number: d.number, date: d.date, partner: p.partners.find((x) => x.id === d.partnerId)?.name ?? '', currency: d.currency, fx: d.fx, workOrder: woRef ? workOrderLabel(woRef) : '' }}
            onLine={(x) => (x.name !== undefined ? setMainName(i, x.name) : setLine(i, x))} onProd={(pr) => setProdOf(i, pr)}
            onCreate={() => void createProduct(i)} creating={creating === i} onRemove={all.length > 1 || nonEmpty(l) ? () => set({ lines: d.lines.filter((_, j) => j !== i) }) : null}
            orderNo={orderNo(i)} printHref={d.id && p.prodRun?.lines.length ? `/print/prodKalk/${d.id}` : null} /></div>
        ))}
        <div className="row" style={{ marginTop: 6 }}><button type="button" className="btn" onClick={addMain}>+ Уште еден главен производ</button></div>
        <h3 className="fh" style={{ marginTop: 14 }}>Ставки на фактурата</h3>
        <p className="note" style={{ marginTop: 0 }}>Редовите 🏭 доаѓаат од главните производи (се менуваат горе). Подолу може да се додадат и други ставки – услуги (транспорт, монтажа) или стока од залиха.</p>
      </section>}

      {d.kind !== 'dispatch' && !prodInv && <label className="chk"><input type="checkbox" checked={svcOnly} disabled={!p.canSettings} onChange={(e) => {
        const v = e.target.checked;
        setSvcOnly(v);
        startT(async () => { await setSvcOnlyAction(v); });
        setToast(v ? 'Фирмата е означена: само услуги.' : 'Брзото додавање артикли е вклучено.');
      }} /> Фирмата има <b>само услуги</b> (без производи) – ставките се пишуваат рачно</label>}
      {!svcMode && <div className="card qa"><div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f" style={{ flex: '1 1 320px', position: 'relative' }}>Брзо додавање артикл – шифра, баркод или назив
          <input ref={qaRef} autoComplete="off" placeholder="🔍 почнете да пишувате или скенирајте баркод…" value={qa.q}
            onChange={(e) => setQa({ ...qa, q: e.target.value, sel: '', i: 0 })}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setQa({ ...qa, i: Math.min(qa.i + 1, qaList.length - 1) }); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setQa({ ...qa, i: Math.max(qa.i - 1, 0) }); }
              else if (e.key === 'Escape') { setQa({ ...qa, q: '', i: 0 }); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                if (qa.sel) { qtyRef.current?.focus(); qtyRef.current?.select(); return; }
                const it = qaList[qa.i];
                if (it) { setQa({ ...qa, sel: it.id, q: (it.code ? it.code + ' · ' : '') + it.name }); setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 20); }
              }
            }} />
          {qaList.length > 0 && <div className="qa-list">{qaList.map((i, k) => (
            <div key={i.id} className={'qa-it' + (k === qa.i ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); setQa({ ...qa, sel: i.id, q: (i.code ? i.code + ' · ' : '') + i.name }); setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 20); }}>
              <span className="num">{i.code}</span><b>{i.name}</b><span className="note">{fmt(priceOf(i))} ден. · {i.rate}%{stockOf(i.id) != null ? ` · залиха ${fq(stockOf(i.id))}` : ''}</span></div>))}</div>}
        </label>
        <label className="f" style={{ width: 110 }}>Количина<input ref={qtyRef} type="number" step="any" value={qa.qty} style={{ textAlign: 'right' }} onChange={(e) => setQa({ ...qa, qty: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); qaAdd(); } }} /></label>
        <button type="button" className="btn pri" onClick={qaAdd}>+ Додај (Enter)</button>
      </div>{(() => {
        const sel = itemById.get(qa.sel);
        if (!sel) return <p className="note" style={{ margin: '4px 0 0' }}>Изберете артикл, внесете само количина и притиснете Enter – цената, ДДВ, мерката и контото се пополнуваат сами. Истиот артикл двапати = се зголемува количината.</p>;
        const sq = stockOf(sel.id);
        return <p className="note" style={{ margin: '4px 0 0' }}>Избрано: <b>{sel.name}</b> · {sel.unit || 'ком'} · цена {fmt(priceOf(sel))} ден. без ДДВ · ДДВ {sel.rate}%{sq != null && <> · на залиха во {loc?.name ?? 'Главен магацин'}: <b style={sq <= 0 ? { color: 'var(--bad)' } : undefined}>{fq(sq)}</b></>}</p>;
      })()}</div>}

      <datalist id="itemList">{items.map((i) => <option key={i.id} value={i.name}>{i.code ?? ''}</option>)}</datalist>
      <datalist id="svcItemList">{[...new Set([...(p.svcTexts ?? []), ...items.map((i) => i.name)])].map((x) => <option key={x} value={x} />)}</datalist>
      <div className="tw"><table><thead><tr><th style={{ minWidth: 200 }}>Артикл / опис</th><th>Ед. мерка</th><th className="n">Количина</th><th className="n">Цена без ДДВ{d.currency !== 'MKD' ? ' (' + d.currency + ')' : ''}</th><th className="n">Рабат %</th><th>ДДВ</th><th>Конто</th><th className="n">Износ</th><th></th></tr></thead><tbody>
        {d.lines.map((l, i) => {
          if (isMain(l)) {
            const k = d.lines.slice(0, i).filter((x) => x.prod?.main).length;
            return (<tr key={i} className="prodhead" data-testid="main-line">
              <td><b>{lineOut(l).name || '…'}</b><small className="note"> 🏭 главен производ{k ? ' ' + (k + 1) : ''} · <a href={`#mainprod-${i}`}>измени горе ↑</a></small></td>
              <td>{l.unit}</td><td className="n">{l.qty}</td><td className="n">{l.price}</td><td className="n">{l.disc}</td><td>{l.rate}%</td><td>{l.account || p.revDefault}</td>
              <td className="n">{fmt(lineAmt(l))}</td><td />
            </tr>);
          }
          const it = l.itemId ? itemById.get(l.itemId) : undefined;
          const sq = it ? stockOf(it.id) : undefined;
          const tracked = it && sq != null;
          const produced = canProd && !!l.prod && !prodInv;
          const over = tracked && !produced && Number(l.qty) > sq! + 1e-9 && d.kind !== 'proforma' && !d.fromDocId;
          const c = calcs.get(i);
          return (<Fragment key={i}>
            <tr className={produced ? 'prodhead' : undefined} data-row={i}>
              <td><input value={l.name} list="svcItemList" data-f="name" aria-label={`Артикл / опис, ред ${i + 1}`} onKeyDown={lineKey(i, 'name')} style={{ minWidth: svcMode ? 380 : 260 }} placeholder={svcMode ? 'Напишете ја услугата, пр. Сметководствени услуги за месец …' : 'Артикл од листата или слободен опис на услуга'} onChange={(e) => {
                const v = e.target.value;
                const found = items.find((x) => x.name === v || (x.code && x.code === v.trim()));
                setLine(i, found ? fromItem(found) : { name: v, itemId: '' });
              }} />{tracked && !produced && <small className="note" style={over ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>на залиха во {loc?.name ?? 'Главен магацин'}: {fq(sq)} {it.unit ?? ''}{over ? ' – недоволно!' : ''}</small>}
                {produced && <small className="note" style={c?.below ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>🏭 производство{c ? <> · трошок {fmt(c.cost)} · маржа {fmt(c.margin)}{c.pct != null ? ` (${c.pct.toFixed(1)}%)` : ''}{c.below ? ' – под цена на чинење!' : ''}</> : ' · креирајте производ'}{' '}
                  <button type="button" className="btn sm ghost" aria-expanded={l.prod!.open} onClick={() => setProdOf(i, { ...l.prod!, open: !l.prod!.open })}>{l.prod!.open ? '▴ скриј' : '▾ репроматеријали'}</button></small>}</td>
              <td><input value={l.unit} style={{ width: 64 }} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
              <td><input type="number" step="any" value={l.qty} data-f="qty" aria-label={`Количина, ред ${i + 1}`} onKeyDown={lineKey(i, 'qty')} style={{ width: 90, textAlign: 'right' }} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
              <td><input type="number" step="any" value={l.price} data-f="price" aria-label={`Цена, ред ${i + 1}`} onKeyDown={lineKey(i, 'price')} style={{ width: 110, textAlign: 'right' }} onChange={(e) => setLine(i, { price: e.target.value })} /></td>
              <td><input type="number" step="any" value={l.disc} data-f="disc" aria-label={`Рабат, ред ${i + 1}`} onKeyDown={lineKey(i, 'disc')} style={{ width: 64, textAlign: 'right' }} onChange={(e) => setLine(i, { disc: e.target.value })} /></td>
              <td><select value={l.rate} disabled={d.art32 || d.export} onChange={(e) => setLine(i, { rate: e.target.value })}>{RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
              <td><select value={l.account || p.revDefault} className="wide" onChange={(e) => setLine(i, { account: e.target.value })}>
                {!p.accounts.some(([k]) => k === (l.account || p.revDefault)) && <option value={l.account || p.revDefault}>{l.account || p.revDefault}</option>}
                {p.accounts.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}</select></td>
              <td className="n">{fmt(lineAmt(l))}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{canProd && !prodInv && <button type="button" className={'btn sm' + (produced ? ' pri' : '')} aria-pressed={produced} aria-label={`Производство: ${l.name || 'ред ' + (i + 1)}`}
                title={produced ? '🏭 Се произведува – исклучи' : '🏭 Означи: ставката се произведува од репроматеријали'} onClick={() => toggleProd(i)}>{produced ? '🏭 ✓ Производ.' : '🏭 Производство'}</button>}
                <button type="button" className="btn sm ghost danger" aria-label="Отстрани ред" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })}>✕</button></td>
            </tr>
            {produced && (l.prod!.open || !c) && <tr className="prodrow"><td colSpan={9}>
              <LineProdPanel line={l} items={items} stock={p.stock} avg={avgs} boms={boms} locations={p.locations} fx={fxN} cur={cur}
                onChange={(pr) => setProdOf(i, pr)} onCreate={() => void createProduct(i)} creating={creating === i} orderNo={orderNo(i)} />
            </td></tr>}
          </Fragment>);
        })}
      </tbody></table></div>
      <div className="row"><button type="button" className="btn" onClick={() => set({ lines: [...d.lines, blankLine(p.revDefault, d.export ? '0' : '18')] })}>{svcMode ? '+ Ред (артикл)' : '+ Ред'}</button>
        {d.kind !== 'dispatch' && <button type="button" className={'btn' + (svcMode ? ' pri' : '')} onClick={addSvc}>+ Услуга (слободен опис)</button>}<span style={{ flex: 1 }} />
        <div className="card" style={{ minWidth: 260, padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Основица</span><span className="num">{fmt(T.base)}</span></div>
          {d.art32 ? <div className="row" style={{ justifyContent: 'space-between' }}><span>ДДВ 18% пренесен</span><span className="num">{fmt(T.transferredVat)}</span></div>
            : T.by.filter((g) => g.rate).map((g) => <div key={g.rate + g.konto} className="row" style={{ justifyContent: 'space-between' }}><span>ДДВ {g.rate}%</span><span className="num">{fmt(g.vat)}</span></div>)}
          <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--line)', paddingTop: 6 }}><span>{T.advTotal ? 'Вкупно' : 'За плаќање'}</span><span className="num">{fmt(d.art32 ? T.base : T.total)} {cur}</span></div>
          {T.advTotal > 0 && <><div className="row" style={{ justifyContent: 'space-between' }}><span>Одбиен аванс (со ДДВ)</span><span className="num">−{fmt(T.advTotal)}</span></div>
            <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700 }}><span>За плаќање</span><span className="num">{fmt(T.pay)} {cur}</span></div></>}
          {d.currency !== 'MKD' && <div className="mini" style={{ textAlign: 'right' }}>= {fmt(T.pay * (Number(d.fx) || 0))} ден.</div>}
        </div></div>
      {PS.lines > 0 && <div className="card prodsum" data-testid="prod-summary" style={{ padding: 12, marginTop: 8 }}>
        <b>🏭 Производство по фактурата</b> ({PS.lines} ставки):{' '}
        вкупно трошок на производство <b className="num">{fmt(PS.cost)}</b> · продажна вредност <b className="num">{fmt(PS.sale)}</b> ·{' '}
        <span style={PS.margin < 0 ? { color: 'var(--bad)' } : undefined}>маржа <b className="num">{fmt(PS.margin)}</b>{PS.pct != null ? ` (${PS.pct.toFixed(2)}%)` : ''}</span>
        {PS.below > 0 && <span style={{ color: 'var(--bad)' }}> · ⚠ {PS.below} под цена на чинење</span>}
        <div className="note">При зачувување: за секоја ставка се прави налог за производство со датумот на фактурата – репроматеријалите се раздолжуваат по просечна цена, производот се заприма по цената на чинење, а фактурата го продава.</div>
      </div>}
      {d.kind !== 'proforma' && <p className="note">Артиклите со залиха автоматски се раздолжуваат по просечна цена (Должи 7000/7010 – Побарува 6300/6600).</p>}
      </div>}
      {headerStage && <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn pri" name="asDraft" value="1" disabled={pending}>Креирај фактура →</button>
        <small className="note">Се зачувува како нацрт (не се книжи); потоа се отвораат ставките{prodInv ? ', главниот производ и калкулацијата' : ''}.</small></div>}
    </form>
  );
}
