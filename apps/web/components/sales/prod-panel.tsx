'use client';
/**
 * „Репроматеријали за производство“ — the sales invoice with „Производство = Да“ (new; legacy had only a free
 * „Трошоци за производство“ field). For every produced line (products, or items the user marks) the materials come
 * from the normativ (BOM × quantity) or are picked from stock (quick entry „шифра количина“), with stock on hand,
 * average cost and shortages in red. On save the server makes the production orders before the invoice issues the
 * product (`sales/invoice-production.ts`).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { materialRows, parseQuickMaterial, proposeMaterials, type ProdBom } from '@wise/core/sales';
import { fmt, fq } from '@/lib/fmt';
import type { EdLine } from './model';
import type { InvItemOpt } from './invoice-editor';

export interface ProdState {
  wh: string; extra: string; saveBom: boolean;
  lines: { lineNo: number; productId: string; qty: number; materials: { itemId: string; qty: string }[]; marked?: boolean }[];
}
export interface ProdOrderRef { id: string; number: string; productId: string }

export function ProdPanel({ lines, items, stock, avg, boms, locations, value, onChange, orders, onCost }: {
  lines: readonly EdLine[]; items: readonly InvItemOpt[];
  stock: Record<string, Record<string, number>>; avg: Record<string, Record<string, number>>;
  boms: Readonly<Record<string, ProdBom>>; locations: { id: string; code: string | null; name: string }[];
  value: ProdState; onChange: (v: ProdState) => void; orders: ProdOrderRef[];
  /** Materials value + extra → „Трошоци за производство“. */
  onCost: (v: number) => void;
}) {
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const W = value.wh || 'main';
  const [quick, setQuick] = useState<Record<number, string>>({});
  const stockOf = (id: string) => ({ qty: stock[id]?.[W] ?? 0, avg: avg[id]?.[W] ?? 0 });
  // keep one panel row per produced invoice line (products automatically, other items when marked)
  useEffect(() => {
    const marked = new Set(value.lines.filter((l) => l.marked).map((l) => l.lineNo));
    const P = proposeMaterials(lines.map((l, i) => ({ itemId: l.itemId, qty: l.qty, type: itemById.get(l.itemId)?.type, produced: marked.has(i) })), boms);
    const next = P.map((p) => {
      const old = value.lines.find((l) => l.lineNo === p.lineNo && l.productId === p.productId);
      if (old && old.qty === p.qty) return old;
      // a new line, or the quantity changed: BOM proposal (kept materials when there is no BOM)
      return { lineNo: p.lineNo, productId: p.productId, qty: p.qty, marked: marked.has(p.lineNo), materials: p.fromBom ? p.materials.map((m) => ({ itemId: m.itemId, qty: String(m.qty) })) : old?.materials ?? [] };
    });
    if (JSON.stringify(next) !== JSON.stringify(value.lines)) onChange({ ...value, lines: next });
  });
  const all = value.lines.flatMap((l) => l.materials.map((m) => ({ itemId: m.itemId, qty: Number(m.qty) || 0 }))).filter((m) => m.itemId);
  const tot = materialRows(all, stockOf);
  useEffect(() => { onCost(Math.round((tot.value + (Number(value.extra) || 0)) * 100) / 100); }, [tot.value, value.extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const setLine = (k: number, x: Partial<ProdState['lines'][number]>) => onChange({ ...value, lines: value.lines.map((l, i) => (i === k ? { ...l, ...x } : l)) });
  const mats = items.filter((i) => i.type !== 'service');
  const find = (c: string) => items.find((i) => (i.code ?? '') === c || i.barcodes.includes(c)) ?? items.find((i) => i.name.toLowerCase() === c.toLowerCase()) ?? null;
  const candidates = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.itemId && itemById.get(l.itemId)?.type !== 'service' && itemById.get(l.itemId)?.type !== 'product' && Number(l.qty) > 0);

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="hd"><h2>🏭 Репроматеријали за производство</h2>
        {orders.map((o) => <Link key={o.id} className="btn sm" href="/prod">🏭 Налог за производство бр. {o.number}</Link>)}</div>
      <p className="note">Продажбата се обработува во два чекора: (1) производство – репроматеријалите се раздолжуваат по просечна цена, готовиот производ се заприма по цената на материјалите (+ дополнителни трошоци); (2) фактурата го продава производот. Налогот за производство се прави при зачувување, со датумот на фактурата.</p>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="f" style={{ maxWidth: 300 }}>Репроматеријали од објект<select value={value.wh} onChange={(e) => onChange({ ...value, wh: e.target.value })}><option value="">01 Главен магацин</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
        <label className="f" style={{ maxWidth: 180 }}>Дополнителни трошоци (труд, енергија…)<input type="number" step="any" value={value.extra} onChange={(e) => onChange({ ...value, extra: e.target.value })} style={{ textAlign: 'right' }} /></label>
        <label className="chk"><input type="checkbox" checked={value.saveBom} onChange={(e) => onChange({ ...value, saveBom: e.target.checked })} /> зачувај како норматив</label>
      </div>
      {candidates.length > 0 && <div className="row mini" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>Се произведува и:{candidates.map(({ l, i }) => {
        const on = value.lines.some((x) => x.lineNo === i && x.marked);
        return <label key={i} className="chk"><input type="checkbox" checked={on} onChange={(e) => onChange({ ...value, lines: e.target.checked ? [...value.lines, { lineNo: i, productId: l.itemId, qty: Number(l.qty) || 0, marked: true, materials: [] }] : value.lines.filter((x) => !(x.lineNo === i && x.marked)) })} /> {l.name}</label>;
      })}</div>}
      {!value.lines.length && <p className="note">Нема ставки за производство – во фактурата додадете готов производ или штиклирајте артикл што се произведува.</p>}
      {value.lines.map((pl, k) => {
        const it = itemById.get(pl.productId);
        const R = materialRows(pl.materials.map((m) => ({ itemId: m.itemId, qty: Number(m.qty) || 0 })), stockOf);
        return (
          <div key={pl.lineNo + ':' + pl.productId} style={{ margin: '10px 0' }}>
            <b>{it?.name ?? '?'}</b> · {fq(pl.qty)} {it?.unit ?? ''}{boms[pl.productId] ? <span className="pill info"> по норматив</span> : <span className="pill warn"> нема норматив – изберете материјали</span>}
            <div className="tw"><table className="dense"><thead><tr><th>Репроматеријал</th><th className="n">Количина</th><th className="n">На залиха</th><th className="n">Просечна цена</th><th className="n">Вредност</th><th /></tr></thead>
              <tbody>{pl.materials.map((m, j) => {
                const r = R.rows[j]!;
                const mi = itemById.get(m.itemId);
                return <tr key={j} style={r.short ? { color: 'var(--bad)' } : undefined}>
                  <td><select value={m.itemId} onChange={(e) => setLine(k, { materials: pl.materials.map((x, y) => (y === j ? { ...x, itemId: e.target.value } : x)) })}><option value="">— избери —</option>{mats.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name}</option>)}</select></td>
                  <td className="n"><input type="number" step="any" value={m.qty} style={{ width: 90, textAlign: 'right' }} onChange={(e) => setLine(k, { materials: pl.materials.map((x, y) => (y === j ? { ...x, qty: e.target.value } : x)) })} /> {mi?.unit ?? ''}</td>
                  <td className="n">{fq(r.have)}{r.short ? ' – недоволно!' : ''}</td><td className="n">{fmt(r.avg)}</td><td className="n">{fmt(r.value)}</td>
                  <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => setLine(k, { materials: pl.materials.filter((_, y) => y !== j) })}>✕</button></td>
                </tr>;
              })}</tbody>
              <tfoot><tr><td colSpan={4}>Материјали</td><td className="n">{fmt(R.value)}</td><td /></tr></tfoot></table></div>
            <div className="row" style={{ gap: 6 }}>
              <input placeholder="шифра / баркод количина + Enter" style={{ width: 260 }} value={quick[k] ?? ''} onChange={(e) => setQuick({ ...quick, [k]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const m = parseQuickMaterial(quick[k] ?? '', find);
                  if (m) { setLine(k, { materials: [...pl.materials, { itemId: m.itemId, qty: String(m.qty) }] }); setQuick({ ...quick, [k]: '' }); }
                }} />
              <button type="button" className="btn sm" onClick={() => setLine(k, { materials: [...pl.materials, { itemId: '', qty: '1' }] })}>+ материјал</button>
            </div>
          </div>);
      })}
      {value.lines.length > 0 && <p className="note">Вкупно материјали <b>{fmt(tot.value)}</b>{Number(value.extra) ? <> + дополнителни <b>{fmt(Number(value.extra))}</b></> : null} = трошоци за производство <b>{fmt(tot.value + (Number(value.extra) || 0))}</b>{tot.rows.some((r) => r.short) && <span style={{ color: 'var(--bad)' }}> · недостига репроматеријал на залиха</span>}.</p>}
    </div>
  );
}
