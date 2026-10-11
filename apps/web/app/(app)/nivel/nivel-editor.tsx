'use client';
/**
 * Нивелација editor — legacy `VIEWS.nivel` 5137 with wrappers 13196 (import / template / manual item / „Акција важи
 * до“ / ДД.ММ.ГГГГ date), 17193 (correction banner) and 17433 (checkbox column, search, „Избрани“, ▼ / ▲ %, fixed
 * price, rounding, „Примени на избраните“, „Исчисти ги новите цени“).
 */
import Link from 'next/link';
import { useActionState, useMemo, useRef, useState } from 'react';
import * as Retail from '@wise/core/retail';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { downloadXlsx, readRows } from '../_retail/read-file';
import { saveNivelAction } from './actions';

export interface NivItem { id: string; code: string; name: string; unit: string; barcodes: string[]; have: Record<string, number>; sp: Record<string, number> }
export interface NivDraft { id?: string; number?: string; date: string; wh: string; note: string; promoTo: string; prices: Record<string, string>; qty: Record<string, number>; old: Record<string, number> }

const n = (s: string | number | null | undefined) => { const x = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '');
const iso = (v: string): string => {
  const d = v.replace(/\D/g, '');
  const m = v.trim().match(/^(\d{1,2})[.\/\- ](\d{1,2})[.\/\- ](\d{4})$/) ?? (d.length === 8 ? [v, d.slice(0, 2), d.slice(2, 4), d.slice(4)] : null);
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  const x = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return Number.isNaN(new Date(x + 'T00:00:00').getTime()) ? '' : x;
};

export function NivelEditor({ initial, items, locs }: { initial: NivDraft; items: NivItem[]; locs: { id: string; name: string }[] }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveNivelAction, {});
  const [d, setD] = useState(initial);
  const [dt, setDt] = useState(dmy(initial.date));
  const [to, setTo] = useState(dmy(initial.promoTo));
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dir, setDir] = useState<'down' | 'up'>('down');
  const [pct, setPct] = useState('');
  const [fix, setFix] = useState('');
  const [rs, setRs] = useState('1');
  const [msg, setMsg] = useState('');
  const [miss, setMiss] = useState<string[]>([]);
  const [add, setAdd] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<NivDraft>) => setD((x) => ({ ...x, ...p }));
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const qtyOf = (id: string) => d.qty[id] ?? byId.get(id)?.have[d.wh] ?? 0;
  const oldOf = (id: string) => d.old[id] ?? byId.get(id)?.sp[d.wh] ?? 0;
  const rows = items.filter((i) => d.prices[i.id] !== undefined || Math.abs(i.have[d.wh] ?? 0) > 1e-9);
  const shown = rows.filter((i) => !q || `${i.code} ${i.name}`.toLowerCase().includes(q.toLowerCase()));
  const diff = rows.reduce((a, i) => (d.prices[i.id] !== undefined && d.prices[i.id] !== '' ? a + qtyOf(i.id) * (n(d.prices[i.id]) - oldOf(i.id)) : a), 0);
  const apply = () => {
    if (!sel.size) { setMsg('Изберете барем еден артикл (кутичката лево).'); return; }
    if (!n(pct) && !n(fix)) { setMsg('Внесете % или нова цена.'); return; }
    const P = { ...d.prices };
    let k = 0;
    for (const id of sel) { const nv = Retail.nivBulkPrice(oldOf(id), { dir, pct, fix, rs: Number(rs) }); if (nv != null) { P[id] = String(nv); k++; } }
    set({ prices: P });
    setMsg(`${k} нови цени се поставени (${n(fix) ? 'фиксна цена ' + fix : (dir === 'down' ? '▼ намалување ' : '▲ зголемување ') + Math.abs(n(pct)) + '%'}). Проверете и „Зачувај нивелација“.`);
  };
  const imp = async (f: File) => {
    try {
      const r = Retail.nivImport(await readRows(f), items);
      const P = { ...d.prices }, Q = { ...d.qty }, O = { ...d.old };
      for (const x of r.rows) { P[x.item.id] = String(x.nv); if (x.q) Q[x.item.id] = x.q; if (x.o) O[x.item.id] = x.o; }
      set({ prices: P, qty: Q, old: O });
      setMiss(r.miss);
      setMsg(`Увезени ${r.rows.length} артикли${r.miss.length ? ' · ' + r.miss.length + ' шифри не се пронајдени во шифрарникот' : ''}.`);
    } catch (e) { setMsg('Датотеката не може да се прочита: ' + (e instanceof Error ? e.message : String(e))); }
  };
  const addOne = () => {
    const it = Retail.moFindItem(items, add);
    if (!it) { setMsg('Артиклот не е пронајден.'); return; }
    set({ prices: { ...d.prices, [it.id]: d.prices[it.id] ?? '' } });
    setAdd('');
  };
  const payload = {
    id: d.id ?? null, date: d.date, wh: d.wh, note: d.note, promoTo: d.promoTo || null,
    prices: Object.fromEntries(Object.entries(d.prices).filter(([, v]) => v !== '' && n(v) > 0).map(([k, v]) => [k, n(v)])),
    qty: d.qty, old: d.old,
  };
  return (
    <form action={action}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="hd"><h1>Нивелација<span className="mk">промена на малопродажни цени</span></h1>
        <div className="row"><Link className="btn" href="/nivel">Откажи</Link><button className="btn pri" disabled={pending}>Зачувај нивелација</button></div></div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="card">
        {d.id && <div className="callout warn" style={{ marginBottom: 8 }}>✎ Корекција на нивелација <b>{d.number}</b> – по промената кликнете „Зачувај нивелација“. <Link className="btn sm" href="/nivel">Откажи корекција</Link></div>}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="f">Објект<select value={d.wh} disabled={!!d.id} onChange={(e) => set({ wh: e.target.value, prices: {}, qty: {}, old: {} })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="f">Датум<input inputMode="numeric" placeholder="ДД.ММ.ГГГГ" value={dt} style={{ width: 130, borderColor: dt && !iso(dt) ? 'var(--bad)' : undefined }}
            onChange={(e) => { const x = e.target.value.replace(/\D/g, ''); const v = /^\d+$/.test(e.target.value) && x.length === 8 ? `${x.slice(0, 2)}.${x.slice(2, 4)}.${x.slice(4)}` : e.target.value; setDt(v); const i = iso(v); if (i) set({ date: i }); }} /></label>
          <label className="f wide">Забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
        </div>
        <p className="note">Внесете нова малопродажна цена (со ДДВ) за артиклите што се менуваат. Разликата (количина × (нова − стара цена)) влегува во трговската книга на мало на тој објект; цената важи за овој објект.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="btn sm pri" onClick={() => fileRef.current?.click()}>📥 Увоз од Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt,.xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void imp(f); }} />
          <button type="button" className="btn sm" onClick={() => downloadXlsx('Nivelacija_sablon.xlsx', [[...Retail.NIV_TEMPLATE]])}>⬇ Шаблон (Шифра · Нова цена · Количина · Стара цена)</button>
          <input list="nivItems" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="шифра или назив…" style={{ width: 220 }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } }} />
          <datalist id="nivItems">{items.map((i) => <option key={i.id} value={(i.code ? i.code + ' · ' : '') + i.name} />)}</datalist>
          <button type="button" className="btn sm" onClick={addOne}>+ Додај артикл рачно</button>
          {!d.id && <label className="mini" style={{ marginLeft: 'auto' }}>Акција важи до (по избор)<input inputMode="numeric" placeholder="ДД.ММ.ГГГГ" value={to} style={{ width: 120, borderColor: to && !iso(to) ? 'var(--bad)' : undefined }}
            onChange={(e) => { const x = e.target.value.replace(/\D/g, ''); const v = /^\d+$/.test(e.target.value) && x.length === 8 ? `${x.slice(0, 2)}.${x.slice(2, 4)}.${x.slice(4)}` : e.target.value; setTo(v); set({ promoTo: iso(v) }); }} /></label>}
        </div>
        {miss.length > 0 && <p className="note" style={{ color: 'var(--bad)' }}>Не се пронајдени во шифрарникот: {miss.slice(0, 30).join(', ')}{miss.length > 30 ? ' …' : ''} – додајте ги во Шифрарник → Производи и артикли и увезете повторно.</p>}
        {!d.id && <p className="note">Со „Акција важи до“ програмата прави и втора нивелација на следниот ден со враќање на старата цена.</p>}
      </div>
      {msg && <div className="callout">{msg}</div>}
      <div className="card" style={{ padding: '8px 12px' }}><div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Барај шифра / назив…" style={{ width: 220 }} /><b>Избрани: {sel.size}</b>
        <label className="mini">Промена<select value={dir} onChange={(e) => setDir(e.target.value as 'down' | 'up')}><option value="down">▼ Намалување (акција)</option><option value="up">▲ Зголемување</option></select></label>
        <label className="mini">%<input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="20" style={{ width: 70 }} /></label><span className="mut">или</span>
        <label className="mini">Нова цена<input inputMode="decimal" value={fix} onChange={(e) => setFix(e.target.value)} placeholder="ден." style={{ width: 90 }} /></label>
        <label className="mini">Заокружи<select value={rs} onChange={(e) => setRs(e.target.value)}><option value="1">на 1 ден</option><option value="10">на 10 ден</option><option value="0.01">без</option><option value="9">…9 (на пр. 149)</option></select></label>
        <button type="button" className="btn sm pri" onClick={apply}>Примени на избраните</button><button type="button" className="btn sm" onClick={() => set({ prices: {} })}>Исчисти ги новите цени</button></div>
        <p className="note" style={{ margin: '6px 0 0' }}>Изберете артикли (или сите со кутичката горе), изберете ▼ Намалување или ▲ Зголемување и внесете % (на пр. 20) или фиксна цена и „Примени“. Потоа „Зачувај нивелација“ – се книжи автоматски: Д/П 6630 · 6690 · 6640 за разликата.</p></div>
      {rows.length ? <div className="tw"><table>
        <thead><tr><th style={{ width: 28 }}><input type="checkbox" title="Избери ги сите (прикажани)" checked={shown.length > 0 && shown.every((i) => sel.has(i.id))}
          onChange={(e) => setSel((s) => { const x = new Set(s); for (const i of shown) { if (e.target.checked) x.add(i.id); else x.delete(i.id); } return x; })} /></th>
          <th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Количина</th><th className="n">Стара МПЦ</th><th className="n">Нова МПЦ</th><th className="n">Разлика</th></tr></thead>
        <tbody>{shown.map((i) => {
          const v = d.prices[i.id] ?? '';
          return <tr key={i.id}><td><input type="checkbox" checked={sel.has(i.id)} onChange={(e) => setSel((s) => { const x = new Set(s); if (e.target.checked) x.add(i.id); else x.delete(i.id); return x; })} /></td>
            <td>{i.code}</td><td>{i.name}</td><td>{i.unit}</td><td className="n">{fq(qtyOf(i.id))}{d.qty[i.id] != null && <span className="mut" title="од Excel"> ✎</span>}</td>
            <td className="n">{fmt(oldOf(i.id))}{d.old[i.id] != null && <span className="mut" title="од Excel"> ✎</span>}</td>
            <td><input type="number" step="any" value={v} placeholder={String(oldOf(i.id))} onChange={(e) => set({ prices: { ...d.prices, [i.id]: e.target.value } })} style={{ width: 110, textAlign: 'right' }} /></td>
            <td className="n">{v !== '' ? fmt(qtyOf(i.id) * (n(v) - oldOf(i.id))) : ''}</td></tr>;
        })}</tbody>
        <tfoot><tr><td colSpan={7}>Вкупна разлика</td><td className="n">{fmt(diff)}</td></tr></tfoot>
      </table></div> : <div className="card empty">Нема залиха во овој објект.</div>}
    </form>
  );
}
