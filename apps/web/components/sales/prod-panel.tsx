'use client';
/**
 * „🏭 производство“ of one sales invoice line (new; legacy had only a free „Трошоци за производство“ field). The
 * sub-panel under a marked line pulls the reproduction materials: the proposal from the product's normativ ×
 * quantity, or materials picked from stock (search with stock on hand, average cost and shortage), the materials
 * warehouse, extra costs (labour, energy…) and „зачувај како норматив“, with the live calculation: materials + extra =
 * cost of production, unit cost, sale price, margin and a warning when selling below cost. A line that is still free
 * text gets „+ Креирај производ“. On save the server makes one production order per produced line before the
 * invoice issues the product (`sales/invoice-production.ts`).
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { bomMaterials, lineProdCalc, materialRows, parseQuickMaterial, searchStockMaterials, type LineProdCalc, type ProdBom } from '@wise/core/sales';
import { fmt, fq } from '@/lib/fmt';
import type { EdLine, EdLineProd } from './model';
import type { InvItemOpt } from './invoice-editor';

type Stock = Record<string, Record<string, number>>;

/** Materials value (average cost at the line's materials warehouse) and the calculation of a produced line. */
export function lineCalc(l: EdLine, stock: Stock, avg: Stock, fx: number): LineProdCalc & { short: boolean } {
  const W = l.prod?.wh || 'main';
  const R = materialRows((l.prod?.materials ?? []).filter((m) => m.itemId).map((m) => ({ itemId: m.itemId, qty: Number(m.qty) || 0 })), (id) => ({ qty: stock[id]?.[W] ?? 0, avg: avg[id]?.[W] ?? 0 }));
  const sale = (Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.disc) || 0) / 100) * (fx || 1);
  return { ...lineProdCalc({ mat: R.value, extra: l.prod?.extra, qty: l.qty, sale }), short: R.rows.some((r) => r.short) };
}

/** Production state when a line is marked: the normativ × quantity when the product has one. */
export function startProd(l: EdLine, boms: Readonly<Record<string, ProdBom>>, wh: string): EdLineProd {
  const M = l.itemId ? bomMaterials(boms[l.itemId], l.qty) : [];
  return { wh, extra: '', saveBom: false, materials: M.map((m) => ({ itemId: m.itemId, qty: String(m.qty) })), fromBom: M.length > 0, open: true };
}

/** The line's quantity or product changed: materials that follow the normativ are proposed again. */
export function reProd(l: EdLine, boms: Readonly<Record<string, ProdBom>>, itemChanged = false): EdLine {
  if (!l.prod) return l;
  if (!l.prod.fromBom && !itemChanged) return l;
  const M = l.itemId ? bomMaterials(boms[l.itemId], l.qty) : [];
  if (!M.length && !itemChanged) return l;
  return { ...l, prod: { ...l.prod, materials: M.map((m) => ({ itemId: m.itemId, qty: String(m.qty) })), fromBom: M.length > 0 } };
}

export function LineProdPanel({ line, items, stock, avg, boms, locations, fx, cur, onChange, onCreate, creating, orderNo }: {
  line: EdLine; items: readonly InvItemOpt[]; stock: Stock; avg: Stock; boms: Readonly<Record<string, ProdBom>>;
  locations: { id: string; code: string | null; name: string }[]; fx: number; cur: string;
  onChange: (p: EdLineProd) => void;
  /** „+ Креирај производ“ (the line is free text or a service). */
  onCreate: () => void; creating: boolean;
  /** Production order made by the saved invoice for this line. */
  orderNo?: string | null;
}) {
  const P = line.prod!;
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const W = P.wh || 'main';
  const stockOf = (id: string) => ({ qty: stock[id]?.[W] ?? 0, avg: avg[id]?.[W] ?? 0 });
  const it = line.itemId ? itemById.get(line.itemId) : undefined;
  const isProduct = !!it && it.type !== 'service';
  const set = (x: Partial<EdLineProd>) => onChange({ ...P, ...x });
  const setMat = (j: number, x: Partial<EdLineProd['materials'][number]>) => set({ fromBom: false, materials: P.materials.map((m, k) => (k === j ? { ...m, ...x } : m)) });
  const R = materialRows(P.materials.map((m) => ({ itemId: m.itemId, qty: Number(m.qty) || 0 })), stockOf);
  const C = lineCalc(line, stock, avg, fx);
  const list = q.trim() ? searchStockMaterials(items, q, stockOf, line.itemId || null, 10) : [];
  const add = (id: string, qty = 1) => { set({ fromBom: false, materials: [...P.materials, { itemId: id, qty: String(qty) }] }); setQ(''); setHi(0); };
  const bom = line.itemId ? boms[line.itemId] : undefined;
  const find = (c: string) => items.find((i) => i.type !== 'service' && ((i.code ?? '') === c || i.barcodes.includes(c))) ?? null;

  if (!isProduct) {
    return (
      <div className="prodline" data-testid="prod-line">
        <p className="note" style={{ margin: 0 }}>
          {it ? <>„{it.name}“ е услуга – услуга не може да се произведува. </> : <>Ставката не е артикл од шифрарникот. </>}
          Креирајте го готовиот производ (тип <b>производ</b>, назив „{line.name.trim() || '…'}“, мерка {line.unit || 'ком'}) за да се заприми на залиха и да се продаде со фактурата.
        </p>
        <button type="button" className="btn sm pri" disabled={creating || !line.name.trim()} onClick={onCreate}>{creating ? 'Се креира…' : '+ Креирај производ'}</button>
      </div>
    );
  }

  return (
    <div className="prodline" data-testid="prod-line">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <b>🏭 Репроматеријали за „{it.name}“ · {fq(line.qty)} {it.unit ?? ''}</b>
        {bom ? <span className="pill info">има норматив</span> : <span className="pill warn">нема норматив – изберете материјали од залиха</span>}
        {orderNo && <Link className="pill info" href="/prod">Налог за производство бр. {orderNo}</Link>}
        <span style={{ flex: 1 }} />
        {bom && <button type="button" className="btn sm" onClick={() => { const M = bomMaterials(bom, line.qty); set({ materials: M.map((m) => ({ itemId: m.itemId, qty: String(m.qty) })), fromBom: true }); }}>⟲ Предлог од норматив × {fq(line.qty)}</button>}
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end', margin: '6px 0' }}>
        <label className="f" style={{ maxWidth: 260 }}>Материјали од објект<select value={P.wh} onChange={(e) => set({ wh: e.target.value })}><option value="">01 Главен магацин</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
        <label className="f" style={{ maxWidth: 200 }}>Дополнителни трошоци (труд, енергија…)<input type="number" step="any" min={0} value={P.extra} aria-label="Дополнителни трошоци" onChange={(e) => set({ extra: e.target.value })} style={{ textAlign: 'right' }} /></label>
        <label className="chk"><input type="checkbox" checked={P.saveBom} onChange={(e) => set({ saveBom: e.target.checked })} /> зачувај како норматив</label>
      </div>
      <div className="tw"><table className="dense"><thead><tr><th>Репроматеријал</th><th className="n">Количина</th><th className="n">На залиха</th><th className="n">Просечна цена</th><th className="n">Вредност</th><th /></tr></thead>
        <tbody>{P.materials.map((m, j) => {
          const r = R.rows[j]!;
          const mi = itemById.get(m.itemId);
          return <tr key={j} style={r.short ? { color: 'var(--bad)' } : undefined}>
            <td>{mi ? <>{mi.code ? <span className="num">{mi.code}</span> : null} {mi.name}</> : <span className="note">—</span>}</td>
            <td className="n"><input type="number" step="any" value={m.qty} aria-label="Количина материјал" style={{ width: 90, textAlign: 'right' }} onChange={(e) => setMat(j, { qty: e.target.value })} /> {mi?.unit ?? ''}</td>
            <td className="n">{fq(r.have)}{r.short ? ` – недостига ${fq(Math.round((r.qty - r.have) * 1e4) / 1e4)}` : ''}</td><td className="n">{fmt(r.avg)}</td><td className="n">{fmt(r.value)}</td>
            <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани материјал" onClick={() => set({ fromBom: false, materials: P.materials.filter((_, k) => k !== j) })}>✕</button></td>
          </tr>;
        })}
          {!P.materials.length && <tr><td colSpan={6} className="note">Нема репроматеријали – пребарајте подолу (шифра, баркод или назив) или земете го предлогот од нормативот.</td></tr>}
        </tbody></table></div>
      <div style={{ position: 'relative', maxWidth: 520, margin: '6px 0' }}>
        <input placeholder="🔍 Додај материјал од залиха – шифра, баркод или назив (или „шифра количина“ + Enter)" value={q} aria-label="Додај материјал од залиха" style={{ width: '100%' }}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, list.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
            else if (e.key === 'Escape') setQ('');
            else if (e.key === 'Enter') {
              e.preventDefault();
              const m = parseQuickMaterial(q, find);
              if (m && m.itemId !== line.itemId) { add(m.itemId, m.qty); return; }
              const x = list[hi];
              if (x) add(x.id);
            }
          }} />
        {list.length > 0 && <div className="qa-list">{list.map((x, k) => (
          <div key={x.id} className={'qa-it' + (k === hi ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); add(x.id); }}>
            <span className="num">{x.code}</span><b>{x.name}</b><span className="note" style={x.have <= 0 ? { color: 'var(--bad)' } : undefined}>залиха {fq(x.have)} {x.unit ?? ''} · ø {fmt(x.avg)}</span></div>))}</div>}
      </div>
      <div className="prodcalc" data-testid="prod-calc">
        <span>Материјали <b className="num">{fmt(C.mat)}</b></span>
        <span>+ дополнителни <b className="num">{fmt(C.extra)}</b></span>
        <span>= трошок на производство <b className="num">{fmt(C.cost)}</b></span>
        <span>по единица <b className="num">{fmt(C.unit)}</b></span>
        <span>продажна вредност <b className="num">{fmt(C.sale)}</b>{cur !== 'ден.' ? ' ден.' : ''}</span>
        <span style={C.margin < 0 ? { color: 'var(--bad)' } : undefined}>маржа <b className="num">{fmt(C.margin)}</b>{C.pct != null ? ` (${C.pct.toFixed(2)}%)` : ''}</span>
      </div>
      {C.below && <div className="callout bad" role="alert" style={{ margin: '6px 0 0' }}>⚠ Се продава под цената на чинење: трошок {fmt(C.cost)}, продажба {fmt(C.sale)} (загуба {fmt(-C.margin)}).</div>}
      {C.short && <div className="note" style={{ color: 'var(--bad)' }}>Недостига репроматеријал на залиха во избраниот објект – проверете ги приемите.</div>}
    </div>
  );
}
