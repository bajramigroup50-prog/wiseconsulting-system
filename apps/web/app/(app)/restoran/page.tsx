/**
 * Legacy `VIEWS.restoran` 9963 / `roEditor` 9968 — Ресторан – маси: tables by area, open bills, menu (items with a
 * retail price), kitchen orders, payment straight into the Phase 7 POS day (stock + BOM components issued).
 */
import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { retailPrice } from '@wise/core';
import { orderTotal } from '@wise/core/industry';
import { codes, items, listDocs, toStockItem, type RestaurantOrder, type RestaurantTable } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { addItemAction, deleteTableAction, lineAction, noteAction, payAction, saveTableAction, sendKitchenAction, voidAction } from './actions';

export default async function Restoran({ searchParams }: { searchParams: Promise<{ t?: string; q?: string; ed?: string; wh?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('restoran', 'Ресторан – маси');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const T = (await listDocs<RestaurantTable>(db(), firm.id, 'rtable')).sort((a, b) => a.data.no.localeCompare(b.data.no, 'mk', { numeric: true }));
  const O = await listDocs<RestaurantOrder>(db(), firm.id, 'rord', 'open');
  const stores = await db().select({ id: codes.id, name: codes.name, cb: codes.cb }).from(codes).where(and(eq(codes.firmId, firm.id), eq(codes.cb, 'store')));
  const wh = sp.wh ?? stores[0]?.id ?? 'main';

  if (sp.t) {
    const t = T.find((x) => x.id === sp.t);
    if (!t) return <div className="callout bad">Масата не постои.</div>;
    const o = O.find((x) => x.data.tableId === t.id);
    const L = o?.data.lines ?? [];
    const q = (sp.q ?? '').toLowerCase();
    const menu = (await db().select().from(items).where(and(eq(items.firmId, firm.id), eq(items.active, true))).orderBy(asc(items.name)))
      .map((it) => ({ it, p: retailPrice(toStockItem(it), wh) })).filter((x) => x.p > 0 && (!q || `${x.it.name} ${x.it.code ?? ''}`.toLowerCase().includes(q))).slice(0, 60);
    return (
      <>
        <Hd t={`Маса ${t.data.no}`} sub={o ? `отворена ${o.data.opened.slice(11, 16)} · ${o.data.waiter}` : 'нова сметка'}><Link className="btn" href="/restoran">← Маси</Link></Hd>
        <div className="cols" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
          <div className="card">
            <form action="/restoran" className="row" style={{ marginBottom: 8, gap: 6 }}><input type="hidden" name="t" value={t.id} /><input name="q" defaultValue={sp.q ?? ''} placeholder="🔍 Јадење / пијалак" /><button className="btn sm">Барај</button></form>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{menu.map(({ it, p }) => (
              write ? <RowAction key={it.id} className="btn sm" style={{ minWidth: 120 }} action={addItemAction.bind(null, t.id, it.id, wh)} label={<>{it.name}<br /><span className="mini">{fmt(p)}</span></>} /> : <span key={it.id} className="pill">{it.name}</span>
            ))}{!menu.length && <p className="note">Нема артикли со продажна цена. Менито се артиклите (јадења како „Готов производ“ со норматив – при наплата се раздолжуваат суровините).</p>}</div>
          </div>
          <div className="card">
            <table className="dense"><tbody>{L.map((l, i) => (
              <tr key={i}><td>{l.sent ? (l.ready ? '✅' : '🔥') : '📝'} {l.name}{l.note && <span className="mini"> ({l.note})</span>}</td>
                <td className="n" style={{ whiteSpace: 'nowrap' }}>{write && <RowAction action={lineAction.bind(null, t.id, i, 'dec')} label="−" confirm={l.sent ? 'Ставката е веќе во кујна. Да се намали?' : undefined} />} {l.qty} {write && <RowAction action={lineAction.bind(null, t.id, i, 'inc')} label="+" />}</td>
                <td className="n">{fmt(l.qty * l.price)}</td>
                <td>{write && !l.sent && <BankForm action={noteAction} className="row"><input type="hidden" name="table" value={t.id} /><input type="hidden" name="i" value={i} /><input name="note" defaultValue={l.note ?? ''} placeholder="забелешка" style={{ width: 110 }} /></BankForm>}</td></tr>
            ))}{!L.length && <tr><td className="note">Празно.</td></tr>}</tbody>
              <tfoot><tr><td colSpan={2}><b>Вкупно</b></td><td className="n"><b>{fmt(orderTotal(L))}</b></td><td /></tr></tfoot></table>
            {write && o && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {L.some((l) => !l.sent) && <RowAction className="btn" action={sendKitchenAction.bind(null, t.id)} label="🔥 Испрати во кујна" />}
              <Link className="btn" href={`/restoran/smetka?id=${o.id}`} target="_blank">🖨 Сметка (преглед)</Link>
              {(!L.length || !L.some((l) => l.sent)) && <RowAction className="btn ghost" action={voidAction.bind(null, o.id)} confirm="Да се затвори сметката без наплата?" label="Затвори празна" />}
            </div>}
            {write && o && L.length > 0 && (
              <BankForm action={payAction} className="row" style={{ gap: 6, alignItems: 'end', marginTop: 8 }} confirm={`Наплата ${fmt(orderTotal(L))} ден. на каса?`}>
                <input type="hidden" name="order" value={o.id} />
                <label className="f">Објект<select name="wh" defaultValue={wh}><option value="main">Главен магацин</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="f">од тоа картичка<input name="card" type="number" step="any" style={{ width: 100 }} /></label>
                <button className="btn pri">💶 Наплати (каса)</button>
              </BankForm>
            )}
            <p className="mini">📝 нова · 🔥 во кујна · ✅ готово. „Наплати“ ја евидентира продажбата во дневниот промет на касата (раздолжување на залиха и нормативи) и ја затвора масата.</p>
          </div>
        </div>
      </>
    );
  }

  const areas = [...new Set(T.map((t) => t.data.area || 'Сала'))];
  const E = sp.ed === 'new' ? { id: '', data: { no: '', area: 'Сала', seats: 4 } } : T.find((x) => x.id === sp.ed);
  return (
    <>
      <Hd t="Ресторан – маси" sub={`${O.length} отворени сметки`}><Link className="btn" href="/kujna">👨‍🍳 Кујна / шанк</Link>{write && <Link className="btn" href="/restoran?ed=new">+ Маса</Link>}</Hd>
      {!T.length && <div className="callout">Додадете ги масите (+ Маса). Менито се артиклите (јадења како „Готов производ“ со норматив – при наплата се раздолжуваат суровините).</div>}
      {E && write && <BankForm action={saveTableAction} className="card"><input type="hidden" name="id" value={E.id} />
        <div className="form"><label className="f">Маса бр.<input name="no" defaultValue={E.data.no} /></label><label className="f">Простор<input name="area" defaultValue={E.data.area} list="rt_al" /></label>
          <datalist id="rt_al">{['Сала', 'Тераса', 'Бар', 'Сепаре'].map((x) => <option key={x} value={x} />)}</datalist><label className="f">Места<input name="seats" type="number" defaultValue={E.data.seats} /></label></div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} />{E.id && <RowAction className="btn ghost" action={deleteTableAction.bind(null, E.id)} label="Избриши" confirm="Да се избрише масата?" />}<Link className="btn" href="/restoran">Откажи</Link><button className="btn pri">Зачувај</button></div>
      </BankForm>}
      {areas.map((a) => (
        <div key={a} className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>{a}</h2>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{T.filter((t) => (t.data.area || 'Сала') === a).map((t) => {
            const o = O.find((x) => x.data.tableId === t.id);
            const pend = o ? o.data.lines.filter((l) => !l.sent).length : 0;
            return <Link key={t.id} className="btn" href={`/restoran?t=${t.id}`} style={{ width: 120, height: 90, flexDirection: 'column', display: 'flex', justifyContent: 'center', alignItems: 'center', ...(o ? { background: '#ffd9a8', borderColor: '#e08a00' } : {}) }}>
              <b style={{ fontSize: 18 }}>{t.data.no}</b><span className="mini">{o ? fmt(orderTotal(o.data.lines)) + ' ден.' : 'слободна'}</span>
              {o && <span className="mini">{o.data.waiter} · {o.data.opened.slice(11, 16)}{pend ? ` · ⏳${pend}` : ''}</span>}</Link>;
          })}</div>
          {write && <div className="mini" style={{ marginTop: 6 }}>{T.filter((t) => (t.data.area || 'Сала') === a).map((t) => <Link key={t.id} href={`/restoran?ed=${t.id}`} style={{ marginRight: 8 }}>✎ {t.data.no}</Link>)}</div>}
        </div>
      ))}
    </>
  );
}
