'use client';
/**
 * Editors of customer orders (legacy `ordEditor` 9876) and supplier orders (legacy `VIEWS.nabavki` editor 9900).
 * One React state per editor; the server action receives a JSON payload.
 */
import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { saveOrderAction, savePoAction } from './actions';

export interface OItem { id: string; code: string; name: string; unit: string; price: number; rate: number; service: boolean; stock: number; avail: number; disc?: number; last?: number }
export interface OPartner { id: string; name: string; disc?: number }
export interface OLine { itemId: string | null; name: string; unit: string; qty: string; price: string; disc: string; rate: number; dl?: number }

const n = (s: string | number) => { const x = Number(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const lbl = (i: OItem) => (i.code ? i.code + ' · ' : '') + i.name;

function Picker({ items, onPick }: { items: OItem[]; onPick: (it: OItem, q: number) => void }) {
  const [v, setV] = useState('');
  const [q, setQ] = useState('1');
  const add = () => {
    const s = v.trim().toLowerCase();
    const it = items.find((i) => lbl(i).toLowerCase() === s) ?? items.find((i) => i.code.toLowerCase() === s) ?? items.find((i) => i.name.toLowerCase() === s);
    if (!it) { window.alert('Артиклот не е пронајден.'); return; }
    onPick(it, n(q) || 1);
    setV('');
  };
  return (
    <div className="row" style={{ gap: 6, alignItems: 'end', marginTop: 6, flexWrap: 'wrap' }}>
      <label className="f">Артикл<input list="ordItems" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} style={{ width: 300 }} placeholder="шифра, назив или баркод" /></label>
      <datalist id="ordItems">{items.slice(0, 4000).map((i) => <option key={i.id} value={lbl(i)}>{i.service ? '' : 'достапно ' + fq(i.avail)}</option>)}</datalist>
      <label className="f">Кол.<input value={q} onChange={(e) => setQ(e.target.value)} inputMode="decimal" style={{ width: 80 }} /></label>
      <button type="button" className="btn sm" onClick={add}>+ Додај</button>
    </div>
  );
}

export interface OrderDraft { id?: string; number: string; date: string; partnerId: string; deliveryDate: string; note: string; lines: OLine[] }

export function OrderEditor({ initial, items, partners }: { initial: OrderDraft; items: OItem[]; partners: OPartner[] }) {
  const [st, run, pending] = useActionState<ActionState, FormData>(saveOrderAction, {});
  const [d, setD] = useState(initial);
  const by = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const set = (p: Partial<OrderDraft>) => setD((x) => ({ ...x, ...p }));
  const setL = (i: number, p: Partial<OLine>) => setD((x) => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  let base = 0, vat = 0;
  for (const l of d.lines) { const b = Math.round(n(l.qty) * n(l.price) * (1 - n(l.disc) / 100) * 100) / 100; base += b; vat += Math.round(b * l.rate) / 100; }
  const payload = JSON.stringify({ ...d, deliveryDate: d.deliveryDate || null, lines: d.lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate })) });
  return (
    <form action={run}>
      <input type="hidden" name="payload" value={payload} />
      {st.error && <div className="callout bad">{st.error}</div>}
      <div className="card"><div className="form">
        <label className="f">Број<input value={d.number} onChange={(e) => set({ number: e.target.value })} placeholder="автоматски" /></label>
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="f">Купувач<select value={d.partnerId} onChange={(e) => set({ partnerId: e.target.value })}><option value="">— изберете —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="f">Испорака до<input type="date" value={d.deliveryDate} onChange={(e) => set({ deliveryDate: e.target.value })} /></label>
        <label className="f wide">Адреса за испорака / забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
      </div></div>
      <div className="card">
        <table className="dense">
          <thead><tr><th>Артикл</th><th className="n">Нарачано</th><th className="n">Испорачано</th><th className="n">Цена без ДДВ</th><th className="n">Рабат %</th><th className="n">ДДВ</th><th className="n">Залиха / достапно</th><th className="n">Износ</th><th /></tr></thead>
          <tbody>{d.lines.map((l, i) => {
            const it = l.itemId ? by.get(l.itemId) : undefined;
            const rest = n(l.qty) - (l.dl ?? 0);
            return (
              <tr key={i}>
                <td>{l.name}</td>
                <td className="n"><input value={l.qty} onChange={(e) => setL(i, { qty: e.target.value })} inputMode="decimal" style={{ width: 80 }} /></td>
                <td className="n">{fq(l.dl ?? 0)}</td>
                <td className="n"><input value={l.price} onChange={(e) => setL(i, { price: e.target.value })} inputMode="decimal" style={{ width: 100 }} /></td>
                <td className="n"><input value={l.disc} onChange={(e) => setL(i, { disc: e.target.value })} inputMode="decimal" style={{ width: 60 }} /></td>
                <td className="n">{l.rate}%</td>
                <td className="n" style={it && !it.service && it.avail < rest ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{it && !it.service ? `${fq(it.stock)} / ${fq(it.avail)}` : ''}</td>
                <td className="n">{fmt(n(l.qty) * n(l.price) * (1 - n(l.disc) / 100))}</td>
                <td><button type="button" className="btn sm ghost" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })}>✕</button></td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={7}>Вкупно со ДДВ</td><td className="n">{fmt(base + vat)}</td><td /></tr></tfoot>
        </table>
        <Picker items={items} onPick={(it, q) => setD((x) => {
          const ex = x.lines.findIndex((l) => l.itemId === it.id);
          if (ex >= 0) return { ...x, lines: x.lines.map((l, k) => (k === ex ? { ...l, qty: String(n(l.qty) + q) } : l)) };
          const pd = partners.find((p) => p.id === x.partnerId)?.disc ?? 0;
          return { ...x, lines: [...x.lines, { itemId: it.id, name: it.name, unit: it.unit, qty: String(q), price: String(it.price), disc: pd ? String(pd) : '', rate: it.rate }] };
        })} />
      </div>
      <div className="row savebar" style={{ gap: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href="/porachki">Затвори</Link><button className="btn pri" disabled={pending}>Зачувај</button></div>
    </form>
  );
}

export interface PoDraft { id?: string; number?: string; date: string; partnerId: string; note: string; lines: { itemId: string; name: string; qty: string; price: number }[] }

export function PoEditor({ initial, items, partners }: { initial: PoDraft; items: OItem[]; partners: OPartner[] }) {
  const [st, run, pending] = useActionState<ActionState, FormData>(savePoAction, {});
  const [d, setD] = useState(initial);
  const set = (p: Partial<PoDraft>) => setD((x) => ({ ...x, ...p }));
  const payload = JSON.stringify({ id: d.id ?? null, date: d.date, partnerId: d.partnerId || null, note: d.note, lines: d.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price })) });
  return (
    <form action={run} className="card">
      <input type="hidden" name="payload" value={payload} />
      {st.error && <div className="callout bad">{st.error}</div>}
      <div className="form">
        <label className="f">Добавувач<select value={d.partnerId} onChange={(e) => set({ partnerId: e.target.value })}><option value="">— без добавувач —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="f wide">Забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
      </div>
      <table className="dense">
        <thead><tr><th>Артикл</th><th className="n">Количина</th><th className="n">Последна набавна цена</th><th /></tr></thead>
        <tbody>{d.lines.map((l, i) => (
          <tr key={i}><td>{l.name}</td>
            <td className="n"><input value={l.qty} inputMode="decimal" style={{ width: 90 }} onChange={(e) => set({ lines: d.lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)) })} /></td>
            <td className="n">{fmt(l.price)}</td>
            <td><button type="button" className="btn sm ghost" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })}>✕</button></td></tr>
        ))}</tbody>
      </table>
      <Picker items={items.filter((i) => !i.service)} onPick={(it, q) => set({ lines: [...d.lines, { itemId: it.id, name: it.name, qty: String(q), price: it.last ?? 0 }] })} />
      <div className="row savebar" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href="/nabavki">← Листа</Link><button className="btn pri" disabled={pending}>Зачувај</button></div>
      <p className="note">Нарачката до добавувач не се книжи. При прием на стоката внесете ја влезната фактура (Влез) и означете „Стоката е примена“.</p>
    </form>
  );
}
