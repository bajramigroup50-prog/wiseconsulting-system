'use client';
/**
 * Invoice / credit note / proforma / dispatch editor — legacy `invEditor` 4140 → 14299, `invHeader` 4077, `qaBar` 4162,
 * `totBox` 4183, `readInvForm` 4186 (one React state instead of the global DOM listeners).
 * FIX (LEGACY-MAP 3.4 item 17): legacy's SELECT change handler recomputed the totals without the advances
 * (`totBox(...)` without `d`); here the totals box always includes them.
 */
import Link from 'next/link';
import { useActionState, useMemo, useRef, useState, useTransition } from 'react';
import {
  addDays, CURRENCIES, creditGrossLines, DT, fuelInvoiceCheck, invoiceTotals, PARITY, PAYM, PTERMS, type DtKey,
} from '@wise/core/sales';
import type { FuelRule } from '@wise/core/law';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { saveInvoiceAction, setSvcOnlyAction } from '@/app/(app)/izlez/actions';
import { blankLine, type EdInvoice, type EdLine } from './model';
import { ProdPanel, type ProdState } from './prod-panel';
import type { ProdBom } from '@wise/core/sales';

export interface InvItemOpt { id: string; code: string | null; name: string; unit: string | null; price: number; rate: number; type: string; account: string | null; barcodes: string[]; sp: Record<string, number> }
export interface RefInvoice { id: string; number: string; date: string; partnerId: string | null; total: number; art32: boolean; export: boolean; lines: EdLine[];
  /** Other credit notes on this invoice (legacy `crOthers`): numbers, credited total and returned qty per item. */
  others?: { numbers: string[]; total: number; returned: Record<string, number> } }
export interface AdvanceOpt { id: string; number: string; date: string; partnerId: string | null; base: number; used: number; art32: boolean; lines: EdLine[] }

export interface InvoiceEditorProps {
  initial: EdInvoice;
  title: string;
  sub?: string;
  partners: { id: string; code: string | null; name: string; edb: string | null }[];
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
  nalogNo?: string | null;
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
}
export interface InvoiceProdRun { wh: string | null; extra: number; saveBom: boolean; lines: { lineNo: number; productId: string; qty: number; materials: { itemId: string; qty: number }[] }[]; orders: { id: string; number: string; productId: string }[] }

const RATES = ['18', '10', '5', '0'];
const toItems = (L: readonly EdLine[]) => L.map((l) => ({ qty: Number(l.qty) || 0, price: Number(l.price) || 0, disc: Number(l.disc) || 0, rate: Number(l.rate) || 0, konto: l.account }));
const d0svc = (x: EdInvoice) => x.kind === 'invoice' && x.svc;
const lineAmt = (l: EdLine) => (Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.disc) || 0) / 100);

export function InvoiceEditor(p: InvoiceEditorProps) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveInvoiceAction, {});
  const [d, setD] = useState<EdInvoice>(p.initial);
  const [tab, setTab] = useState<'osn' | 'dop' | 'pos'>('osn');
  const [qa, setQa] = useState({ q: '', sel: '' as string, qty: '1', i: 0 });
  const [toast, setToast] = useState('');
  const [prod, setProd] = useState<ProdState>(() => ({
    wh: p.prodRun?.wh ?? '', extra: p.prodRun?.extra ? String(p.prodRun.extra) : '', saveBom: !!p.prodRun?.saveBom,
    lines: (p.prodRun?.lines ?? []).map((l) => ({ ...l, marked: p.items.find((i) => i.id === l.productId)?.type !== 'product', materials: l.materials.map((m) => ({ itemId: m.itemId, qty: String(m.qty) })) })),
  }));
  const [svcOnly, setSvcOnly] = useState(!!p.svcOnly);
  const [, startT] = useTransition();
  const qaRef = useRef<HTMLInputElement>(null), qtyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const svcMode = svcOnly || d0svc(p.initial);
  const set = (x: Partial<EdInvoice>) => setD((o) => ({ ...o, ...x }));
  const setData = (k: string, v: string) => setD((o) => ({ ...o, data: { ...o.data, [k]: v } }));
  const setLine = (i: number, x: Partial<EdLine>) => setD((o) => ({ ...o, lines: o.lines.map((l, k) => (k === i ? { ...l, ...x } : l)) }));
  const dt: DtKey = d.kind === 'invoice' && d.svc ? 'service' : d.kind;
  const isInv = d.kind === 'invoice';
  const W = d.warehouseId || 'main';
  const stockOf = (id: string): number | undefined => { const t = itemById.get(id)?.type; return t && t !== 'service' ? p.stock[id]?.[W] ?? 0 : undefined; };
  const itemById = useMemo(() => new Map(p.items.map((i) => [i.id, i])), [p.items]);
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

  const qaList = useMemo(() => {
    const q = qa.q.toLowerCase().trim();
    if (!q || qa.sel) return [];
    const ex = p.items.filter((i) => i.barcodes.includes(q) || (i.code ?? '').toLowerCase() === q);
    if (ex.length) return ex;
    return p.items.filter((i) => (i.code ?? '').toLowerCase().startsWith(q) || i.barcodes.some((b) => b.includes(q)) || i.name.toLowerCase().includes(q)).slice(0, 10);
  }, [qa.q, qa.sel, p.items]);
  const qaAdd = () => {
    const it = itemById.get(qa.sel);
    const q = Number(qa.qty.replace(',', '.')) || 0;
    if (!it) { setToast('Изберете артикл од листата.'); return; }
    if (!q) { setToast('Внесете количина.'); return; }
    const sq = stockOf(it.id);
    if (sq != null && d.kind !== 'proforma' && q > sq + 1e-9) setToast('Внимание: на залиха има само ' + fq(sq) + ' ' + (it.unit ?? ''));
    setD((o) => {
      const L = [...o.lines];
      const ex = L.findIndex((l) => l.itemId === it.id && !Number(l.disc));
      if (ex >= 0) L[ex] = { ...L[ex]!, qty: String(Math.round(((Number(L[ex]!.qty) || 0) + q) * 1e4) / 1e4) };
      else {
        const row = { ...blankLine(p.revDefault), ...fromItem(it), qty: String(q) } as EdLine;
        const e0 = L.findIndex((l) => !l.itemId && !l.name.trim() && !Number(l.price));
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
    const e0 = L.findIndex((l) => !l.itemId && !l.name.trim() && !Number(l.price));
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
    if ((d.kind === 'invoice' || d.kind === 'dispatch') && !d.fromDocId) {
      const need = new Map<string, number>();
      for (const l of d.lines) if (l.itemId && stockOf(l.itemId) != null && itemById.get(l.itemId)?.type !== 'material') need.set(l.itemId, (need.get(l.itemId) ?? 0) + (Number(l.qty) || 0));
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

  return (
    <form action={action} ref={formRef} onSubmit={beforeSave}>
      <input type="hidden" name="payload" value={JSON.stringify({ ...d, back: p.back, production: isInv && d.data.prod === 'Д' ? {
        wh: prod.wh || null, extra: prod.extra || '0', saveBom: prod.saveBom,
        lines: prod.lines.map((l) => ({ lineNo: l.lineNo, productId: l.productId, qty: String(l.qty), materials: l.materials.filter((m) => m.itemId && Number(m.qty) > 0) })).filter((l) => l.materials.length),
      } : null })} />
      <div className="hd">
        <h1>{p.title}{p.sub && <span className="mk">{p.sub}</span>}</h1>
        <div className="row"><Link className="btn" href={p.back}>Откажи</Link><button className="btn pri" disabled={pending}>{saveLbl}</button></div>
      </div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {toast && <div className="callout info" role="status" onClick={() => setToast('')}>{toast}</div>}
      {p.scanInfo && <div className="callout good">{p.scanInfo}</div>}
      {d.status === 'pending' && <div className="callout warn">Внесено од клиентот – чека одобрување (не е прокнижено).</div>}
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
              <label className="fl b"><span>{d.kind === 'proforma' ? 'Профактура бр.' : d.kind === 'dispatch' ? 'Испратница бр.' : 'Калкулација / фактура бр.'}</span><input value={d.number} onChange={(e) => set({ number: e.target.value })} /></label>
              {I('oe', 'Орг. ед. (ОЕ)', { w: 120 })}
              <label className="fl"><span>Налог</span><input value={p.nalogNo ? 'бр. ' + p.nalogNo : 'се доделува при зачувување'} disabled /></label>
              <label className="fl b"><span>Комитент</span><select value={d.partnerId} onChange={(e) => set({ partnerId: e.target.value, ...(d.kind === 'credit' ? { refInvoiceId: '' } : {}) })}>{pOpts}</select></label>
              <label className="fl"><span>Комитент носител</span><select value={d.data.payerId ?? ''} onChange={(e) => setData('payerId', e.target.value)}>{pOpts}</select></label>
              <label className="fl b"><span>Датум</span><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value, ...(d.data.days ? { due: addDays(e.target.value, d.data.days) } : {}) })} /></label>
              {d.kind !== 'dispatch' && <label className="fl"><span>{d.kind === 'proforma' ? 'Важи до' : 'Валута (рок на плаќање)'}</span><input type="date" value={d.due} onChange={(e) => set({ due: e.target.value })} /></label>}
              {d.kind !== 'dispatch' && (
                <label className="fl"><span>Рок за наплата</span><div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="number" min={0} value={d.data.days ?? ''} style={{ maxWidth: 90 }} onChange={(e) => setD((o) => ({ ...o, data: { ...o.data, days: e.target.value }, due: e.target.value !== '' ? addDays(o.date, e.target.value) : o.due }))} />
                  <small className="note">дена од датумот</small></div></label>
              )}
              {I('refDoc', 'По документ (бр. нарачка / ф-ра)', { b: true })}
              {isInv && <label className="fl"><span>Дат. на испорака (промет)</span><input type="date" value={d.pdate || d.date} onChange={(e) => set({ pdate: e.target.value })} /></label>}
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
                <select value={d.currency} style={{ maxWidth: 90 }} onChange={(e) => set({ currency: e.target.value, ...(e.target.value === 'MKD' ? { fx: '1' } : {}) })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                <input type="number" step="any" value={d.fx} style={{ maxWidth: 110 }} aria-label="Курс" disabled={d.currency === 'MKD'} onChange={(e) => set({ fx: e.target.value })} />
              </div></div>
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
                <fieldset className="fs" style={{ flex: 1 }}><legend>Производство</legend><div className="row">{RB('prod', [['Н', 'Не'], ['Д', 'Да']], 'Н')}</div></fieldset>
              </div>
              {d.data.prod === 'Д' && I('prodCost', 'Трошоци за производство')}
              {d.data.prod === 'Д' && p.prodRun?.orders.map((o) => <Link key={o.id} className="btn sm" href="/prod">🏭 Налог за производство бр. {o.number}</Link>)}
            </div>
          </div>
          <label className="f" style={{ marginTop: 8 }}>Напомена<textarea rows={3} value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
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

      {d.kind !== 'dispatch' && <label className="chk"><input type="checkbox" checked={svcOnly} disabled={!p.canSettings} onChange={(e) => {
        const v = e.target.checked;
        setSvcOnly(v);
        startT(async () => { await setSvcOnlyAction(v); });
        setToast(v ? 'Фирмата е означена: само услуги.' : 'Брзото додавање артикли е вклучено.');
      }} /> Фирмата има <b>само услуги</b> (без производи) – ставките се пишуваат рачно</label>}
      {isInv && d.data.prod === 'Д' && <ProdPanel lines={d.lines} items={p.items} stock={p.stock} avg={p.avg ?? {}} boms={p.boms ?? {}} locations={p.locations}
        value={prod} onChange={setProd} orders={p.prodRun?.orders ?? []}
        onCost={(v) => setD((o) => (o.data.prodCost === v.toFixed(2) ? o : { ...o, data: { ...o.data, prodCost: v.toFixed(2) } }))} />}
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

      <datalist id="itemList">{p.items.map((i) => <option key={i.id} value={i.name}>{i.code ?? ''}</option>)}</datalist>
      <datalist id="svcItemList">{[...new Set([...(p.svcTexts ?? []), ...p.items.map((i) => i.name)])].map((x) => <option key={x} value={x} />)}</datalist>
      <div className="tw"><table><thead><tr><th style={{ minWidth: 200 }}>Артикл / опис</th><th>Ед. мерка</th><th className="n">Количина</th><th className="n">Цена без ДДВ{d.currency !== 'MKD' ? ' (' + d.currency + ')' : ''}</th><th className="n">Рабат %</th><th>ДДВ</th><th>Конто</th><th className="n">Износ</th><th></th></tr></thead><tbody>
        {d.lines.map((l, i) => {
          const it = l.itemId ? itemById.get(l.itemId) : undefined;
          const sq = it ? stockOf(it.id) : undefined;
          const tracked = it && sq != null;
          const over = tracked && Number(l.qty) > sq! + 1e-9 && d.kind !== 'proforma' && !d.fromDocId;
          return (
            <tr key={i}>
              <td><input value={l.name} list="svcItemList" style={{ minWidth: svcMode ? 380 : 260 }} placeholder={svcMode ? 'Напишете ја услугата, пр. Сметководствени услуги за месец …' : 'Артикл од листата или слободен опис на услуга'} onChange={(e) => {
                const v = e.target.value;
                const found = p.items.find((x) => x.name === v || (x.code && x.code === v.trim()));
                setLine(i, found ? fromItem(found) : { name: v, itemId: '' });
              }} />{tracked && <small className="note" style={over ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>на залиха во {loc?.name ?? 'Главен магацин'}: {fq(sq)} {it.unit ?? ''}{over ? ' – недоволно!' : ''}</small>}</td>
              <td><input value={l.unit} style={{ width: 64 }} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
              <td><input type="number" step="any" value={l.qty} style={{ width: 90, textAlign: 'right' }} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
              <td><input type="number" step="any" value={l.price} style={{ width: 110, textAlign: 'right' }} onChange={(e) => setLine(i, { price: e.target.value })} /></td>
              <td><input type="number" step="any" value={l.disc} style={{ width: 64, textAlign: 'right' }} onChange={(e) => setLine(i, { disc: e.target.value })} /></td>
              <td><select value={l.rate} disabled={d.art32 || d.export} onChange={(e) => setLine(i, { rate: e.target.value })}>{RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
              <td><select value={l.account || p.revDefault} className="wide" onChange={(e) => setLine(i, { account: e.target.value })}>
                {!p.accounts.some(([k]) => k === (l.account || p.revDefault)) && <option value={l.account || p.revDefault}>{l.account || p.revDefault}</option>}
                {p.accounts.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}</select></td>
              <td className="n">{fmt(lineAmt(l))}</td>
              <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани ред" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })}>✕</button></td>
            </tr>
          );
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
      {d.kind !== 'proforma' && <p className="note">Артиклите со залиха автоматски се раздолжуваат по просечна цена (Должи 7000/7010 – Побарува 6300/6600).</p>}
    </form>
  );
}
