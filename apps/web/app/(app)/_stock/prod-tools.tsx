'use client';
/**
 * Work-order tools (legacy v440–v444, 13924–13986):
 * - `CustomProdEditor` — „✏ Измени / додади материјали за овој налог“ (`pcOn`): materials with a code column and a
 *   searchable name, total quantities, stock and value, „+ Материјал“, „зачувај го ова како норматив“, quick entry
 *   „шифра количина“ (`pcQuickAdd`) and import of a ready work order from Excel / CSV (`pcImport`), „Пушти во
 *   производство и прокнижи“ (`pcRun`).
 * - `PnbRun` — „⚡ Раздолжи и заведи“ without a normativ (`pnbRun`).
 */
import Link from 'next/link';
import { startTransition, useActionState, useMemo, useState } from 'react';
import type { ActionState } from '@/lib/books';
import { fmt, fq } from '@/lib/fmt';
import { parseQuickLines } from '@wise/core/parity-stock';
import type { ItemOpt } from './editors';
import { customProdAction, rnPctAction } from './parity-actions';

const n = (s: string | number | null | undefined) => {
  let v = String(s ?? '').trim().replace(/\s/g, '');
  if (/,\d*$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const lbl = (i: ItemOpt) => (i.code ? i.code + ' · ' : '') + i.name;

export function CustomProdEditor({ items, initial, product, qty, date, wh, labor }: {
  items: ItemOpt[]; initial: { itemId: string; qty: string }[]; product: { id: string; name: string; unit: string }; qty: number; date: string; wh: string; labor: number;
}) {
  const [st, run, pending] = useActionState<ActionState, FormData>(customProdAction, {});
  const [L, setL] = useState(initial.length ? initial : [{ itemId: '', qty: '' }]);
  const [save, setSave] = useState(false);
  const [quick, setQuick] = useState('');
  const [msg, setMsg] = useState('');
  const M = useMemo(() => items.filter((i) => i.type !== 'service' && i.id !== product.id), [items, product.id]);
  const byId = useMemo(() => new Map(M.map((i) => [i.id, i])), [M]);
  const find = (v: string) => {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    const c = s.split(' · ')[0]!.trim().toLowerCase();
    return M.find((i) => i.code && i.code.toLowerCase() === c) ?? M.find((i) => i.name.toLowerCase() === s.toLowerCase() || i.name.toLowerCase() === c);
  };
  const setLine = (k: number, p: Partial<{ itemId: string; qty: string }>) => setL((x) => x.map((l, i) => (i === k ? { ...l, ...p } : l)));
  const addLines = (rows: { code?: string; name?: string; qty: string | number }[]) => {
    const miss: string[] = [];
    let cnt = 0;
    setL((x) => {
      const out = x.filter((r) => r.itemId || n(r.qty));
      for (const r of rows) {
        const it = find(String(r.code ?? '')) ?? find(String(r.name ?? ''));
        if (!it) { miss.push(String(r.code || r.name || '?')); continue; }
        const q = n(r.qty);
        if (!(q > 0)) continue;
        const ex = out.find((o) => o.itemId === it.id);
        if (ex) ex.qty = String(Math.round((n(ex.qty) + q) * 10000) / 10000); else out.push({ itemId: it.id, qty: String(q) });
        cnt++;
      }
      return out;
    });
    setMsg('Додадени ' + cnt + ' материјали.' + (miss.length ? ' Не се најдени: ' + miss.slice(0, 6).join(', ') + (miss.length > 6 ? '…' : '') : ''));
  };
  const imp = async (f: File | undefined) => {
    if (!f) return;
    const { readRows } = await import('../_retail/read-file');
    const { parseImport } = await import('@/components/doc-tools');
    const R = parseImport(await readRows(f), [{ key: 'code', label: 'Шифра', re: 'шифр|šifr|code|код' }, { key: 'name', label: 'Назив', re: 'назив|naziv|опис|name|артикл' }, { key: 'qty', label: 'Количина', re: 'колич|količ|qty|кол\\.', num: true, req: true }]);
    if (R.error) { setMsg('Не е прочитано: ' + R.error); return; }
    addLines(R.rows.map((r) => ({ code: String(r.code ?? ''), name: String(r.name ?? ''), qty: Number(r.qty ?? 0) })));
  };
  const rows = L.map((r) => { const it = byId.get(r.itemId); const have = it?.have[wh] ?? 0; const avg = it?.avgBy?.[wh] || it?.avg || 0; const q = n(r.qty); return { r, it, have, v: Math.round(q * avg * 100) / 100, short: !!it && q > have + 1e-9 }; });
  const mat = rows.reduce((a, x) => a + x.v, 0);
  const lab = Math.round(labor * qty * 100) / 100;
  const go = () => {
    const lines = L.filter((r) => r.itemId && n(r.qty) > 0).map((r) => ({ itemId: r.itemId, qty: n(r.qty) }));
    const fd = new FormData();
    fd.set('payload', JSON.stringify({ date, productId: product.id, qty, wh, mode: 'custom', saveAsBom: save, lines }));
    startTransition(() => run(fd));
  };
  return (
    <div id="pcBox" style={{ marginTop: 8 }}>
      <b>Материјали за овој налог</b> <span className="mini">(вкупно за {fq(qty)} {product.unit})</span>
      {st.error && <div className="callout bad">{st.error}</div>}
      <datalist id="pcL">{M.map((i) => <option key={i.id} value={lbl(i)}>{'залиха ' + fq(i.have[wh] ?? 0) + ' ' + i.unit}</option>)}</datalist>
      <div className="tw" style={{ marginTop: 6 }}><table className="dense">
        <thead><tr><th style={{ width: 90 }}>Шифра</th><th>Материјал</th><th className="n">Количина вкупно</th><th className="n">На залиха</th><th className="n">Вредност</th><th /></tr></thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={i}>
              <td><input defaultValue={x.it?.code ?? ''} key={'c' + x.r.itemId} placeholder="шифра" style={{ width: 80 }} onBlur={(e) => { const f = find(e.target.value); if (e.target.value && !f) setMsg('Нема артикл со шифра „' + e.target.value + '“.'); else if (f) setLine(i, { itemId: f.id }); }} /></td>
              <td><input list="pcL" key={'n' + x.r.itemId} defaultValue={x.it ? lbl(x.it) : ''} placeholder="шифра или назив…" style={{ minWidth: 320 }} onChange={(e) => { const f = find(e.target.value); if (f) setLine(i, { itemId: f.id }); }} /></td>
              <td className="n"><input value={x.r.qty} inputMode="decimal" style={{ width: 110, textAlign: 'right' }} onChange={(e) => setLine(i, { qty: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setL((y) => [...y, { itemId: '', qty: '' }]); } }} /></td>
              <td className="n" style={{ color: x.short ? 'var(--bad)' : undefined }}>{x.it ? fq(x.have) + ' ' + x.it.unit : ''}{x.short ? ' ⚠' : ''}</td>
              <td className="n">{fmt(x.v)}</td>
              <td><button type="button" className="btn sm ghost danger" onClick={() => setL((y) => y.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
          <tr><td /><td>Труд и општи трошоци</td><td colSpan={2} /><td className="n">{fmt(lab)}</td><td /></tr>
        </tbody>
        <tfoot><tr><td colSpan={4}>Вкупна цена на чинење · по единица {fmt(qty ? (mat + lab) / qty : 0)}</td><td className="n">{fmt(mat + lab)}</td><td /></tr></tfoot>
      </table></div>
      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn" onClick={() => setL((y) => [...y, { itemId: '', qty: '' }])}>+ Материјал</button>
        <label className="chk"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> зачувај го ова како норматив за {product.name}</label>
        <span style={{ flex: 1 }} />
        <Link className="btn ghost" href={`/prod?p=${product.id}&q=${qty}&d=${date}&wh=${wh}`}>Откажи измени</Link>
        <button type="button" className="btn pri" disabled={pending || !rows.some((x) => x.it && n(x.r.qty) > 0)} onClick={go}>Пушти во производство и прокнижи</button>
      </div>
      {rows.some((x) => x.short) && <div className="mini" style={{ color: 'var(--bad)', marginTop: 4 }}>⚠ За некои материјали нема доволно залиха – раздолжувањето ќе оди по последната набавна цена.</div>}
      {msg && <div className="mini" style={{ marginTop: 4 }}>{msg}</div>}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>⚡ Брз внес или увоз на готов работен налог</summary>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 6 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="mini">Залепете редови: <b>шифра количина</b> (на пр. „M01 65“, по еден во ред; може и од Excel)</div>
            <textarea rows={5} style={{ width: '100%' }} placeholder={'M01 65\nM02 2,5'} value={quick} onChange={(e) => setQuick(e.target.value)} />
            <button type="button" className="btn sm" onClick={() => { addLines(parseQuickLines(quick)); setQuick(''); }}>+ Додај ги</button>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="mini">или прикачете го налогот што го донел клиентот (Excel, CSV)</div>
            <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => { void imp(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>
      </details>
    </div>
  );
}

export function PnbRun({ productId, qty, date, wh, pct, label, disabled }: { productId: string; qty: number; date: string; wh: string; pct: number; label: string; disabled?: boolean }) {
  const [st, run, pending] = useActionState<ActionState, FormData>(customProdAction, {});
  return (
    <form action={run} style={{ display: 'inline' }}>
      <input type="hidden" name="payload" value={JSON.stringify({ date, productId, qty, wh, mode: 'pct', pct })} />
      <button className="btn pri" disabled={pending || disabled}>{label}</button>
      {st.error && <span className="pill bad">{st.error}</span>}
    </form>
  );
}

export function PnbPct({ pct }: { pct: number }) {
  const [st, run, pending] = useActionState<ActionState, FormData>(rnPctAction, {});
  return (
    <form action={run} className="row" style={{ gap: 4, alignItems: 'end' }}>
      <label className="f" style={{ maxWidth: 220 }}>Учество на суровините во цената %<input name="pct" inputMode="decimal" defaultValue={pct} /></label>
      <button className="btn sm" disabled={pending}>Зачувај %</button>
      {st.error && <span className="pill bad">{st.error}</span>}
    </form>
  );
}
