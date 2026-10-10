/**
 * Реална цена на чинење — legacy `VIEWS.prodCost` 10015, `pcCfgSave`: material and labour of the work orders in the
 * period (plus write-offs without a BOM that received a product), overheads from the ledger on the given account
 * prefixes (close journals excluded) spread by material value, labour or quantity; real vs standard (BOM) unit cost and
 * margin over the net selling price.
 */
import Link from 'next/link';
import { and, eq, gte, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import { Retail, unitCost } from '@wise/core';
import { journalLines, journals, productionOrders, writeoffDocs } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { settingsOf } from '@/lib/retail';
import { rangeOf, stockPage } from '@/lib/stock';
import { fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/action-form';
import { pcCfgAction } from '../_retail/actions';

export default async function ProdCostPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('prodCost');
  if (!firm || !L) return <NoFirm t="Реална цена на чинење" />;
  const write = canDo(u, 'pcCfgSave', firm.id);
  const [a, b] = rangeOf({ from: sp.from, to: sp.to ?? `${year}-12-31` }, year);
  const C = { oh: '', basis: 'mat', ...((settingsOf(firm).pcost ?? {}) as { oh?: string; basis?: string }) };
  const pref = Retail.overheadPrefixes(C.oh);
  const [PO, WO, OH] = await Promise.all([
    db().select().from(productionOrders).where(and(eq(productionOrders.firmId, firm.id), gte(productionOrders.date, a), lte(productionOrders.date, b))),
    db().select().from(writeoffDocs).where(and(eq(writeoffDocs.firmId, firm.id), isNotNull(writeoffDocs.productId), gte(writeoffDocs.date, a), lte(writeoffDocs.date, b))),
    pref.length ? db().select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(eq(journals.firmId, firm.id), gte(journals.date, a), lte(journals.date, b), ne(journals.kind, 'close'), or(...pref.map((p) => sql`${journalLines.account} like ${p + '%'}`)))) : Promise.resolve([{ s: '0' }]),
  ]);
  const overhead = Math.round(Number(OH[0]?.s ?? 0) * 100) / 100;
  const recs = [
    ...PO.map((x) => ({ productId: x.productId, qty: Number(x.qty), mat: Number(x.mat), lab: Number(x.lab) })),
    ...WO.map((x) => ({ productId: x.productId!, qty: Number(x.productQty ?? 0), mat: Number(x.total), lab: 0 })),
  ];
  const it = (id: string) => L.ctx.items?.find((i) => i.id === id);
  const basis = (['mat', 'lab', 'qty'].includes(C.basis) ? C.basis : 'mat') as Retail.OverheadBasis;
  const R = Retail.productionCost(recs, { overhead, basis, std: (id) => unitCost(L.ctx, it(id)), price: (id) => Number(it(id)?.price ?? 0) });
  return (
    <>
      <Hd t="Реална цена на чинење" sub="по производ"><Link className="btn" href="/prod">🏭 Работни налози</Link></Hd>
      <div className="card">
        <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f">Од<input type="date" name="from" defaultValue={a} /></label><label className="f">До<input type="date" name="to" defaultValue={b} /></label><button className="btn">Прикажи</button>
        </form>
        <ActionForm action={pcCfgAction} className="" reset={false}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
            <label className="f">Општи трошоци од конта (почеток)<input name="oh" defaultValue={C.oh} placeholder="на пр. 401, 410, 4200" style={{ width: 220 }} /></label>
            <label className="f">Распоред според<select name="basis" defaultValue={basis}><option value="mat">вредност на материјал</option><option value="lab">труд</option><option value="qty">количина</option></select></label>
            {write && <button className="btn">Пресметај</button>}
          </div>
        </ActionForm>
        <p className="note" style={{ margin: '6px 0 0' }}>Општи трошоци (струја, кирија, амортизација на машини…) за периодот: <b>{fmt(overhead)}</b> ден. – се распоредуваат на производите. Не внесувајте ги контата што веќе се во нормативот како труд.</p>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Производ</th><th className="n">Произведено</th><th className="n">Материјал</th><th className="n">Труд (норм.)</th><th className="n">Општи трошоци</th><th className="n">Реална цена/ед.</th><th className="n">Нормативна</th><th className="n">Отстапување</th><th className="n">Продажна цена</th><th className="n">Маржа</th></tr></thead>
        <tbody>{R.map((x) => (
          <tr key={x.productId}>
            <td>{it(x.productId)?.name ?? '?'}</td><td className="n">{fq(x.q)} {it(x.productId)?.unit}</td><td className="n">{fmt(x.mat)}</td><td className="n">{fmt(x.lab)}</td><td className="n">{fmt(x.ohA)}</td>
            <td className="n"><b>{fmt(x.real)}</b></td><td className="n">{fmt(x.std)}</td>
            <td className="n">{x.var == null ? '' : <span className={'pill ' + (x.var > 10 ? 'bad' : x.var > 3 ? 'warn' : 'good')}>{x.var > 0 ? '+' : ''}{fq(x.var)}%</span>}</td>
            <td className="n">{fmt(x.price)}</td><td className="n" style={x.mar != null && x.mar < 0 ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{x.mar == null ? '' : fq(x.mar) + '%'}</td>
          </tr>
        ))}{!R.length && <tr><td colSpan={10} className="note">Нема производство во периодот.</td></tr>}</tbody>
      </table></div>
      <p className="note">Материјалот е по реалната (просечна) цена од залихата при пуштањето во производство; нормативната цена е со денешните цени. Маржата е без ДДВ.</p>
    </>
  );
}
