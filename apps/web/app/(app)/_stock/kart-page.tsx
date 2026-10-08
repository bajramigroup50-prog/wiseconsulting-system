/**
 * Материјална картица / Картица на производ — legacy `kartView(retail)` 4981 (`kartData` 4973, `kartTable` 4979).
 * At cost (g_kartica) or at the current retail price of the location (m_kartica).
 */
import { itemCard, trackedItems, type ItemCardMove } from '@wise/core';
import { stockPage, locOptions, pickLoc, rangeOf } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PrintButton } from '@/components/stock-ui';

export type KartSP = { i?: string; wh?: string; from?: string; to?: string };

export async function KartPage({ retail, sp }: { retail: boolean; sp: KartSP }) {
  const t = retail ? 'Картица на производ' : 'Материјална картица';
  const { firm, year, L } = await stockPage(retail ? 'm_kartica' : 'g_kartica');
  if (!firm || !L) return <NoFirm t={t} />;
  const its = trackedItems(L.ctx);
  const it = its.find((i) => i.id === sp.i) ?? its[0];
  if (!it) return <><Hd t={t} /><div className="card empty">Нема артикли со залиха.</div></>;
  const wh = pickLoc(L, sp.wh);
  const [from, to] = rangeOf(sp, year);
  const k = itemCard(L.ctx, { item: it, wh, from, to, retail });
  return (
    <>
      <Hd t={t} sub={retail ? 'по малопродажна цена' : 'по набавна вредност'}><PrintButton /></Hd>
      <form className="card">
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f" style={{ minWidth: 260 }}>Артикл
            <select name="i" defaultValue={it.id}>{its.map((i) => <option key={i.id} value={i.id}>{(i.code ? i.code + ' · ' : '') + i.name}</option>)}</select>
          </label>
          <label className="f">Објект
            <select name="wh" defaultValue={wh}><option value="">Сите објекти</option>{locOptions(L).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </div>
      </form>
      <div className="tw printarea">
        <p className="mini">{firm.name} · {t} · {(it.code ? it.code + ' · ' : '') + it.name} · {wh ? L.locName(wh) : 'сите објекти'} · {dmy(from)} – {dmy(to)}</p>
        <table className="kart">
          <thead><tr><th>Датум</th><th>Документ</th><th className="n">Влез</th><th className="n">Излез</th><th className="n">{retail ? 'МПЦ' : 'Цена'}</th><th className="n">Вредност влез</th><th className="n">Вредност излез</th><th className="n">Состојба</th><th className="n">Вредност</th></tr></thead>
          <tbody>
            {k.rows.map((r, i) => r.open
              ? <tr key={i} className="sub"><td>{dmy(from)}</td><td>Почетна состојба</td><td /><td /><td /><td /><td /><td className="n">{fq(r.q)}</td><td className="n">{fmt(r.v)}</td></tr>
              : <MoveRow key={i} r={r} />)}
          </tbody>
          <tfoot><tr><td colSpan={2}>Вкупно</td><td className="n">{fq(k.totals.in)}</td><td className="n">{fq(k.totals.out)}</td><td /><td className="n">{fmt(k.totals.vin)}</td><td className="n">{fmt(k.totals.vout)}</td><td className="n">{fq(k.totals.q)}</td><td className="n">{fmt(k.totals.v)}</td></tr></tfoot>
        </table>
      </div>
    </>
  );
}

function MoveRow({ r }: { r: ItemCardMove }) {
  return (
    <tr>
      <td>{dmy(r.move.date)}</td><td>{r.move.label || r.move.type}</td>
      <td className="n">{r.in ? fq(r.in) : ''}</td><td className="n">{r.out ? fq(r.out) : ''}</td><td className="n">{fmt(r.price)}</td>
      <td className="n">{r.vin ? fmt(r.vin) : ''}</td><td className="n">{r.vout ? fmt(r.vout) : ''}</td><td className="n">{fq(r.q)}</td><td className="n">{fmt(r.v)}</td>
    </tr>
  );
}
