'use client';
/**
 * Purchase editor — legacy `purEditor` 4505, `purHeader` 4446, `readPurForm` 4557, `purCheckHTML` 4442,
 * landed costs (`COSTS`, `allocCosts` 4347), margin buttons (`applyMargin`), barcode scanning into the receipt,
 * attached documents with AI reading into the open draft (`readIntoDraft` 4326 / `readAtt`), import documents
 * (`readImportDocs` 4365), the scan queue / batch callouts and the fuel VAT warning on save (14361).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { allocCosts, stockLineValue } from '@wise/core/stock';
import { addDays, CURRENCIES, fuelPurchaseWarning, type ScanPurchaseDraft } from '@wise/core/sales';
import type { FuelRule } from '@wise/core/law';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { uploadFile } from '@/lib/upload';
import { addSupplierAction, createItemsAction, deletePurchaseAction, saveMarginDefaults, savePurchaseAction } from '@/app/(app)/vlez/actions';
import { scanStatus, scanTaken, startScans } from '@/app/(app)/skan/actions';
import { AI_OPEN_FAILED_MSG, AI_UNAVAILABLE_MSG, aiReadDoneMsg, isAiUnavailable } from '@wise/core/ai/messages';
import { startAiRead, aiReadStatus } from '@/app/(app)/_ai/actions';
import { blankCost, COSTS, type EdPurchase, type EdStock } from './model';
import { PX_DRAFT_KEY, type PxDraft } from './px-import';

export interface PurItemOpt { id: string; code: string | null; name: string; unit: string | null; rate: number; type: string; barcodes: string[]; sp: Record<string, number>; price: number; lastCost?: number }
export interface ScanQueueProp { batch: boolean; name: string; rest: number; skipHref: string | null; listHref: string }
export interface PurchaseEditorProps {
  initial: EdPurchase;
  title: string;
  partners: { id: string; code: string | null; name: string; edb: string | null }[];
  items: PurItemOpt[];
  locations: { id: string; code: string | null; name: string; kind: string }[];
  accounts: [string, string][];
  nonVat: boolean;
  defMargin: number;
  mgRound: number;
  back: string;
  scanInfo?: string;
  files: { id: string; name: string }[];
  nalogNo?: string | null;
  queue?: ScanQueueProp;
  prevSaved?: boolean;
  warn?: string;
  firmId?: string;
  canDel?: boolean;
  /** Stock konto per line type (legacy `stTypeK`). */
  typeKonto?: { goods: string; material: string; product: string };
  /** Closed VAT periods `[from, to]` (legacy `ddvClosed`). */
  closed?: [string, string][];
  fuelRule?: FuelRule | null;
  /** Opened from „📥 Фактура со ставки од Excel“: the lines wait in sessionStorage (`PX_DRAFT_KEY`). */
  pxInfo?: string;
}

const RATES = ['18', '10', '5', '0'];
const n = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');
const blankStock = (): EdStock => ({ itemId: '', name: '', code: '', barcode: '', unit: 'ком', qty: '1', price: '', rab: '', amount: '', cn: '', dep: '', sp: '', type: 'goods', rate: '18' });

/** Import document read result (legacy IMP_PROMPT 4350). */
interface ImpDoc {
  type?: string; issuerName?: string; issuerTaxId?: string; issuerForeign?: boolean; number?: string; date?: string; dueDate?: string;
  currency?: string; exchangeRate?: number; totalCurrency?: number; lines?: { name?: string; unit?: string; qty?: number; price?: number }[];
  base?: number; vatRate?: number; vat?: number; ecd?: string; duty?: number; vatBase?: number; customsVat?: number;
}

export function PurchaseEditor(p: PurchaseEditorProps) {
  const router = useRouter();
  const [st, action, pending] = useActionState<ActionState, FormData>(savePurchaseAction, {});
  const [d, setD] = useState<EdPurchase>(p.initial);
  const [tab, setTab] = useState<'osn' | 'dev' | 'dop'>(p.initial.imp && !p.initial.id ? 'dev' : 'osn');
  const [allowDup, setAllowDup] = useState(false);
  const [bc, setBc] = useState('');
  const [toast, setToast] = useState('');
  const [parts, setParts] = useState(p.partners);
  const [files, setFiles] = useState(p.files);
  const [mgCustom, setMgCustom] = useState('');
  const [mgRound, setMgRound] = useState(String(p.mgRound || 1));
  const [reading, setReading] = useState<{ id: string; t0: number; kind: 'pur' | 'imp' }[]>([]);
  const [, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const impRef = useRef<HTMLInputElement>(null);
  const bcRef = useRef<HTMLInputElement>(null);
  const set = (x: Partial<EdPurchase>) => setD((o) => ({ ...o, ...x }));
  useEffect(() => {
    if (!p.pxInfo) return;
    try {
      const x = JSON.parse(sessionStorage.getItem(PX_DRAFT_KEY) ?? 'null') as PxDraft | null;
      sessionStorage.removeItem(PX_DRAFT_KEY);
      if (!x) return;
      setD((o) => ({ ...o, imp: x.imp, warehouseId: x.wh, number: x.number || o.number, date: x.date || o.date, docDate: x.date || o.docDate, partnerId: x.partnerId, supplierName: x.supplierName,
        ...(x.imp ? { currency: x.currency, fx: x.fx, data: { ...o.data, fxAmt: String(x.fxAmt) } } : {}), groups: x.groups, ptype: 'stock',
        stock: x.stock.map((l) => ({ itemId: l.itemId, name: l.name, code: l.code, barcode: l.barcode, unit: 'ком', qty: l.qty, price: l.price, rab: '', amount: '', cn: '', dep: '', sp: l.sp, type: 'goods', rate: l.rate, isNew: !l.itemId })) }));
      setToast(p.pxInfo);
      if (x.imp) setTab('dev');
    } catch { /* nothing to load */ }
  }, [p.pxInfo]);
  const setData = (x: Record<string, string>) => setD((o) => ({ ...o, data: { ...o.data, ...x } }));
  const setG = (i: number, x: Partial<EdPurchase['groups'][number]>) => setD((o) => ({ ...o, groups: o.groups.map((g, k) => (k === i ? { ...g, ...x } : g)) }));
  const setS = (i: number, x: Partial<EdStock>) => setD((o) => ({ ...o, stock: o.stock.map((s, k) => (k === i ? { ...s, ...x } : s)) }));
  const setC = (k: string, x: Partial<EdPurchase['costs'][string]>) => setD((o) => ({ ...o, costs: { ...o.costs, [k]: { ...(o.costs[k] ?? blankCost()), ...x } } }));
  const itemById = useMemo(() => new Map(p.items.map((i) => [i.id, i])), [p.items]);
  const W = d.warehouseId || 'main';
  const store = p.locations.find((l) => l.id === d.warehouseId)?.kind === 'store';
  const stockItems = p.items.filter((i) => i.type !== 'service');
  const tk = p.typeKonto ?? { goods: '6600', material: '3100', product: '6300' };
  const isClosed = (dt: string) => !!dt && (p.closed ?? []).some(([a, b]) => dt >= a && dt <= b);

  const P = {
    imp: d.imp, fx: n(d.fx), distMode: d.distMode, cnames: d.cnames,
    costs: Object.fromEntries(Object.entries(d.costs).map(([k, c]) => [k, { amt: n(c.amount), fx: n(c.fx), byQty: c.byQty, lines: c.lines.map((l) => ({ base: n(l.base), rate: n(l.rate), vat: n(l.vat) })) }])),
    stock: d.stock.map((s) => ({ item: s.itemId, qty: n(s.qty), price: n(s.price), rab: n(s.rab), cn: s.cn === '' ? '' : n(s.cn), dep: s.dep === '' ? '' : n(s.dep) })),
  };
  const AL = allocCosts(P);
  const aSum = r2(AL.by.reduce((a, b) => a + b, 0));
  const gBase = r2(d.groups.reduce((a, g) => a + n(g.base), 0)), gVat = d.art32 ? 0 : r2(d.groups.reduce((a, g) => a + n(g.vat), 0));
  const visibleCosts = COSTS.filter(([k]) => d.imp || !['car', 'dev'].includes(k));
  const totC = r2(visibleCosts.reduce((a, [k]) => a + n(d.costs[k]?.amount), 0));
  const totV = r2(visibleCosts.reduce((a, [k]) => a + (d.costs[k]?.lines ?? []).reduce((x, l) => x + n(l.vat), 0), 0));
  const cnSum = r2(d.cnames.reduce((a, v) => a + n(v), 0));
  const cnUsed = d.cnames.map((v, i) => [i, n(v)] as const).filter(([, v]) => v);
  const fxTot = r2(n(d.data.fxAmt) * n(d.fx));
  const lineRate = (s: EdStock) => (s.itemId ? itemById.get(s.itemId)?.rate ?? 18 : n(s.rate) || 18);

  // legacy purCheckHTML: stock lines per rate vs booked groups
  const check = (() => {
    if (d.imp || d.ptype !== 'stock' || !d.stock.length) return null;
    const by: Record<number, number> = {}, G: Record<number, number> = {};
    for (const s of d.stock) { if (!n(s.qty)) continue; const rt = lineRate(s); by[rt] = (by[rt] ?? 0) + (n(s.amount) || n(s.qty) * n(s.price) * (1 - n(s.rab) / 100)); }
    for (const g of d.groups) G[n(g.rate)] = (G[n(g.rate)] ?? 0) + n(g.base);
    const rates = [...new Set([...Object.keys(by), ...Object.keys(G)].map(Number))].sort((a, b) => b - a);
    const bad = rates.filter((r) => Math.abs((by[r] ?? 0) - (G[r] ?? 0)) > 1);
    return { ok: !bad.length, rates, by, G };
  })();
  const groupsFromStock = () => {
    if (!check) return;
    const acc = d.groups[0]?.account || tk.goods;
    set({ groups: check.rates.filter((r) => check.by[r]).map((r) => ({ account: acc, rate: String(r), base: String(r2(check.by[r]!)), vat: d.art32 ? '0' : String(r2((check.by[r]! * r) / 100)) })) });
    setToast('Книжењето е пресметано од ставките по стапки на ДДВ.');
  };
  // legacy applyMargin (7162): rounding `rr = sp < rd*5 ? 0.01 : rd`, warning for purchase prices under 0,50
  const applyMargin = (pct: number) => {
    const rd = n(mgRound) || 1;
    let cnt = 0, tiny = 0;
    set({
      stock: d.stock.map((s, i) => {
        const qty = n(s.qty);
        if (!qty) return s;
        const nab = (stockLineValue(P, P.stock[i]!) + (AL.by[i] ?? 0)) / qty;
        if (!nab) return s;
        let sp = nab * (1 + pct / 100) * (1 + lineRate(s) / 100);
        const rr = sp < rd * 5 ? 0.01 : rd;
        sp = Math.round(sp / rr) * rr;
        cnt++;
        if (nab < 0.5) tiny++;
        return { ...s, sp: String(r2(sp)) };
      }),
    });
    setToast(tiny ? `Внимание: ${tiny} артикли имаат набавна цена под 0,50 ден. – проверете ги количините (можеби „80,000“ е прочитано како 80000). Прочитајте ја фактурата повторно.` : `Продажните цени се пресметани со ${pct}% разлика во цена за ${cnt} артикли.`);
    void saveMarginDefaults(pct, mgRound);
  };
  const scan = () => {
    const v = bc.trim();
    if (!v) return;
    const it = p.items.find((i) => i.barcodes.includes(v) || (i.code ?? '').toLowerCase() === v.toLowerCase());
    setD((o) => {
      const S = [...o.stock];
      if (it) {
        const ex = S.findIndex((x) => x.itemId === it.id);
        if (ex >= 0) S[ex] = { ...S[ex]!, qty: String(n(S[ex]!.qty) + 1) };
        else S.push({ ...blankStock(), itemId: it.id, name: it.name, price: it.lastCost ? String(it.lastCost) : '', barcode: /^\d{8,}$/.test(v) ? v : '', type: it.type });
      } else S.push({ ...blankStock(), barcode: v });
      return { ...o, stock: S };
    });
    if (!it) setToast('Нов баркод ' + v + ' – изберете го артиклот во редот (или креирајте нов во Шифрарник); баркодот ќе се запише на него.');
    setBc('');
    setTimeout(() => bcRef.current?.focus(), 20);
  };
  const distBy = (mode: 'val' | 'cn' | 'multi', msg: string) => {
    if (mode !== 'val' && !d.cnames.some((v) => n(v))) { setToast('Внесете ги царинските наименувања (картичка Девизна).'); return; }
    const A = allocCosts({ ...P, distMode: mode });
    set({ distMode: mode, stock: d.stock.map((s, i) => ({ ...s, dep: String(A.by[i] ?? 0) })) });
    setToast(msg.replace('{t}', fmt(A.tot)));
  };
  const calcTot = () => {
    let nabV = 0, dep = 0, marg = 0, spV = 0;
    d.stock.forEach((s, i) => {
      const q = n(s.qty);
      if (!q) return;
      const it = s.itemId ? itemById.get(s.itemId) : undefined;
      const rate = lineRate(s), v = stockLineValue(P, P.stock[i]!), a = AL.by[i] ?? 0;
      const sp = s.sp !== '' ? n(s.sp) : it ? (it.sp[W] ?? r2(it.price * (1 + rate / 100))) : 0;
      const sv = r2(sp * q), net = r2(sv / (1 + rate / 100));
      nabV += r2(v + a); dep += a; spV += sv; marg += r2(net - r2(v + a));
    });
    setToast(`Набавна ${fmt(nabV)} · трошоци ${fmt(dep)} · разлика ${fmt(marg)} · продажна со ДДВ ${fmt(spV)}`);
  };
  const fxToDen = () => {
    if (!fxTot) { setToast('Внесете износ во девизи и курс.'); return; }
    const gk0 = d.groups[0]?.account || '';
    set({ imp: true, groups: [{ account: /^[036]/.test(gk0) && gk0 !== '4000' ? gk0 : tk.goods, rate: '0', base: String(fxTot), vat: '0' }] });
    setToast('Во книжење: ' + fmt(fxTot) + ' ден. без ДДВ.');
  };
  const cnToCar = () => {
    const c = d.costs.car ?? blankCost();
    const rt = c.lines[0]?.rate || '18';
    setC('car', { lines: c.lines.map((l, i) => (i === 0 ? { base: String(cnSum), rate: rt, vat: String(r2((cnSum * n(rt)) / 100)) } : l)) });
  };
  const addSupplier = () => start(async () => {
    const r = await addSupplierAction(d.supplierName, d.supplierEdb, d.imp);
    if (r.error || !r.id) { setToast(r.error ?? 'Грешка.'); return; }
    if (!parts.some((x) => x.id === r.id)) setParts((P0) => [...P0, { id: r.id!, code: r.code ?? null, name: r.name ?? d.supplierName, edb: r.edb ?? null }]);
    set({ partnerId: r.id });
    setToast(r.ok ?? '');
  });
  const createMissing = () => start(async () => {
    const L = d.stock.map((s) => ({ name: s.itemId ? '' : s.name, code: s.code, barcode: s.barcode, unit: s.unit, qty: s.qty, price: s.price, rate: s.rate, type: s.type }));
    const r = await createItemsAction(L, d.partnerId);
    if (r.error || !r.ids) { setToast(r.error ?? 'Грешка.'); return; }
    set({ stock: d.stock.map((s, i) => (r.ids![i] ? { ...s, itemId: r.ids![i]!, isNew: false } : s)) });
    setToast(r.ok ?? '');
    router.refresh();
  });

  /* ---------- attached documents and AI reading into the draft (legacy readIntoDraft / readAtt / readImportDocs) ---------- */
  const mergeScan = (dr: ScanPurchaseDraft) => setD((o) => ({
    ...o, scanned: true, number: dr.number || o.number, date: dr.date || o.date, docDate: dr.docDate || o.docDate, due: dr.due || o.due,
    partnerId: dr.partnerId || o.partnerId, supplierName: dr.supplierName, supplierEdb: dr.supplierEdb, art32: dr.art32,
    groups: dr.groups.map((g) => ({ account: g.konto, rate: String(g.rate), base: String(g.base), vat: String(g.vat) })),
    stock: dr.stock.length ? dr.stock.map((l) => ({ itemId: l.itemId, name: l.name, code: l.code, barcode: l.barcode, unit: l.unit ?? 'ком', qty: String(l.qty), price: String(l.price), rab: '', amount: l.amount ? String(l.amount) : '', cn: '', dep: '', sp: l.sp === undefined ? '' : String(l.sp), type: l.type ?? '', rate: String(l.rate ?? ''), isNew: l.isNew })) : o.stock,
  }));
  const mergeImp = (docs: ImpDoc[]) => setD((o) => {
    let x: EdPurchase = { ...o, imp: true, data: { ...o.data }, costs: { ...o.costs } };
    const slot = (k: string, base: number, rate: number, vat: number, doc: ImpDoc, foreign: boolean) => {
      const pid = parts.find((pp) => pp.name.toLowerCase() === String(doc.issuerName ?? '').toLowerCase())?.id ?? '';
      x.costs[k] = { ...(x.costs[k] ?? blankCost()), amount: String(r2(base)), doc: doc.number ?? '', date: doc.date ?? '', due: doc.dueDate ?? '', partnerId: pid, foreign,
        lines: [{ base: String(r2(base)), rate: String(rate), vat: String(r2(vat)) }, { base: '', rate: '18', vat: '' }, { base: '', rate: '18', vat: '' }] };
    };
    for (const doc of docs) {
      if (doc.type === 'supplier_invoice') {
        x = { ...x, number: doc.number || x.number, docDate: doc.date || x.docDate, due: doc.dueDate || x.due, supplierName: x.partnerId ? x.supplierName : doc.issuerName ?? '', supplierEdb: doc.issuerTaxId ?? x.supplierEdb,
          currency: doc.currency || x.currency, fx: doc.exchangeRate ? String(doc.exchangeRate) : x.fx, data: { ...x.data, fxAmt: doc.totalCurrency ? String(doc.totalCurrency) : x.data.fxAmt ?? '' } };
        if (!x.partnerId) x.partnerId = parts.find((pp) => pp.name.toLowerCase() === String(doc.issuerName ?? '').toLowerCase())?.id ?? '';
        if ((doc.lines ?? []).length && !x.stock.length) x.stock = (doc.lines ?? []).map((l) => ({ ...blankStock(), name: l.name ?? '', unit: l.unit || 'ком', qty: String(l.qty ?? ''), price: String(l.price ?? '') }));
      } else if (doc.type === 'customs_declaration') {
        x = { ...x, data: { ...x.data, ecd: doc.ecd || x.data.ecd || '' }, fx: doc.exchangeRate ? String(doc.exchangeRate) : x.fx, currency: doc.currency || x.currency };
        slot('car', n(doc.duty), 18, n(doc.customsVat), doc, false);
        const c = x.costs.car!;
        if (doc.vatBase) c.lines = [{ base: String(r2(n(doc.vatBase))), rate: '18', vat: String(r2(n(doc.customsVat))) }, ...c.lines.slice(1)];
      } else if (doc.type === 'forwarding') slot('sped', n(doc.base), n(doc.vatRate), n(doc.vat), doc, !!doc.issuerForeign);
      else if (doc.type === 'transport') slot('trans', n(doc.base), n(doc.vatRate), n(doc.vat), doc, !!doc.issuerForeign);
      else if (doc.type === 'other_cost') slot(n(x.costs.t1?.amount) ? 't2' : 't1', n(doc.base), n(doc.vatRate), n(doc.vat), doc, !!doc.issuerForeign);
    }
    if (n(x.data.fxAmt) && n(x.fx)) x.groups = [{ account: x.groups[0]?.account && /^[036]/.test(x.groups[0].account) ? x.groups[0].account : tk.goods, rate: '0', base: String(r2(n(x.data.fxAmt) * n(x.fx))), vat: '0' }];
    return x;
  });
  useEffect(() => {
    if (!reading.length) return;
    const t = setInterval(async () => {
      try {
        const pur = reading.filter((r) => r.kind === 'pur'), imp = reading.filter((r) => r.kind === 'imp');
        if (pur.length) {
          const S = await scanStatus(pur.map((r) => r.id));
          for (const s of S) {
            if (s.status === 'done' && s.drafts[0]) {
              mergeScan(s.drafts[0].draft as unknown as ScanPurchaseDraft);
              void scanTaken(s.id);
              setToast('Податоците се прочитани од документот. Проверете ги и зачувајте.');
              setReading((R) => R.filter((r) => r.id !== s.id));
            } else if (s.status === 'error') { setToast(isAiUnavailable(s.error) ? AI_UNAVAILABLE_MSG : s.error || 'Читањето не успеа. Обидете се повторно.'); setReading((R) => R.filter((r) => r.id !== s.id)); }
          }
        }
        if (imp.length) {
          const S = await aiReadStatus(imp.map((r) => r.id));
          const done = S.filter((s) => s.status === 'done' || s.status === 'error');
          if (done.length === imp.length) {
            const ok = done.filter((s) => s.status === 'done').map((s) => s.result as ImpDoc);
            if (ok.length) mergeImp(ok);
            const err = done.filter((s) => s.status === 'error').length;
            setToast(ok.length ? aiReadDoneMsg([`${ok.length} документи за увоз${err ? ` (${err} не се прочитани)` : ''}`]) : AI_OPEN_FAILED_MSG);
            setReading((R) => R.filter((r) => r.kind !== 'imp'));
          }
        }
      } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(t);
  });
  const readFile = async (fileId: string) => {
    const r = await startScans({ fileIds: [fileId], kind: 'purchase', batchId: null, reread: true, inline: true, warehouseId: d.warehouseId, cash: d.cash });
    if (r.error || !r.ids?.length) { setToast(r.error ?? ((r.skipped ?? []).join(' ') || AI_OPEN_FAILED_MSG)); return; }
    setToast('Се чита документот… (10–60 секунди)');
    setReading((R) => [...R, { id: r.ids![0]!, t0: Date.now(), kind: 'pur' }]);
  };
  const attach = async (f: File) => {
    if (!p.firmId) return;
    setToast('Се прикачува…');
    const r = await uploadFile(f, p.firmId);
    if (!r.ok) { setToast(r.error); return; }
    setFiles((F) => [...F, { id: r.id, name: f.name }]);
    set({ fileIds: [...d.fileIds, r.id] });
    const empty = !d.number && !d.groups.some((g) => n(g.base));
    if (empty) await readFile(r.id); else setToast('Документот е прикачен. Зачувајте ја фактурата.');
  };
  const readImport = async (fs: File[]) => {
    if (!p.firmId || !fs.length) return;
    const ids: string[] = [];
    for (const f of fs) { const r = await uploadFile(f, p.firmId); if (r.ok) ids.push(r.id); }
    if (!ids.length) { setToast('Датотеките не се прикачени.'); return; }
    const r = await startAiRead({ kind: 'imp', fileIds: ids });
    if (r.error || !r.ids) { setToast(r.error ?? 'Грешка.'); return; }
    set({ fileIds: [...d.fileIds, ...ids] });
    setFiles((F) => [...F, ...fs.map((f, i) => ({ id: ids[i] ?? '', name: f.name })).filter((x) => x.id)]);
    setToast(`Се читаат ${r.ids.length} документи за увоз…`);
    setReading((R) => [...R, ...r.ids!.map((id) => ({ id, t0: Date.now(), kind: 'imp' as const }))]);
  };

  /* ---------- save (legacy savePur 7166 → 14361) ---------- */
  const beforeSave = (e: React.FormEvent<HTMLFormElement>) => {
    // closed VAT period → the invoice is booked with today's date of receipt (legacy savePur)
    if (!d.id && !d.data.lateOk && isClosed(d.date)) {
      const today = new Date().toISOString().slice(0, 10);
      e.preventDefault();
      setD((o) => ({ ...o, docDate: o.docDate || o.date, date: today, shifted: true }));
      setToast('ДДВ периодот на ' + dmy(d.date) + ' е затворен – фактурата се книжи со датум на прием ' + dmy(today) + '.');
      setTimeout(() => formRef.current?.requestSubmit(), 50);
      return;
    }
    if (d.imp && !n(d.fx) && n(d.data.fxAmt)) { e.preventDefault(); setToast('Внесете курс за девизната фактура.'); setTab('dev'); return; }
    if (!d.groups.some((g) => n(g.base))) { e.preventDefault(); setToast('Во делот „Книжење“ нема износ (основица). Внесете ја основицата од фактурата, па зачувајте.'); return; }
    if (!d.imp && !d.data.fuelOk) {
      const names = [...d.stock.map((s) => s.name || (s.itemId ? itemById.get(s.itemId)?.name : '')), d.data.memo, d.supplierName, parts.find((x) => x.id === d.partnerId)?.name];
      const w = fuelPurchaseWarning({ names, groups: d.groups, date: d.docDate || d.date }, p.fuelRule ?? null);
      if (w && !window.confirm(w)) { e.preventDefault(); return; }
    }
  };
  // keyboard: F2 калкулација, F3 приемен лист, F5 распоред на трошоци, F6 ДДВ од царина (legacy title hints)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F5') { e.preventDefault(); distBy(d.distMode === 'val' ? 'val' : d.distMode, 'Трошоците ({t}) се распоредени на артиклите. Можете рачно да ги измените.'); }
      else if (e.key === 'F6' && d.imp) { e.preventDefault(); setToast('ДДВ од царина е распореден по артикли.'); }
      else if (e.key === 'F2' && d.id) { e.preventDefault(); window.open(`/print/kalk/${d.id}`, '_blank'); }
      else if (e.key === 'F3' && d.id) { e.preventDefault(); window.open(`/print/kalk/${d.id}?t=plt`, '_blank'); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const pf = (k: string, l: string, o: { type?: string; w?: number; b?: boolean; ph?: string } = {}) => (
    <label className={'fl' + (o.b ? ' b' : '')}><span>{l}</span><input type={o.type} value={d.data[k] ?? ''} placeholder={o.ph} style={o.w ? { maxWidth: o.w } : undefined} onChange={(e) => setData({ [k]: e.target.value })} /></label>
  );
  const pOpts = <><option value="">— избери —</option>{parts.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name}</option>)}</>;
  const kontoOpts = (cur: string, test: (k: string) => boolean = () => true) => <>{cur && !p.accounts.some(([k]) => k === cur) && <option value={cur}>{cur}</option>}{p.accounts.filter(([k]) => test(k)).map(([k, nm]) => <option key={k} value={k}>{k} · {nm}</option>)}</>;
  const dupErr = st.error && /веќе е внесена|веќе е прикачен|ВЕЌЕ Е ЗАВЕДЕНА/.test(st.error);
  const missing = d.stock.filter((s) => !s.itemId && s.name);
  const shiftBox = d.shifted && !d.data.lateOk && d.docDate && d.docDate !== d.date;

  return (
    <form action={action} ref={formRef} onSubmit={beforeSave}>
      <input type="hidden" name="payload" value={JSON.stringify({ ...d, allowDuplicate: allowDup, back: p.back })} />
      <div className="hd"><h1>{p.title}</h1><div className="row">
        {d.id && p.canDel && <button type="button" className="btn danger" onClick={() => {
          if (!window.confirm(`Да се избрише влезната фактура бр. ${d.number || ''} од ${dmy(d.date)}?\nЌе се избрише и налогот и приемот на залиха.`)) return;
          start(async () => { const r = await deletePurchaseAction(d.id!); if (r.error) window.alert(r.error); else router.push('/vlez'); });
        }}>Избриши</button>}
        <Link className="btn" href={p.back}>Откажи</Link>
        <button className="btn pri" disabled={pending}>{pending ? 'Се зачувува…' : 'Зачувај и прокнижи'}</button></div></div>
      {st.error && <div className="callout bad" role="alert">{st.error}{dupErr && <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} /> Сепак зачувај (не е дупликат)</label>}</div>}
      {toast && <div className="callout info" role="status" onClick={() => setToast('')}>{toast}</div>}
      {p.prevSaved && <div className="callout good">Претходната фактура е зачувана и прокнижена. Се отвора следната.{p.warn && p.warn.split(' | ').map((w, k) => <span key={k}><br />⚠ {w}</span>)}</div>}
      {shiftBox && <div className="callout info">Фактурата е од <b>{dmy(d.docDate)}</b>, но ДДВ периодот е веќе затворен (ДДВ пријавата е книжена). Затоа автоматски се книжи во тековниот период – датум на прием <b>{dmy(d.date)}</b>. <button type="button" className="btn sm" onClick={() => set({ date: d.docDate, shifted: false, data: { ...d.data, lateOk: '1' } })}>Врати ја во периодот на документот</button></div>}
      {d.data.lateOk && isClosed(d.date) && <div className="callout warn">Фактурата се книжи во затворен ДДВ период – потребна е исправка на ДДВ пријавата (прво отворете го периодот во ДДВ-04).</div>}
      {p.queue?.batch && <div className="callout info">Масовно внесување: фактура „{p.queue.name}“ · уште <b>{p.queue.rest}</b> незачувани. По „Зачувај“ автоматски се отвора следната. <Link className="btn sm" href={p.queue.listHref}>← Листа</Link></div>}
      {p.queue && !p.queue.batch && p.queue.rest > 0 && <div className="callout info">Уште <b>{p.queue.rest}</b> документи во редица – по „Зачувај“ се отвора следниот. {p.queue.skipHref && <Link className="btn sm" href={p.queue.skipHref}>Прескокни ја оваа → следна</Link>}</div>}
      {(d.scanned || p.scanInfo) && <div className="callout good">{p.scanInfo ?? 'Податоците се прочитани автоматски од документот. Проверете ги износите пред да зачувате.'}</div>}
      {d.credit && <div className="callout warn">Документот е одобрение (CreditNote) – износите се со минус. За поврат на стока користете „Повратници / одобренија од добавувачи“.</div>}
      {d.status === 'pending' && <div className="callout warn">Внесено од клиентот – чека одобрување (не е прокнижено).</div>}
      {d.imp && d.stock.some((s) => n(s.qty)) && (!n(d.fx) || d.stock.some((s) => n(s.qty) && !(n(s.price) > 0))) && <div className="callout warn">⚠ Набавната цена ќе биде 0: {!n(d.fx) && <b>не е внесен курс</b>}{!n(d.fx) && d.stock.some((s) => n(s.qty) && !(n(s.price) > 0)) && ' и '}{d.stock.some((s) => n(s.qty) && !(n(s.price) > 0)) && <b>{d.stock.filter((s) => n(s.qty) && !(n(s.price) > 0)).length} ставки немаат цена во девизи</b>}. Набавна (ден) = цена во девизи × курс.</div>}

      <div className="card invhead">
        <div className="ftabs" role="tablist">
          {([['osn', 'Основно'], ['dev', d.imp ? 'Девизна' : 'Зависни трошоци'], ['dop', 'Дополнителни']] as const).map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{l}{id === 'dev' && Object.values(d.costs).some((c) => n(c.amount)) ? ' •' : ''}</button>))}
          {d.imp && <span className="pill info" style={{ marginLeft: 'auto', alignSelf: 'center' }}>увозна</span>}
        </div>
        <div className="fpane" hidden={tab !== 'osn'}><div className="igrid">
          <div className="fcol">
            {!d.imp && <fieldset className="fs"><legend>Плаќање</legend><div className="row">
              <label className="rb"><input type="radio" checked={!d.cash} onChange={() => set({ cash: false })} /> Жиро сметка (обврска 2200)</label>
              <label className="rb"><input type="radio" checked={d.cash} onChange={() => set({ cash: true })} /> Готовина – благајна 1020 (фискална сметка)</label>
            </div></fieldset>}
            <fieldset className="fs"><legend>Вид</legend><div className="row">
              <label className="rb"><input type="radio" checked={!d.imp} onChange={() => set({ imp: false, currency: 'MKD', fx: '1' })} /> Денарска</label>
              <label className="rb"><input type="radio" checked={d.imp} onChange={() => set({ imp: true, cash: false, currency: d.currency === 'MKD' ? 'EUR' : d.currency, supplierAccount: d.supplierAccount || '2210' })} /> Увозна</label>
            </div>{d.imp && <button type="button" className="btn sm" onClick={() => setTab('dev')}>Прочитај увозни документи од PDF →</button>}</fieldset>
            {d.ptype === 'stock' && <label className="fl b"><span>Калкулација бр.</span><input value={d.calcNo} placeholder="автоматски" onChange={(e) => set({ calcNo: e.target.value })} /></label>}
            {pf('oe', 'Орг. ед. (ОЕ)', { w: 120 })}
            <label className="fl"><span>Налог</span><input value={p.nalogNo ? 'бр. ' + p.nalogNo : 'се доделува при зачувување'} disabled /></label>
            {pf('terk', 'Терк', { w: 90, ph: '0' })}{pf('extraCost', 'Доп. трошок')}
            <fieldset className="fs"><legend>Рабат (%)</legend>{pf('rabReg', 'Редовен', { type: 'number', w: 100 })}{pf('rabQty', 'Количински', { type: 'number', w: 100 })}{pf('rabSez', 'Сезонски', { type: 'number', w: 100 })}</fieldset>
          </div>
          <div className="fcol">
            <label className="fl b"><span>Комитент</span><select value={d.partnerId} onChange={(e) => set({ partnerId: e.target.value })}>{pOpts}</select></label>
            {!d.partnerId && d.supplierName && <div className="callout">Добавувачот „{d.supplierName}“ (ЕДБ {d.supplierEdb || '—'}) не е во шифрарникот. <button type="button" className="btn sm" onClick={addSupplier}>Додај го како партнер</button></div>}
            {!d.partnerId && <><label className="fl"><span>или нов добавувач</span><input value={d.supplierName} placeholder="назив (се додава во комитенти)" onChange={(e) => set({ supplierName: e.target.value })} /></label>
              <label className="fl"><span>ЕДБ на добавувач</span><input value={d.supplierEdb} onChange={(e) => set({ supplierEdb: e.target.value })} /></label></>}
            <label className="fl b"><span>По документ (бр. на ф-ра)</span><input value={d.number} onChange={(e) => set({ number: e.target.value })} /></label>
            <label className="fl b"><span>Датум на прием</span><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value, ...(d.data.days ? { due: addDays(d.docDate || e.target.value, d.data.days) } : {}) })} /></label>
            <label className="fl"><span>Датум на ф-ра (документ)</span><input type="date" value={d.docDate} onChange={(e) => set({ docDate: e.target.value })} /></label>
            <div className="fl"><span>Валута (рок)</span><div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="date" value={d.due} onChange={(e) => set({ due: e.target.value })} />
              <input type="number" min={0} value={d.data.days ?? ''} style={{ maxWidth: 80 }} placeholder="дена" aria-label="Рок во денови" onChange={(e) => set({ data: { ...d.data, days: e.target.value }, ...(e.target.value !== '' ? { due: addDays(d.docDate || d.date, e.target.value) } : {}) })} /></div></div>
            {pf('retNo', 'Повратница бр.')}{pf('distrib', 'Дистрибутер')}{pf('odobr', 'Одобр. по док.')}
            <div className="fl"><span>Евидентен курс</span><div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="number" step="any" value={d.data.evKurs ?? '1'} style={{ maxWidth: 110 }} onChange={(e) => setData({ evKurs: e.target.value })} />
              <select value={d.data.evCur || 'MKD'} style={{ maxWidth: 90 }} onChange={(e) => setData({ evCur: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
            <fieldset className="fs"><legend>Салдо</legend><div className="row">
              {[['Д', 'Да'], ['Н', 'Не']].map(([v, l]) => <label key={v} className="rb"><input type="radio" checked={(d.data.saldo || 'Н') === v} onChange={() => setData({ saldo: v! })} /> {l}</label>)}</div></fieldset>
            {pf('memo', 'Белешки')}
          </div>
        </div>
          <label className="chk"><input type="checkbox" checked={d.art32} onChange={(e) => set({ art32: e.target.checked })} /> Градежна фактура по <b>член 32-а</b> — ДДВ пресметувам јас како примател</label>
          <label className="chk"><input type="checkbox" checked={d.noDed} onChange={(e) => set({ noDed: e.target.checked })} /> Без одбивање на претходен ДДВ (туристичка агенција, чл. 38)</label>
        </div>
        <div className="fpane" hidden={tab !== 'dev'}>
          {d.imp && <><label className="drop drop-sm" style={{ display: 'block', cursor: 'pointer' }} onClick={() => impRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void readImport([...e.dataTransfer.files]); }}>
            <b>Прочитај ги документите за увоз од PDF</b> — повлечете ги сите заедно: фактура од странскиот добавувач, ЕЦД (царинска декларација), фактура за шпедиција, транспорт или друг трошок. Програмот сам препознава кој документ е и ги пополнува полињата.</label>
            <input ref={impRef} type="file" hidden multiple accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void readImport(f); }} />
            {reading.some((r) => r.kind === 'imp') && <div className="note"><span className="pill info">се читаат документите за увоз…</span></div>}</>}
          <div className={d.imp ? 'devgrid' : ''}><div>
            {d.imp && <fieldset className="fs"><legend>Девизна фактура од добавувач</legend><div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
              <label className="mini">Износ во девизи<input type="number" step="any" value={d.data.fxAmt ?? ''} style={{ width: 140, textAlign: 'right' }} onChange={(e) => setData({ fxAmt: e.target.value })} /></label>
              <label className="mini">Валута<select value={d.currency} style={{ width: 'auto' }} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.filter((c) => c !== 'MKD').map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="mini">Курс (НБРСМ)<input type="number" step="any" value={d.fx} placeholder="внеси курс" style={{ width: 110, textAlign: 'right', borderColor: n(d.fx) > 0 ? undefined : 'var(--bad)' }} onChange={(e) => set({ fx: e.target.value })} /></label>
              <label className="mini">Ознака<input value={d.data.fxMark ?? ''} style={{ width: 80 }} onChange={(e) => setData({ fxMark: e.target.value })} /></label>
              <label className="mini">Увоз (ЕЦД бр.)<input value={d.data.ecd ?? ''} style={{ width: 130 }} onChange={(e) => setData({ ecd: e.target.value })} /></label>
              <label className="mini">Конто добавувач<select value={d.supplierAccount || '2210'} style={{ width: 'auto' }} onChange={(e) => set({ supplierAccount: e.target.value })}>{kontoOpts(d.supplierAccount || '2210', (k) => /^22/.test(k))}</select></label>
              <button type="button" className="btn sm" onClick={fxToDen}>= {fmt(fxTot)} ден. → во книжење</button></div>
              <p className="note" style={{ margin: '6px 0 0' }}>Износот во девизи × курс се пренесува во „Книжење“ (стоки {tk.goods}, без ДДВ). Добавувачот се книжи на {d.supplierAccount || '2210'}.</p></fieldset>}
            <h3 className="fh">Зависни трошоци (документ слика)</h3>
            {visibleCosts.map(([k, nm]) => {
              const c = d.costs[k] ?? blankCost();
              return (
                <div key={k} className="costb">
                  <div className="cb1"><b>{nm}</b>
                    <input type="number" step="any" value={c.amount} aria-label={nm + ' износ'} style={{ textAlign: 'right' }} onChange={(e) => setC(k, { amount: e.target.value })} />
                    <input value={c.doc} placeholder="документ" aria-label="Документ" onChange={(e) => setC(k, { doc: e.target.value })} />
                    {k === 'dev' && <label className="mini">Курс <input type="number" step="any" value={c.fx} style={{ width: 90, textAlign: 'right' }} aria-label="Курс" onChange={(e) => setC(k, { fx: e.target.value })} /></label>}
                    <label className="mini">Датум <input type="date" value={c.date} aria-label="Датум" onChange={(e) => setC(k, { date: e.target.value })} /></label>
                    <label className="mini">Валута <input type="date" value={c.due} aria-label="Валута" onChange={(e) => setC(k, { due: e.target.value })} /></label>
                  </div>
                  <div className="cb2">
                    <label className="mini" style={{ flex: 1 }}>Комитент <select value={c.partnerId} onChange={(e) => setC(k, { partnerId: e.target.value })}>{pOpts}</select></label>
                    <label className="mini"><input type="checkbox" checked={c.foreign} onChange={(e) => setC(k, { foreign: e.target.checked })} /> странски</label>
                    {k !== 'dev' && <div className="vatl">{c.lines.slice(0, k === 'car' ? 3 : 1).map((l, i) => (
                      <span key={i} className="mini">{k === 'car' ? 'Основица ДДВ' : 'ДДВ основица'}{' '}
                        <input type="number" step="any" value={l.base} style={{ width: 110, textAlign: 'right' }} aria-label="Основица" onChange={(e) => setC(k, { lines: c.lines.map((x, j) => (j === i ? { ...x, base: e.target.value, vat: String(r2((n(e.target.value) * n(x.rate)) / 100)) } : x)) })} />{' '}
                        <select value={l.rate} style={{ width: 'auto' }} onChange={(e) => setC(k, { lines: c.lines.map((x, j) => (j === i ? { ...x, rate: e.target.value, vat: String(r2((n(x.base) * n(e.target.value)) / 100)) } : x)) })}>{RATES.map((r) => <option key={r}>{r}</option>)}</select>% ДДВ{' '}
                        <input type="number" step="any" value={l.vat} style={{ width: 100, textAlign: 'right' }} aria-label="ДДВ" onChange={(e) => setC(k, { lines: c.lines.map((x, j) => (j === i ? { ...x, vat: e.target.value } : x)) })} />
                      </span>))}</div>}
                  </div>
                  {k === 'trans' && <label className="chk"><input type="checkbox" checked={c.byQty} onChange={(e) => setC(k, { byQty: e.target.checked })} /> Распоред на транспортни трошоци по количини</label>}
                </div>);
            })}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 20 }}><span>Вкупно трошоци без ДДВ: <b className="num">{fmt(totC)}</b></span><span>ДДВ на трошоци: <b className="num">{fmt(totV)}</b></span></div>
            <p className="note">Трошоците без ДДВ се распоредуваат на артиклите во приемницата пропорционално на вредноста (транспортот и по количини). {d.imp ? 'ДДВ платен на царина оди во полињата 27/28 на ДДВ-04 (увоз); ДДВ на останатите трошоци во 21/22.' : 'ДДВ на трошоците оди во полињата 21/22 на ДДВ-04.'}</p>
          </div>{d.imp && <div>
            <fieldset className="fs"><legend>Царински наименувања без ДДВ</legend>
              {Array.from({ length: 15 }, (_, i) => <label key={i} className="fl" style={{ gridTemplateColumns: '90px 1fr' }}><span>Наимен. {i + 1}</span><input type="number" step="any" value={d.cnames[i] ?? ''} style={{ textAlign: 'right' }}
                onChange={(e) => { const c = [...d.cnames]; while (c.length < 15) c.push(''); c[i] = e.target.value; set({ cnames: c }); }} /></label>)}
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Вкупно: <b className="num">{fmt(cnSum)}</b></span><button type="button" className="btn sm" onClick={cnToCar}>Префрли сума → основица на царина</button></div>
            </fieldset>
            <label className="mini">Распоред на царина <select value={d.distMode} style={{ width: 'auto' }} onChange={(e) => set({ distMode: e.target.value as EdPurchase['distMode'] })}>
              <option value="val">по вредност</option><option value="cn">по царински наименувања</option><option value="multi">по наименувања (царина и ДДВ)</option></select></label>
          </div>}</div>
        </div>
        <div className="fpane" hidden={tab !== 'dop'}><div className="igrid">
          <fieldset className="fs"><legend>Параметри за финансово книжење</legend>{pf('grp1', 'Група 1')}{pf('grp2', 'Група 2')}
            <label className="fl"><span>Тип на трошок</span><select value={d.data.costType ?? ''} onChange={(e) => setData({ costType: e.target.value })}>{['', 'Материјален', 'Нематеријален', 'Транспорт', 'Услуга'].map((o) => <option key={o}>{o}</option>)}</select></label></fieldset>
          <fieldset className="fs"><legend>Податоци за доставувач</legend>{pf('driver', 'Шофер')}{pf('truck', 'Камион')}{pf('trailer', 'Приколка')}</fieldset>
        </div></div>
      </div>

      <div className="card"><div className="hd"><h2>Прикачени документи</h2>{p.firmId && <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>+ Прикачи PDF или слика</button>}</div>
        <input ref={fileRef} type="file" hidden accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach(f); }} />
        {files.filter((f) => d.fileIds.includes(f.id)).length ? <div className="row">{files.filter((f) => d.fileIds.includes(f.id)).map((f) => (
          <span key={f.id} className="row" style={{ gap: 4 }}><a className="pill info" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">📎 {f.name}</a>
            <button type="button" className="btn sm" disabled={reading.length > 0} onClick={() => void readFile(f.id)}>Прочитај ги податоците</button>
            <button type="button" className="btn sm ghost danger" aria-label="Отстрани документ" onClick={() => { set({ fileIds: d.fileIds.filter((x) => x !== f.id) }); setToast('Документот е отстранет од фактурата. Зачувајте ја фактурата.'); }}>✕</button></span>))}</div>
          : <p className="note">Нема прикачен документ. Прикачете го оригиналот (PDF или слика) за евиденција.</p>}
        {reading.some((r) => r.kind === 'pur') && <div className="note"><span className="pill info">Се чита документот… (10–60 секунди)</span></div>}
      </div>

      <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}><b>Вид на фактура:</b>
        <button type="button" className={'btn sm' + (d.ptype === 'stock' ? ' pri' : '')} onClick={() => set({ ptype: 'stock' })}>Со приемница / калкулација (стока на залиха)</button>
        <button type="button" className={'btn sm' + (d.ptype === 'cost' ? ' pri' : '')} onClick={() => set({ ptype: 'cost' })}>Директен трошок (без артикли)</button>
        <span className="note">{d.ptype === 'cost' ? 'Услуги, струја, телефон, закупнина, гориво, канцелариски… – се книжи само на конто трошок + ДДВ, без приемница и калкулација.' : 'Стоката влегува на залиха во објектот и се прави калкулација (ПЛТ).'}</span></div>

      <h2>Книжење</h2>
      {check && (check.ok
        ? <div className="callout good" style={{ margin: '4px 0' }}>Контрола: ставките по стапки се совпаѓаат со книжењето ({check.rates.map((r) => r + '%: ' + fmt(check.G[r] ?? 0)).join(' · ')}).</div>
        : <div className="callout warn" style={{ margin: '4px 0' }}>Контрола: ставките не се совпаѓаат со книжењето – {check.rates.map((r) => `${r}%: ставки ${fmt(check.by[r] ?? 0)} / книжење ${fmt(check.G[r] ?? 0)}`).join(' · ')}. Проверете ја стапката на ДДВ кај артиклите или <button type="button" className="btn sm" onClick={groupsFromStock}>пресметај го книжењето од ставките</button></div>)}
      <div className="tw"><table><thead><tr><th>Конто</th><th>Стапка</th><th className="n">Основица</th><th className="n">ДДВ</th><th></th></tr></thead><tbody>
        {d.groups.map((g, i) => (
          <tr key={i}>
            <td><select value={g.account} onChange={(e) => setG(i, { account: e.target.value })}>{kontoOpts(g.account)}</select></td>
            <td><select value={g.rate} onChange={(e) => setG(i, { rate: e.target.value, ...(d.art32 ? {} : { vat: String(r2((n(g.base) * n(e.target.value)) / 100)) }) })}>{RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
            <td><input type="number" step="any" value={g.base} style={{ textAlign: 'right' }} onChange={(e) => setG(i, { base: e.target.value, ...(d.art32 ? {} : { vat: String(r2((n(e.target.value) * n(g.rate)) / 100)) }) })} /></td>
            <td>{d.art32 ? <span className="num">{fmt((n(g.base) * (n(g.rate) || 18)) / 100)}</span> : <input type="number" step="any" value={g.vat} style={{ textAlign: 'right' }} onChange={(e) => setG(i, { vat: e.target.value })} />}</td>
            <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => set({ groups: d.groups.filter((_, k) => k !== i) })}>✕</button></td>
          </tr>))}
      </tbody><tfoot><tr><td colSpan={2}>Вкупно {fmt(gBase + gVat)}</td><td className="n">{fmt(gBase)}</td><td className="n">{fmt(gVat)}</td><td /></tr></tfoot></table></div>
      <div className="row"><button type="button" className="btn" onClick={() => set({ groups: [...d.groups, { account: '4000', rate: '18', base: '', vat: '' }] })}>+ Ред</button></div>

      {d.ptype === 'stock' && <>
        <h2>Приемница</h2>
        <label className="f" style={{ maxWidth: 360 }}>Прием во објект<select value={d.warehouseId} onChange={(e) => set({ warehouseId: e.target.value, ...(d.id ? {} : { calcNo: '' }) })}><option value="">01 Главен магацин</option>{p.locations.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
        {missing.length > 0 && <div className="callout warn">{missing.length} артикли од фактурата ги нема во шифрарникот ({missing.slice(0, 4).map((s) => s.name).join(', ')}{missing.length > 4 ? '…' : ''}). <button type="button" className="btn sm pri" onClick={createMissing}>Додај ги во шифрарник</button> – или ќе се додадат автоматски при зачувување.</div>}
        <p className="note">Артикли што влегуваат на залиха (стоки, суровини). За нив изберете конто {tk.material}/{tk.goods} погоре за да не одат во трошок.</p>
        {d.stock.length > 0 && <div className="card calcbar"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" title="F5" onClick={() => distBy(d.distMode === 'val' ? 'val' : d.distMode, 'Трошоците ({t}) се распоредени на артиклите. Можете рачно да ги измените.')}>Распоред на трошоци (F5)</button>
          {d.imp && <>
            <button type="button" className="btn sm" title="F6" onClick={() => setToast('ДДВ од царина е распореден по артикли.')}>Распоред на данок од царина (F6)</button>
            <button type="button" className="btn sm" onClick={() => distBy('cn', 'Царината е распоредена по царински наименувања (изберете наименување за секој артикл во колоната „Цар. наимен.“).')}>Пропорц. распоред по разл. царински стапки</button>
            <button type="button" className="btn sm" onClick={() => distBy('multi', 'Царината и ДДВ од царина се распоредени по повеќе наименувања.')}>Распоред по повеќе наименувања</button></>}
          {d.stock.some((s) => s.dep !== '') && <button type="button" className="btn sm" onClick={() => set({ stock: d.stock.map((s) => ({ ...s, dep: '' })) })}>Автоматски распоред</button>}
          <button type="button" className="btn sm" onClick={calcTot}>Вкупно</button>
          <span className="mini" style={{ marginLeft: 8 }}>Разлика во цена за сите:</span>
          {[10, 15, 20, 25, 30, 40, 50].map((v) => <button key={v} type="button" className={'btn sm' + (p.defMargin === v ? ' pri' : '')} onClick={() => applyMargin(v)}>{v}%</button>)}
          <input type="number" step="any" placeholder="%" style={{ width: 64 }} aria-label="Друг процент" value={mgCustom} onChange={(e) => setMgCustom(e.target.value)} />
          <button type="button" className="btn sm" onClick={() => { if (mgCustom === '') { setToast('Внесете процент.'); return; } applyMargin(n(mgCustom)); }}>Примени</button>
          <label className="mini">Заокружи <select value={mgRound} style={{ width: 'auto' }} onChange={(e) => setMgRound(e.target.value)}>{[['1', 'на цел денар'], ['0.5', 'на 0,50'], ['10', 'на 10 ден.'], ['0.01', 'без']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <span style={{ flex: 1 }} />
          {d.id ? <>
            <a className="btn sm pri" href={`/print/kalk/${d.id}`} target="_blank" rel="noreferrer" title="F2">Печати калкулација (F2)</a>
            <a className="btn sm" href={`/print/kalk/${d.id}?t=plt`} target="_blank" rel="noreferrer" title="F3">Приемен лист (F3)</a>
            <a className="btn sm" href={`/print/kalk/${d.id}?t=priem${d.data.withVat ? '&vat=1' : ''}`} target="_blank" rel="noreferrer">Приемница</a></>
            : <span className="mini">Калкулација, приемен лист и приемница – по зачувување</span>}
          <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={!!d.data.withVat} onChange={(e) => setData({ withVat: e.target.checked ? '1' : '' })} /> Со данок</label>
        </div>{AL.manual && Math.abs(aSum - AL.tot) > 0.5 && <div className="callout warn" style={{ marginTop: 8 }}>Распоредените трошоци ({fmt(aSum)}) не се еднакви на вкупните трошоци ({fmt(AL.tot)}). Притиснете „Распоред на трошоци (F5)“ повторно.</div>}</div>}
        <div className="tw"><table><thead><tr><th>Артикл</th><th>Ед. мерка</th>{cnUsed.length > 0 && <th>Цар. наимен.</th>}<th className="n">Количина</th><th className="n">{d.imp ? 'Цена во ' + d.currency : 'Набавна цена / ед.'}</th><th className="n">Рабат %</th><th className="n">Вредност ден.</th><th className="n">Зависни трошоци</th><th className="n">Набавна цена / ед.</th>{d.imp && <th className="n">ДДВ царина</th>}<th className="n">{store ? 'Малопр. цена со ДДВ' : 'Продажна цена со ДДВ'}</th><th className="n">Разлика %</th><th></th></tr></thead><tbody>
          {d.stock.map((s, i) => {
            const it = s.itemId ? itemById.get(s.itemId) : undefined;
            const v = stockLineValue(P, P.stock[i]!), a = AL.by[i] ?? 0, nab = n(s.qty) ? (v + a) / n(s.qty) : 0;
            const rate = lineRate(s);
            const spv = s.sp !== '' ? n(s.sp) : it ? (it.sp[W] ?? r2(it.price * (1 + rate / 100))) : 0;
            const net = spv / (1 + rate / 100);
            const mg = nab && net ? ((net - nab) / nab) * 100 : null;
            return (
              <tr key={i}>
                <td><select value={s.itemId} style={{ minWidth: 230 }} onChange={(e) => { const x = itemById.get(e.target.value); setS(i, { itemId: e.target.value, ...(x ? { type: x.type } : {}) }); }}>
                  <option value="">— {s.name || 'избери'} —{!s.itemId && s.name ? ' (нов)' : ''}</option>
                  {stockItems.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name}</option>)}</select>
                  {!s.itemId && <input value={s.name} placeholder="или назив на нов артикл" onChange={(e) => setS(i, { name: e.target.value })} style={{ marginTop: 3 }} />}
                  <br /><select value={s.type || it?.type || 'goods'} className="stype" title="Вид – на кое конто оди" style={{ width: 'auto', marginTop: 3, fontSize: 12, padding: '2px 4px' }} onChange={(e) => setS(i, { type: e.target.value })}>
                    <option value="goods">Стока за продажба → {tk.goods}</option><option value="material">Суровина / материјал → {tk.material}</option><option value="product">Готов производ → {tk.product}</option></select>
                  {(s.code || s.barcode) && <><br /><small className="note">шифра доб.: {s.code || '—'}{s.barcode && ' · баркод ' + s.barcode}{it && ' · наша: ' + (it.code ?? '')}</small></>}</td>
                <td>{it ? it.unit : <input value={s.unit} style={{ width: 64 }} onChange={(e) => setS(i, { unit: e.target.value })} />}</td>
                {cnUsed.length > 0 && <td><select value={s.cn} style={{ width: 'auto' }} onChange={(e) => setS(i, { cn: e.target.value })}><option value="">—</option>{cnUsed.map(([k]) => <option key={k} value={k}>{k + 1}</option>)}</select></td>}
                <td><input type="number" step="any" value={s.qty} style={{ textAlign: 'right', width: 90 }} onChange={(e) => {
                  const q = e.target.value;
                  if (n(s.amount) && n(q)) {
                    const pr = Math.round((n(s.amount) / n(q)) * 1e4) / 1e4;
                    const rd = n(mgRound) || 1;
                    setS(i, { qty: q, price: String(pr), ...(s.isNew ? { sp: String(r2(Math.round((pr * (1 + p.defMargin / 100) * (1 + (n(s.rate) || 18) / 100)) / rd) * rd)) } : {}) });
                    setToast('Цената по единица е пресметана одново од износот на редот: ' + fmt(pr));
                  } else setS(i, { qty: q });
                }} /></td>
                <td><input type="number" step="any" value={s.price} style={{ textAlign: 'right', width: 110 }} onChange={(e) => setS(i, { price: e.target.value })} /></td>
                <td><input type="number" step="any" value={s.rab} style={{ textAlign: 'right', width: 70 }} onChange={(e) => setS(i, { rab: e.target.value })} /></td>
                <td className="n">{fmt(v)}</td>
                <td className="n">{AL.manual ? <input type="number" step="any" value={s.dep} style={{ textAlign: 'right', width: 110 }} onChange={(e) => setS(i, { dep: e.target.value })} /> : fmt(a)}</td>
                <td className="n">{n(s.qty) ? nab.toFixed(4) : '—'}</td>
                {d.imp && <td className="n">{fmt(AL.cvat[i] ?? 0)}</td>}
                <td><input type="number" step="any" value={s.sp !== '' ? s.sp : spv ? String(spv) : ''} style={{ textAlign: 'right', width: 110 }} title={'Се зачувува како нова цена за ' + (p.locations.find((l) => l.id === d.warehouseId)?.name ?? 'Главен магацин')} onChange={(e) => setS(i, { sp: e.target.value })} /></td>
                <td className="n">{mg == null ? '—' : mg.toFixed(2)}</td>
                <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => set({ stock: d.stock.filter((_, k) => k !== i) })}>✕</button></td>
              </tr>);
          })}
        </tbody><tfoot><tr><td colSpan={cnUsed.length ? 6 : 5}>Вкупно</td><td className="n">{fmt(P.stock.reduce((t, s) => t + stockLineValue(P, s), 0))}</td><td className="n">{fmt(aSum)}</td><td />{d.imp && <td className="n">{fmt(AL.cvat.reduce((a, b) => a + b, 0))}</td>}<td colSpan={3} /></tr></tfoot></table></div>
        {d.stock.length > 0 && <p className="note">Автоматски распоред: трошоците по вредност (транспортот по количини ако е означено). Со „Распоред на трошоци (F5)“ износите се префрлаат во редовите и можете рачно да ги измените. Продажната цена со ДДВ се зачувува за {p.locations.find((l) => l.id === d.warehouseId)?.name ?? 'Главен магацин'}{store ? ' (ако е различна од тековната, автоматски се прави нивелација)' : ''}.</p>}
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => set({ stock: [...d.stock, blankStock()] })}>+ Артикл на залиха</button>
          <input ref={bcRef} value={bc} placeholder="📷 Скенирај баркод / шифра + Enter (секое скенирање = +1)" style={{ width: 340 }} autoComplete="off" onChange={(e) => setBc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } }} />
          <span className="mini">Непознат баркод → нов ред; баркодот се запишува на артиклот што ќе го изберете.</span>
        </div>
      </>}
      {p.nonVat && <div className="note">Фирмата не е ДДВ обврзник: ДДВ влегува во трошокот и не се одбива.</div>}
    </form>
  );
}
