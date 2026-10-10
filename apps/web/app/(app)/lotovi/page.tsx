/**
 * Лотови и рок на траење — legacy `VIEWS.lotovi` 10027, `lotIns`, `lotBal` (FEFO), `lotSave`, `lotDays`.
 * Lots and expiry dates are entered per purchase stock line or production order; the stock of each item is attributed
 * to its lots by FEFO and lots close to expiry are flagged.
 */
import Link from 'next/link';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { Retail, stock } from '@wise/core';
import { partners, productionOrders, purchases, purchaseStockLines, stockLots } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { settingsOf } from '@/lib/retail';
import { stockPage, todayIso } from '@/lib/stock';
import { dmy, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/action-form';
import { lotDaysAction, saveLotsAction } from '../_retail/actions';

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);

export default async function LotoviPage({ searchParams }: { searchParams: Promise<{ t?: string; q?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('lotovi');
  if (!firm || !L) return <NoFirm t="Лотови и рок на траење" />;
  const write = canDo(u, 'lotSave', firm.id);
  const days = Number(settingsOf(firm).lotDays) || 30;
  const T0 = todayIso();
  const T = sp.t === 'in' ? 'in' : 'bal';
  const lots = await db().select().from(stockLots).where(eq(stockLots.firmId, firm.id));
  const nm = (id: string) => L.items.get(id)?.name ?? '?';
  const tabs = <div className="row" style={{ gap: 6, marginBottom: 8 }}><Link className={`btn ${T === 'bal' ? 'pri' : ''}`} href="/lotovi">📦 Залиха по лот</Link><Link className={`btn ${T === 'in' ? 'pri' : ''}`} href="/lotovi?t=in">✍ Внес на лотови</Link></div>;
  const head = (
    <Hd t="Лотови и рок на траење" sub="FEFO">
      {write && <ActionForm action={lotDaysAction} className="" reset={false} style={{ display: 'inline-flex' }}>
        <label className="mini" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>⚙ Предупредување <input name="days" defaultValue={days} style={{ width: 50 }} /> дена <button className="btn sm">Зачувај</button></label>
      </ActionForm>}
    </Hd>
  );

  if (T === 'bal') {
    const srcIds = [...new Set(lots.filter((l) => l.sourceType === 'purchase').map((l) => l.sourceId))];
    const pur = srcIds.length ? await db().select({ id: purchases.id, number: purchases.number, date: purchases.date, pn: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId)).where(inArray(purchases.id, srcIds)) : [];
    const prIds = [...new Set(lots.filter((l) => l.sourceType === 'production').map((l) => l.sourceId))];
    const pr = prIds.length ? await db().select({ id: productionOrders.id, date: productionOrders.date }).from(productionOrders).where(inArray(productionOrders.id, prIds)) : [];
    const ins = lots.map((l) => {
      const p = pur.find((x) => x.id === l.sourceId), o = pr.find((x) => x.id === l.sourceId);
      return { itemId: l.itemId, qty: Number(l.qty), lot: l.lot ?? '', exp: l.expiry, date: p?.date ?? o?.date ?? '', src: p ? 'Влез ' + p.number : 'Производство', pn: p?.pn ?? '' };
    });
    const B = [...new Set(ins.map((l) => l.itemId))].flatMap((id) => Retail.lotBalance(ins.filter((l) => l.itemId === id), stock(L.ctx, id).qty));
    const q = (sp.q ?? '').toLowerCase().trim();
    const BB = B.filter((l) => !q || `${nm(l.itemId)} ${l.lot}`.toLowerCase().includes(q)).sort((a, b) => nm(a.itemId).localeCompare(nm(b.itemId), 'mk') || String(a.exp).localeCompare(String(b.exp)));
    const soon = B.filter((l) => l.exp && dayDiff(l.exp, T0) <= days);
    return (
      <>
        {head}{tabs}
        {soon.length > 0 && <div className="callout warn">⏰ {soon.filter((l) => l.exp! < T0).length} лотови со истечен рок, {soon.filter((l) => l.exp! >= T0).length} истекуваат во следните {days} дена.</div>}
        <form><input name="q" placeholder="🔍 Артикл или лот" defaultValue={sp.q ?? ''} style={{ width: 280, marginBottom: 8 }} /></form>
        <div className="tw"><table className="dense">
          <thead><tr><th>Артикл</th><th>Лот / серија</th><th>Рок на траење</th><th className="n">На залиха (FEFO)</th><th>Влез</th><th>Добавувач</th></tr></thead>
          <tbody>{BB.map((l, i) => {
            const d = l.exp ? dayDiff(l.exp, T0) : null;
            return <tr key={i}><td>{nm(l.itemId)}</td><td><b>{l.lot || '—'}</b></td>
              <td>{l.exp ? <><span className={'pill ' + (d! < 0 ? 'bad' : d! <= days ? 'warn' : 'good')}>{dmy(l.exp)}</span>{d != null && d <= days && <span className="mini"> {d < 0 ? 'истечен' : d + ' дена'}</span>}</> : '—'}</td>
              <td className="n">{fq(l.on)}</td><td className="mini">{l.src} · {dmy(l.date)}</td><td className="mini">{l.pn}</td></tr>;
          })}{!BB.length && <tr><td colSpan={6} className="note">Нема внесени лотови.</td></tr>}</tbody>
        </table></div>
        <p className="note">Залихата по лот се пресметува по правилото FEFO (прво излегува тоа што најрано истекува): продадената количина се одзема од лотовите со најкраток рок. Затоа при продажба/издавање земајте го лотот со најкраток рок – прикажан прв.</p>
      </>
    );
  }

  const P = await db().select({ id: purchases.id, number: purchases.number, date: purchases.date, pn: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
    .where(and(eq(purchases.firmId, firm.id), eq(purchases.ptype, 'stock'), eq(purchases.status, 'posted'), gte(purchases.date, `${year}-01-01`), lte(purchases.date, `${year}-12-31`))).orderBy(desc(purchases.date)).limit(40);
  const ST = P.length ? await db().select().from(purchaseStockLines).where(inArray(purchaseStockLines.purchaseId, P.map((p) => p.id))).orderBy(asc(purchaseStockLines.lineNo)) : [];
  const PR = await db().select().from(productionOrders).where(and(eq(productionOrders.firmId, firm.id), gte(productionOrders.date, `${year}-01-01`), lte(productionOrders.date, `${year}-12-31`))).orderBy(desc(productionOrders.date)).limit(30);
  const lotOf = (t: string, id: string, ix: number) => lots.find((l) => l.sourceType === t && l.sourceId === id && l.lineNo === ix);
  return (
    <>
      {head}{tabs}
      <ActionForm action={saveLotsAction} className="" reset={false}>
        <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Влезни фактури – внеси лот и рок за секоја ставка</h2>
          {P.map((p) => {
            const lines = ST.filter((s) => s.purchaseId === p.id);
            return (
              <details key={p.id}><summary style={{ cursor: 'pointer', padding: '4px 0' }}><b>{p.number}</b> · {dmy(p.date)} · {p.pn}{lines.length > 0 && lines.every((x) => lotOf('purchase', p.id, x.lineNo)?.expiry) && <> <span className="pill good">внесено</span></>}</summary>
                <table className="dense"><tbody>{lines.map((x) => {
                  const lt = lotOf('purchase', p.id, x.lineNo);
                  const k = `purchase|${p.id}|${x.lineNo}`;
                  return <tr key={x.id}><td>{nm(x.itemId) || x.name}</td><td className="n">{fq(x.qty)}</td><td><input name={'lot|' + k} defaultValue={lt?.lot ?? ''} placeholder="лот / серија" style={{ width: 140 }} /></td><td><input type="date" name={'exp|' + k} defaultValue={lt?.expiry ?? ''} /></td></tr>;
                })}</tbody></table>
              </details>
            );
          })}{!P.length && <p className="note">Нема влезни фактури со залиха.</p>}
        </div>
        <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Производство – лот и рок на готовиот производ</h2>
          <table className="dense"><tbody>{PR.map((x) => {
            const lt = lotOf('production', x.id, 0);
            const k = `production|${x.id}|0`;
            return <tr key={x.id}><td>{dmy(x.date)}</td><td>{nm(x.productId)}</td><td className="n">{fq(x.qty)}</td><td><input name={'lot|' + k} defaultValue={lt?.lot ?? ''} placeholder="лот" style={{ width: 140 }} /></td><td><input type="date" name={'exp|' + k} defaultValue={lt?.expiry ?? ''} /></td></tr>;
          })}{!PR.length && <tr><td className="note">Нема производство.</td></tr>}</tbody></table>
        </div>
        {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај лотови</button></div>}
      </ActionForm>
    </>
  );
}
