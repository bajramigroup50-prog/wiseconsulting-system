'use client';
/**
 * Legacy `moEditor` 5719: one editor for the store documents — sale (qty, price with VAT, VAT), supplier return and
 * write-off (qty, retail price, cost value), stock count (system / counted / difference); item entry with Enter,
 * stock pill, Excel template / count list and import (`moTplDl`, `moImport`), „Откажи (Esc)“, „Зачувај (F4)“.
 */
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import * as Retail from '@wise/core/retail';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { saveStockCountAction } from '../_stock/actions';
import { downloadXlsx, readRows } from '../_retail/read-file';
import { saveStoreOutAction } from './actions';

export interface MoItemOpt { id: string; code: string; name: string; unit: string; barcodes: string[]; rate: number; avg: number; have: Record<string, number>; sp: Record<string, number> }
export interface MoDraft {
  id?: string; kind: 'sale' | 'ret' | 'otp' | 'pop'; number: string; date: string; wh: string; partnerId: string; ref: string; konto: string; konto2: string; note: string;
  lines: { itemId: string; qty: string; price?: string; cnt?: string }[];
}

const n = (s: string | number | null | undefined) => { const x = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };

export function MoEditor({ initial, items, locs, partners, k10, k4, k7 }: {
  initial: MoDraft; items: MoItemOpt[]; locs: { id: string; name: string; kind: string }[]; partners: { id: string; name: string }[];
  k10: [string, string][]; k4: [string, string][]; k7: [string, string][];
}) {
  const T = initial.kind;
  const router = useRouter();
  const [st, action, pending] = useActionState<ActionState, FormData>(T === 'sale' || T === 'ret' ? saveStoreOutAction : saveStockCountAction, {});
  const [d, setD] = useState<MoDraft>(() => (T === 'pop' && !initial.lines.length
    ? { ...initial, lines: items.filter((i) => Math.abs(i.have[initial.wh] ?? 0) > 1e-9).map((i) => ({ itemId: i.id, qty: '', cnt: String(i.have[initial.wh] ?? 0) })) }
    : initial));
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [qty, setQty] = useState('1');
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const set = (p: Partial<MoDraft>) => setD((x) => ({ ...x, ...p }));
  const sp = (id: string) => byId.get(id)?.sp[d.wh] ?? 0;
  const have = (id: string) => byId.get(id)?.have[d.wh] ?? 0;
  const own = useMemo(() => new Map(initial.id && T !== 'pop' ? initial.lines.map((l) => [l.itemId, n(l.qty)]) : []), [initial, T]);
  const avail = (id: string) => have(id) + (initial.wh === d.wh ? own.get(id) ?? 0 : 0);
  const val = (l: MoDraft['lines'][number]) => (T === 'sale' ? n(l.qty) * n(l.price) : n(l.qty) * sp(l.itemId));
  const tot = T === 'pop' ? d.lines.reduce((a, l) => a + (n(l.cnt) - have(l.itemId)) * sp(l.itemId), 0) : d.lines.reduce((a, l) => a + val(l), 0);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'F4') { e.preventDefault(); formRef.current?.requestSubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); router.push('/m_izlez?t=' + T); }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [router, T]);

  const add = () => {
    const it = Retail.moFindItem(items, q);
    if (!it) { setMsg({ bad: true, text: 'Артиклот не е пронајден.' }); return; }
    setMsg(null);
    const k = d.lines.findIndex((l) => l.itemId === it.id);
    if (k >= 0) set({ lines: d.lines.map((l, i) => (i === k ? { ...l, qty: String(n(l.qty) + (n(qty) || 1)) } : l)) });
    else set({ lines: [...d.lines, { itemId: it.id, qty: String(n(qty) || 1), price: String(sp(it.id)) }] });
    setQ('');
  };
  const imp = async (f: File) => {
    let rows: unknown[][];
    try { rows = await readRows(f); } catch { setMsg({ bad: true, text: 'Датотеката не може да се прочита. Користете Excel (.xlsx), CSV или TXT.' }); return; }
    if (!rows.some((r) => r.some((c) => String(c ?? '').trim() !== ''))) { setMsg({ bad: true, text: 'Датотеката е празна.' }); return; }
    const r = Retail.moImport(rows, T, items);
    const L = [...d.lines];
    for (const [id, o] of r.acc) {
      if (T === 'pop') { const l = L.find((x) => x.itemId === id); if (l) l.cnt = String(o.q); else L.push({ itemId: id, qty: '', cnt: String(o.q) }); continue; }
      if (!o.q) continue;
      const pr = T === 'sale' && o.hasP ? Math.round((o.amt / o.q) * 100) / 100 : sp(id);
      const l = L.find((x) => x.itemId === id);
      if (l) { l.qty = String(n(l.qty) + o.q); if (o.hasP) l.price = String(pr); } else L.push({ itemId: id, qty: String(o.q), price: String(pr) });
    }
    set({ lines: L });
    setMsg({ bad: r.miss.length > 0, text: `Увезени ${r.rows} редови (${r.acc.size} артикли) од „${f.name}“.${T === 'pop' ? ' Артиклите што ги нема во датотеката ја задржуваат состојбата (без разлика).' : ''}${r.miss.length ? ` Непрепознаени (${r.miss.length}) – додајте ги во шифрарникот со иста шифра/баркод и увезете повторно: ${r.miss.slice(0, 15).join('; ')}${r.miss.length > 15 ? ' …' : ''}` : ''}` });
  };
  const tpl = () => {
    const aoa = Retail.moTemplate(T, items, have, sp);
    const loc = locs.find((l) => l.id === d.wh)?.name ?? '';
    downloadXlsx((T === 'pop' ? 'Popisna_lista_' : 'Sablon_' + T + '_') + loc.replace(/[^\p{L}\p{N}]+/gu, '_') + '_' + d.date + '.xlsx', aoa);
  };
  const payload = T === 'sale' || T === 'ret'
    ? { id: d.id ?? null, kind: T, date: d.date, wh: d.wh, number: d.number, partnerId: d.partnerId || null, ref: d.ref, account: T === 'sale' ? d.konto : null, note: d.note,
      lines: d.lines.filter((l) => n(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: n(l.qty), price: T === 'sale' ? n(l.price) : null })) }
    : { id: d.id ?? null, kind: T === 'pop' ? 'count' : 'writeoff', date: d.date, wh: d.wh, note: d.note, shortageAccount: d.konto, surplusAccount: d.konto2,
      lines: T === 'pop' ? d.lines.filter((l) => l.cnt !== '' && Math.abs(n(l.cnt) - have(l.itemId)) > 1e-9).map((l) => ({ itemId: l.itemId, cnt: n(l.cnt) })) : d.lines.filter((l) => n(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: n(l.qty) })) };
  const kSel = (v: string, onChange: (v: string) => void, L: [string, string][]) => (
    <select value={v} onChange={(e) => onChange(e.target.value)}>{!L.some(([k]) => k === v) && <option value={v}>{v}</option>}{L.map(([k, t]) => <option key={k} value={k}>{k} {t}</option>)}</select>
  );
  const stores = T === 'pop' ? locs : locs.filter((l) => l.kind === 'store');
  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="hd"><h1>{Retail.MOUT[T].n}<span className="mk">{d.id ? 'измена · ' + d.number : 'нов документ'}</span></h1>
        <div className="row">
          <button type="button" className="btn" onClick={tpl}>{T === 'pop' ? 'Пописна листа (Excel)' : 'Excel шаблон'}</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Увоз од Excel / CSV</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt,.xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void imp(f); }} />
          <button type="button" className="btn" onClick={() => router.push('/m_izlez?t=' + T)}>Откажи (Esc)</button>
          <button className="btn pri" disabled={pending}>Зачувај (F4)</button>
        </div></div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {msg && <div className={`callout ${msg.bad ? 'warn' : ''}`}>{msg.text}</div>}
      <div className="card"><div className="form">
        <label className="f">{T === 'pop' ? 'Објект' : 'Продавница'}<select value={d.wh} onChange={(e) => set({ wh: e.target.value, ...(T === 'pop' ? { lines: items.filter((i) => Math.abs(i.have[e.target.value] ?? 0) > 1e-9).map((i) => ({ itemId: i.id, qty: '', cnt: String(i.have[e.target.value] ?? 0) })) } : T === 'sale' ? { lines: d.lines.map((l) => ({ ...l, price: String(byId.get(l.itemId)?.sp[e.target.value] ?? 0) })) } : {}) })}>
          {stores.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f">Датум<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="f">Број<input value={d.number} onChange={(e) => set({ number: e.target.value })} placeholder="автоматски" readOnly={T === 'otp' || T === 'pop'} /></label>
        {T === 'ret' && <><label className="f">Добавувач<select value={d.partnerId} onChange={(e) => set({ partnerId: e.target.value })}><option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="f">Број на документ / фактура<input value={d.ref} onChange={(e) => set({ ref: e.target.value })} /></label></>}
        {T === 'sale' && <label className="f">Наплата{kSel(d.konto, (v) => set({ konto: v }), k10)}</label>}
        {(T === 'otp' || T === 'pop') && <label className="f">Конто за {T === 'pop' ? 'кусок' : 'отпис'} (трошок){kSel(d.konto, (v) => set({ konto: v }), k4)}</label>}
        {T === 'pop' && <label className="f">Конто за вишок (приход){kSel(d.konto2, (v) => set({ konto2: v }), k7)}</label>}
        <label className="f wide">Опис / забелешка<input value={d.note} onChange={(e) => set({ note: e.target.value })} /></label>
      </div></div>
      {T !== 'pop' && (
        <div className="card"><div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="f" style={{ flex: 1, minWidth: 260 }}>Артикл<input list="moItems" value={q} onChange={(e) => setQ(e.target.value)} placeholder="шифра или назив…" autoComplete="off" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /></label>
          <label className="f" style={{ width: 120 }}>Количина<input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /></label>
          <button type="button" className="btn pri" onClick={add}>Додај (Enter)</button>
        </div>
          <datalist id="moItems">{items.map((it) => <option key={it.id} value={(it.code ? it.code + ' · ' : '') + it.name}>залиха {fq(avail(it.id))} {it.unit} · {fmt(sp(it.id))}</option>)}</datalist></div>
      )}
      <div className="card"><div className="tw"><table className="dense">
        <thead><tr><th>Шифра</th><th>Артикл</th><th>ЕМ</th>{T === 'pop'
          ? <><th className="n">Состојба</th><th className="n">Пописано</th><th className="n">Разлика</th><th className="n">Прод. цена</th><th className="n">Вредност разлика</th></>
          : <><th className="n">Количина</th>{T === 'sale' ? <><th className="n">Цена со ДДВ</th><th className="n">ДДВ</th></> : <><th className="n">Прод. цена</th><th className="n">Набавна вредност</th></>}<th className="n">Продажна вредност</th><th /></>}</tr></thead>
        <tbody>
          {d.lines.map((l, i) => {
            const it = byId.get(l.itemId);
            const setL = (p: Partial<MoDraft['lines'][number]>) => set({ lines: d.lines.map((x, k) => (k === i ? { ...x, ...p } : x)) });
            if (T === 'pop') {
              const df = n(l.cnt) - have(l.itemId);
              return <tr key={i}><td>{it?.code}</td><td>{it?.name ?? '?'}</td><td>{it?.unit}</td><td className="n">{fq(have(l.itemId))}</td>
                <td className="n"><input type="number" step="any" value={l.cnt ?? ''} onChange={(e) => setL({ cnt: e.target.value })} style={{ width: 110, textAlign: 'right' }} /></td>
                <td className="n" style={{ color: df < 0 ? 'var(--bad)' : df > 0 ? 'var(--good)' : undefined }}>{df ? fq(df) : ''}</td><td className="n">{fmt(sp(l.itemId))}</td><td className="n">{df ? fmt(df * sp(l.itemId)) : ''}</td></tr>;
            }
            const av = avail(l.itemId);
            return <tr key={i}><td>{it?.code}</td><td>{it?.name ?? '?'}{n(l.qty) > av + 1e-9 && <> <span className="pill bad">залиха {fq(av)}</span></>}</td><td>{it?.unit}</td>
              <td className="n"><input type="number" step="any" value={l.qty} onChange={(e) => setL({ qty: e.target.value })} style={{ width: 90, textAlign: 'right' }} /></td>
              {T === 'sale'
                ? <><td className="n"><input type="number" step="any" value={l.price ?? ''} onChange={(e) => setL({ price: e.target.value })} style={{ width: 110, textAlign: 'right' }} /></td><td className="n">{it?.rate}%</td></>
                : <><td className="n">{fmt(sp(l.itemId))}</td><td className="n">{fmt(n(l.qty) * (it?.avg ?? 0))}</td></>}
              <td className="n">{fmt(val(l))}</td><td><button type="button" className="btn sm ghost" onClick={() => set({ lines: d.lines.filter((_, k) => k !== i) })}>✕</button></td></tr>;
          })}
          {!d.lines.length && <tr><td colSpan={9} className="empty">{T === 'pop' ? 'Нема артикли со залиха во продавницата.' : 'Додадете артикли.'}</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={T === 'pop' ? 7 : 6}>Вкупно</td><td className="n">{fmt(tot)}</td>{T !== 'pop' && <td />}</tr></tfoot>
      </table></div>
        {T === 'pop' && <p className="note">Внесете ја пописаната количина. Разлика со минус = кусок (раздолжување), со плус = вишок (задолжување по просечна набавна цена).</p>}</div>
    </form>
  );
}
