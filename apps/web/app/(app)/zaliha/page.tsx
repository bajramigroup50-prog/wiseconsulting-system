/**
 * Приемници и издатници — legacy `VIEWS.zaliha` 4890, `ACT.newMove` / `saveMove` 7213–7219, `card`, `stockCsv`.
 * Stock by location with average cost and minimum warnings, the item card, and manual receipts (with or without a
 * posting), issues for consumption (Д expense / П stock) and transfers between locations. FIX: manual documents are
 * listed and can be deleted (legacy had no way back except deleting raw moves).
 */
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { stock } from '@wise/core';
import { stockMoves } from '@wise/db';
import { canDo, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { accountOptions } from '@/lib/sales';
import { locOptions, pickLoc, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm, PrintButton } from '@/components/stock-ui';
import { ExportButtons, ServerPdfButton } from '@/components/doc-tools';
import { PrintHead, PrintSig } from '@/components/print-head';
import { deleteMoveAction, saveMoveAction } from '../_retail/actions';

const TYPES: Record<string, string> = { goods: 'Стока', material: 'Суровина / материјал', product: 'Готов производ' };
const KIND: Record<string, string> = { in: 'Приемница', use: 'Издатница (потрошувачка)', tr: 'Преносница (меѓу објекти)' };
type SP = { wh?: string; card?: string; nov?: string };

export default async function ZalihaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('zaliha');
  if (!firm || !L) return <NoFirm t="Приемници и издатници" />;
  const write = canDo(u, 'saveMove', firm.id), del = canDo(u, 'del', firm.id);
  const wh = pickLoc(L, sp.wh);
  const W = wh || undefined;
  const locs = locOptions(L);
  const tracked = (L.ctx.items ?? []).filter((i) => i.type && i.type !== 'service').sort((a, b) => String(a.name).localeCompare(String(b.name), 'mk'));
  const rows = tracked.map((it) => ({ it, s: stock(L.ctx, it.id, W) }));
  const total = rows.reduce((s, r) => s + r.s.value, 0);
  const kind = sp.nov && KIND[sp.nov] ? sp.nov : '';
  const today = todayIso();
  const dflt = today.startsWith(String(year)) ? today : `${year}-12-31`;
  const [docs, partners, exp, cnt] = await Promise.all([
    db().select().from(stockMoves).where(and(eq(stockMoves.firmId, firm.id), eq(stockMoves.sourceType, 'manual_move'))).orderBy(desc(stockMoves.date), desc(stockMoves.createdAt)).limit(300),
    kind === 'in' ? partnerOptions(firm.id) : Promise.resolve([]),
    kind === 'use' ? accountOptions(firm.id, (k) => k.startsWith('4')) : Promise.resolve([] as [string, string][]),
    kind === 'in' ? accountOptions(firm.id, (k) => ['2200', '1020', '4900', '7700'].includes(k) || /^22/.test(k)) : Promise.resolve([] as [string, string][]),
  ]);
  const byDoc = new Map<string, typeof docs>();
  for (const m of docs) byDoc.set(m.sourceId, [...(byDoc.get(m.sourceId) ?? []), m]);
  const names = new Map(tracked.map((i) => [i.id, i.name ?? '']));
  const sel = sp.card ? tracked.find((i) => i.id === sp.card) : undefined;
  let q = 0, v = 0;
  const card = sel ? L.ctx.moves.filter((m) => m.item === sel.id && !m.pend && (!W || (m.wh || 'main') === W)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) : [];
  const qs = (p: Record<string, string | undefined>) => '?' + new URLSearchParams(Object.entries({ wh: wh || undefined, ...p }).filter(([, x]) => x) as [string, string][]).toString();

  return (
    <>
      <Hd exp={false} t="Приемници и издатници" sub="залиха по објекти">
        {write && <><Link className="btn" href={'/zaliha' + qs({ nov: 'in' })}>+ Приемница</Link><Link className="btn" href={'/zaliha' + qs({ nov: 'use' })}>+ Издатница</Link><Link className="btn" href={'/zaliha' + qs({ nov: 'tr' })}>+ Преносница</Link></>}
        <ExportButtons name={`Zaliha_${today}`} rows={[['Артикл', 'Вид', 'Количина', 'Ед. мерка', 'Просечна цена', 'Вредност'], ...rows.map((r) => [r.it.name ?? '', TYPES[String(r.it.type)] ?? '', r.s.qty, r.it.unit ?? '', r.s.avg, r.s.value])]} />
        <ServerPdfButton title="Состојба на залиха" className="btn" />
        <PrintButton label="Печати состојба" className="btn" />
        <Link className="btn" href={`/print/kartice?v=zaliha&from=${year}-01-01&to=${year}-12-31${wh ? '&wh=' + wh : ''}`} target="_blank">PDF сите картици</Link>
      </Hd>
      <form className="card"><div className="row">
        <label className="f">Прикажи залиха за<select name="wh" defaultValue={wh}><option value="">сите објекти</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <button className="btn">Прикажи</button>
      </div></form>
      {write && kind && (
        <ActionForm action={saveMoveAction}>
          <h2>{KIND[kind]}</h2>
          <input type="hidden" name="kind" value={kind} />
          <div className="form">
            <label className="f">Датум<input name="date" type="date" defaultValue={dflt} /></label>
            {kind === 'tr' ? <>
              <label className="f">Од објект<select name="from" defaultValue="main">{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label className="f">Во објект<select name="to" defaultValue={locs[1]?.id}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            </> : <label className="f">{kind === 'in' ? 'Во објект' : 'Од објект'}<select name="wh" defaultValue={wh || 'main'}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
            <label className="f">Артикл<select name="itemId">{tracked.map((i) => <option key={i.id} value={i.id}>{i.code ? i.code + ' · ' : ''}{i.name}</option>)}</select></label>
            <label className="f">Количина<input name="qty" inputMode="decimal" required /></label>
            {kind === 'in' && <>
              <label className="f">Единечна цена (набавна)<input name="price" inputMode="decimal" /></label>
              <label className="f">Спротивно конто<select name="account" defaultValue=""><option value="">Без книжење (фактурата е веќе прокнижена)</option>{cnt.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}</select></label>
              <label className="f">Комитент (за 22x)<select name="partnerId" defaultValue=""><option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </>}
            {kind === 'use' && <label className="f">Конто за трошок<select name="account" defaultValue="4000">{exp.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}</select></label>}
            <label className="f wide">Опис<input name="label" /></label>
          </div>
          <div className="row"><Link className="btn" href={'/zaliha' + qs({})}>Откажи</Link><button className="btn pri">Зачувај</button></div>
        </ActionForm>
      )}
      <div className="printarea" id="rpt">
        <PrintHead firm={firm} title="СОСТОЈБА НА ЗАЛИХА" sub={'на ден ' + dmy(today) + (wh ? ' · ' + L.locName(wh) : '')} />
        {rows.length ? (
          <div className="tw"><table>
            <thead><tr><th>Артикл</th><th>Вид</th><th className="n">Количина</th><th>Ед. мерка</th><th className="n">Просечна цена</th><th className="n">Вредност</th><th>Минимум</th><th className="noprint" /></tr></thead>
            <tbody>{rows.map(({ it, s }) => (
              <tr key={it.id}>
                <td>{it.name}</td><td><span className="pill">{TYPES[String(it.type)]}</span></td><td className="n">{fq(s.qty)}</td><td>{it.unit}</td><td className="n">{fmt(s.avg)}</td><td className="n">{fmt(s.value)}</td>
                <td>{Number(it.min) ? (s.qty < Number(it.min) ? <span className="pill bad">под минимум</span> : <span className="pill good">во ред</span>) : null}</td>
                <td className="noprint" style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={'/zaliha' + qs({ card: it.id })}>Картица</Link> <Link className="btn sm" href={`/print/kartice?v=zaliha&i=${it.id}&from=${year}-01-01&to=${year}-12-31${wh ? '&wh=' + wh : ''}`} target="_blank">PDF</Link></td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={5}>Вкупна вредност на залихата</td><td className="n">{fmt(total)}</td><td colSpan={2} /></tr></tfoot>
          </table></div>
        ) : <div className="card empty">Нема артикли со залиха. Во „Артикли“ изберете вид стока, материјал или производ.</div>}
        <PrintSig />
      </div>
      {sel && (
        <div className="card"><h2>Картица: {sel.name}</h2>
          <div className="tw"><table>
            <thead><tr><th>Датум</th><th>Документ</th><th className="n">Влез</th><th className="n">Излез</th><th className="n">Состојба</th><th className="n">Вредност</th></tr></thead>
            <tbody>{card.map((x, i) => { q += x.qty; v += x.value; return <tr key={i}><td>{dmy(x.date)}</td><td>{x.label || x.type}</td><td className="n">{x.qty > 0 ? fq(x.qty) : ''}</td><td className="n">{x.qty < 0 ? fq(-x.qty) : ''}</td><td className="n">{fq(q)}</td><td className="n">{fmt(v)}</td></tr>; })}</tbody>
          </table></div>
          <p><Link href={`/g_kartica?i=${sel.id}`}>Материјална картица (големо) →</Link></p>
        </div>
      )}
      {byDoc.size > 0 && (
        <div className="card"><h2>Рачни приемници, издатници и преносници</h2>
          <div className="tw"><table>
            <thead><tr><th>Датум</th><th>Документ</th><th>Артикл</th><th className="n">Количина</th><th className="n">Вредност</th><th /></tr></thead>
            <tbody>{[...byDoc.entries()].map(([id, ms]) => {
              const m = ms.find((x) => Number(x.qty) < 0) ?? ms[0]!;
              return <tr key={id}><td>{dmy(m.date)}</td><td>{m.label}</td><td>{names.get(m.itemId)}</td><td className="n">{fq(Math.abs(Number(m.qty)))}</td><td className="n">{fmt(Math.abs(Number(m.value)))}</td>
                <td>{del && <RowAction action={deleteMoveAction.bind(null, id)} label="🗑" title="Избриши" confirm="Да се избрише документот (и неговото книжење)?" />}</td></tr>;
            })}</tbody>
          </table></div>
        </div>
      )}
    </>
  );
}
