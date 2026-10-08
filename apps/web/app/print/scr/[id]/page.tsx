/** Print of a supplier return / credit (legacy `scrPdfHTML` 8813). */
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { firms, partners, purchases, supplierCreditLines, supplierCredits } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';


export default async function PrintScr({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [d] = await db().select().from(supplierCredits).where(eq(supplierCredits.id, id)).limit(1);
  if (!d || !firmAllowed(u.principal, d.firmId)) notFound();
  const [[f], [p], L, pur] = await Promise.all([
    db().select().from(firms).where(eq(firms.id, d.firmId)).limit(1),
    db().select().from(partners).where(eq(partners.id, d.partnerId)).limit(1),
    db().select().from(supplierCreditLines).where(eq(supplierCreditLines.creditId, id)).orderBy(asc(supplierCreditLines.lineNo)),
    d.refPurchaseId ? db().select().from(purchases).where(eq(purchases.id, d.refPurchaseId)).limit(1) : Promise.resolve([]),
  ]);
  if (!f) notFound();
  const rows = L.map((r) => { const b = Math.round(Number(r.qty) * Number(r.price)); const v = f.vatRegistered && r.rate ? Math.round((b * r.rate) / 100) : 0; return { r, b, v }; });
  return (
    <>

      <div className="pdfdoc printarea">
        <div className="ph"><div><div className="pt">{d.kind === 'ret' ? 'ПОВРАТНИЦА ДО ДОБАВУВАЧ' : 'КНИЖНО ОДОБРЕНИЕ ОД ДОБАВУВАЧ'}</div><div className="ps">бр. {d.number} од {dmy(d.date)}</div></div><div className="pm">{f.name}</div></div>
        <p>Од: <b>{f.name}</b> · ЕДБ {f.edb}<br />До: <b>{p?.name}</b>{p?.edb && ' · ЕДБ ' + p.edb}
          {pur[0] && <><br />Кон влезна фактура бр. <b>{pur[0].number}</b> од {dmy(pur[0].date)}</>}{d.supNo && <><br />Одобрение од добавувачот бр. <b>{d.supNo}</b></>}{d.note && <><br />Причина: {d.note}</>}</p>
        <table><thead><tr><th>Р.бр</th><th>Опис</th><th className="n">Кол.</th><th className="n">Цена</th><th className="n">ДДВ %</th><th className="n">Основа</th><th className="n">ДДВ</th><th className="n">Вкупно</th></tr></thead>
          <tbody>{rows.map(({ r, b, v }, i) => <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td className="n">{fq(r.qty)}</td><td className="n">{fmt(r.price)}</td><td className="n">{r.rate}</td><td className="n">{fmt(b)}</td><td className="n">{fmt(v)}</td><td className="n">{fmt(b + v)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(d.base)}</td><td className="n">{fmt(d.vat)}</td><td className="n">{fmt(d.total)}</td></tr></tfoot></table>
        <div className="sig"><span>{d.kind === 'ret' ? 'Предал' : 'Составил'}</span><span>{d.kind === 'ret' ? 'Примил (добавувач)' : 'Одговорно лице'}</span></div>
      </div>
    </>
  );
}
