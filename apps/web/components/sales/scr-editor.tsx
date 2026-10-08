'use client';
/** Supplier return / credit editor (legacy `scrEditor` 8783, `scrFromPur` 8774). */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { saveScrAction } from '@/app/(app)/povratDob/actions';

export interface ScrRow { itemId: string; name: string; qty: string; price: string; rate: string; account: string }
export interface EdScr { id: string | null; kind: 'ret' | 'disc'; number: string; date: string; supNo: string; partnerId: string; refPurchaseId: string; warehouseId: string; note: string; rows: ScrRow[] }
export interface ScrPurchase { id: string; number: string; date: string; partnerId: string | null; total: number; warehouseId: string | null; /** Supplier konto of the purchase (import → supplierFx). */ supKonto: string; stock: { itemId: string; qty: number; value: number }[]; groups: { account: string; rate: number; base: number }[] }

export function ScrEditor(p: {
  initial: EdScr; partners: { id: string; code: string | null; name: string }[]; items: { id: string; name: string; code: string | null; rate: number; type: string }[];
  purchases: ScrPurchase[]; locations: { id: string; name: string; kind: string }[]; accounts: [string, string][]; ddv: boolean; supplierKonto: string;
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveScrAction, {});
  const [E, setE] = useState<EdScr>(p.initial);
  const set = (x: Partial<EdScr>) => setE((o) => ({ ...o, ...x }));
  const setR = (i: number, x: Partial<ScrRow>) => setE((o) => ({ ...o, rows: o.rows.map((r, k) => (k === i ? { ...r, ...x } : r)) }));
  const its = p.items.filter((i) => i.type !== 'service');
  const P = p.purchases.filter((x) => !E.partnerId || x.partnerId === E.partnerId);
  const fill = (e: EdScr) => {
    const pur = p.purchases.find((x) => x.id === e.refPurchaseId);
    if (!pur) return e;
    if (e.kind === 'ret') return { ...e, partnerId: pur.partnerId ?? e.partnerId, warehouseId: pur.warehouseId ?? '', rows: pur.stock.filter((s) => s.qty).map((s) => {
      const it = p.items.find((x) => x.id === s.itemId);
      return { itemId: s.itemId, name: it?.name ?? '', qty: String(s.qty), price: String(Math.round((s.value / s.qty) * 1e4) / 1e4), rate: String(it?.rate ?? 18), account: '' };
    }) };
    return { ...e, partnerId: pur.partnerId ?? e.partnerId, rows: pur.groups.filter((g) => g.base).map((g) => ({ itemId: '', name: 'Попуст / одобрение кон ф-ра ' + pur.number, qty: '1', price: '0', rate: String(g.rate), account: g.account })) };
  };
  const calc = E.rows.reduce((t, r) => { const b = Math.round((Number(r.qty) || 0) * (Number(r.price) || 0)); const v = p.ddv && Number(r.rate) ? Math.round((b * Number(r.rate)) / 100) : 0; return { b: t.b + b, v: t.v + v }; }, { b: 0, v: 0 });
  return (
    <form action={action}>
      <input type="hidden" name="payload" value={JSON.stringify(E)} />
      <div className="hd"><h1>{E.id ? (E.kind === 'ret' ? 'Повратница до добавувач ' : 'Одобрение од добавувач ') + E.number : 'Нова повратница / одобрение од добавувач'}</h1>
        <div className="row"><Link className="btn" href="/povratDob">← Листа</Link></div></div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="card"><div className="form">
        <label className="f">Вид<select value={E.kind} onChange={(e) => setE((o) => fill({ ...o, kind: e.target.value as EdScr['kind'] }))}>
          <option value="ret">Повратница – стоката се враќа на добавувач</option><option value="disc">Одобрение (попуст/рабат) од добавувач – без стока</option></select></label>
        <label className="f">Датум<input type="date" value={E.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="f">Наш број (автоматски)<input value={E.number} placeholder="автоматски" onChange={(e) => set({ number: e.target.value })} /></label>
        <label className="f">Бр. на одобрението од добавувачот<input value={E.supNo} onChange={(e) => set({ supNo: e.target.value })} /></label>
        <label className="f">Добавувач<select value={E.partnerId} onChange={(e) => set({ partnerId: e.target.value, ...(p.purchases.find((x) => x.id === E.refPurchaseId)?.partnerId !== e.target.value ? { refPurchaseId: '' } : {}) })}>
          <option value="">— избери —</option>{p.partners.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + ' · ' : ''}{x.name}</option>)}</select></label>
        <label className="f">Кон влезна фактура<select value={E.refPurchaseId} onChange={(e) => setE((o) => fill({ ...o, refPurchaseId: e.target.value }))}>
          <option value="">— избери —</option>{P.map((x) => <option key={x.id} value={x.id}>{x.number || 'б/б'} · {x.date.split('-').reverse().join('.')} · {fmt(x.total)}</option>)}</select></label>
        {E.kind === 'ret' && p.locations.length > 0 && <label className="f">Од магацин<select value={E.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}><option value="">Главен магацин</option>{p.locations.filter((l) => l.kind === 'warehouse').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
        <label className="f wide">Забелешка<input value={E.note} placeholder="причина: оштетена стока, рекламација, количински рабат…" onChange={(e) => set({ note: e.target.value })} /></label>
      </div>{E.refPurchaseId && <div className="row" style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => setE((o) => fill(o))}>⤵ Пополни ги ставките од влезната фактура</button></div>}</div>
      <datalist id="sc_il">{its.map((it) => <option key={it.id} value={it.name}>{it.code ?? ''}</option>)}</datalist>
      <div className="tw"><table className="dense"><thead><tr><th>Артикл / опис</th><th className="n">Количина</th><th className="n">Цена без ДДВ</th><th className="n">ДДВ %</th><th>Конто (П)</th><th className="n">Основа</th><th className="n">ДДВ</th><th /></tr></thead><tbody>
        {E.rows.map((r, i) => {
          const b = Math.round((Number(r.qty) || 0) * (Number(r.price) || 0)), v = p.ddv && Number(r.rate) ? Math.round((b * Number(r.rate)) / 100) : 0;
          return <tr key={i}>
            <td><input value={r.name} list={E.kind === 'ret' ? 'sc_il' : undefined} style={{ width: 240 }} onChange={(e) => { const it = its.find((x) => x.name === e.target.value); setR(i, { name: e.target.value, itemId: it?.id ?? '', ...(it ? { rate: String(it.rate) } : {}) }); }} />
              {E.kind === 'ret' && !r.itemId && r.name && <div className="mini" style={{ color: 'var(--bad)' }}>не е артикл од шифрарникот</div>}</td>
            <td className="n"><input type="number" step="any" value={r.qty} style={{ width: 80, textAlign: 'right' }} onChange={(e) => setR(i, { qty: e.target.value })} /></td>
            <td className="n"><input type="number" step="any" value={r.price} style={{ width: 100, textAlign: 'right' }} onChange={(e) => setR(i, { price: e.target.value })} /></td>
            <td className="n"><select value={r.rate} style={{ width: 'auto' }} onChange={(e) => setR(i, { rate: e.target.value })}>{['18', '10', '5', '0'].map((x) => <option key={x}>{x}</option>)}</select></td>
            <td><select value={r.account} style={{ width: 200 }} onChange={(e) => setR(i, { account: e.target.value })}><option value="">{E.kind === 'ret' ? '(залиха – автоматски)' : '— избери —'}</option>{p.accounts.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}</select></td>
            <td className="n">{fmt(b)}</td><td className="n">{fmt(v)}</td>
            <td><button type="button" className="btn sm ghost" onClick={() => set({ rows: E.rows.filter((_, k) => k !== i) })}>✕</button></td></tr>;
        })}
        {!E.rows.length && <tr><td colSpan={8} className="note">Изберете влезна фактура и „Пополни ги ставките“, или додадете ред.</td></tr>}
      </tbody><tfoot><tr><td colSpan={5}>Вкупно{p.ddv ? '' : ' (фирмата не е ДДВ обврзник – ДДВ не се одбива)'}</td><td className="n">{fmt(calc.b)}</td><td className="n">{fmt(calc.v)}</td><td className="n"><b>{fmt(calc.b + calc.v)}</b></td></tr></tfoot></table></div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => set({ rows: [...E.rows, { itemId: '', name: '', qty: '1', price: '0', rate: '18', account: '' }] })}>+ Ред</button><span style={{ flex: 1 }} />
        <Link className="btn" href="/povratDob">Откажи</Link><button className="btn pri" disabled={pending}>Зачувај и книжи</button></div>
      {/* FIX (LEGACY-MAP 3.4 item 4): the note shows the konto actually posted (import purchases → foreign suppliers). */}
      <p className="note">Книжење: {p.purchases.find((x) => x.id === E.refPurchaseId)?.supKonto ?? p.supplierKonto} Добавувачи (Д) {fmt(calc.b + calc.v)} / {E.kind === 'ret' ? 'залиха' : 'избраното конто'} (П) {fmt(calc.b)}{p.ddv ? ' / влезен ДДВ (П) ' + fmt(calc.v) : ''}.{E.kind === 'ret' ? ' Залихата се намалува по наведената набавна цена.' : ''}</p>
    </form>
  );
}
