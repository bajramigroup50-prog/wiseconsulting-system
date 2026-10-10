/**
 * Legacy `VIEWS.frFak` 14682 (v475) — 🧾 Фактури за превоз: the invoices issued from freight tours (they are ordinary
 * Phase 3 invoices, also in Излезни фактури), with the tours, the foreign-currency amount, paid and status.
 */
import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { documentPayments, freightTours, invoices, partners } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { Hd } from '@/components/hd';

export default async function FrFak() {
  const g = await industryPage('frFak', 'Фактури за превоз');
  if (g.blocked) return g.blocked;
  const { firm, year } = g;
  const L = await db().select({ id: invoices.id, number: invoices.number, date: invoices.date, currency: invoices.currency, total: invoices.total, fx: invoices.fx, p: partners.name })
    .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), sql`${invoices.data}->'source'->>'type' = 'freight_tour'`, sql`extract(year from ${invoices.date}) = ${year}`))
    .orderBy(desc(invoices.date), desc(invoices.number));
  const ids = L.map((i) => i.id);
  const [T, pay] = await Promise.all([
    ids.length ? db().select({ id: freightTours.id, number: freightTours.number, inv: freightTours.invoiceId }).from(freightTours).where(and(eq(freightTours.firmId, firm.id), inArray(freightTours.invoiceId, ids))) : Promise.resolve([]),
    documentPayments(db(), firm.id, { invoiceIds: ids }),
  ]);
  let sT = 0, sP = 0;
  const rows = L.map((i) => {
    const pm = pay.get(i.id);
    const tot = pm?.total ?? Number(i.total) * (i.currency !== 'MKD' ? Number(i.fx) || 1 : 1);
    const paid = pm?.paid ?? 0;
    sT += tot; sP += paid;
    const rest = tot - paid;
    const st = rest <= 0.5 ? ['good', 'платена'] : paid > 0 ? ['warn', 'делумно'] : ['', 'неплатена'];
    return { i, tot, paid, st, tours: T.filter((t) => t.inv === i.id) };
  });
  return (
    <>
      <Hd t="🧾 Фактури за превоз" sub={`${L.length} фактури · ${year}`}>
        <Link className="btn" href="/izlez">Сите излезни фактури</Link>{g.write && <Link className="btn pri" href="/frTuri">+ Фактура од тури</Link>}
      </Hd>
      <p className="note">Фактурите направени од турите се зачувани и прокнижени како обични излезни фактури – ги гледате и тука и во <b>Материјално → Излезни фактури</b>. Измена, е-пошта и PDF – со „Отвори“.</p>
      {L.length ? (
        <div className="tw"><table><thead><tr><th>Фактура</th><th>Клиент</th><th>Тури</th><th className="n">Девизи</th><th className="n">Износ ден.</th><th className="n">Платено</th><th>Статус</th><th /></tr></thead>
          <tbody>{rows.map(({ i, tot, paid, st, tours }) => (
            <tr key={i.id}><td><b>{i.number}</b><br /><small className="note">{dmy(i.date)}</small></td><td>{i.p}</td>
              <td>{tours.map((t, k) => <span key={t.id}>{k > 0 && ', '}<Link href={`/frTuri?id=${t.id}`}>{t.number}</Link></span>)}</td>
              <td className="n">{i.currency !== 'MKD' ? `${fmt(i.total)} ${i.currency}` : ''}</td><td className="n">{fmt(tot)}</td><td className="n">{fmt(paid)}</td>
              <td><span className={`pill ${st[0]}`}>{st[1]}</span></td>
              <td><Link className="btn sm" href={`/print/doc/${i.id}`} target="_blank">Отвори / PDF</Link>{g.write && <Link className="btn sm" href={`/izlez?edit=${i.id}`}>Измени</Link>}</td></tr>))}</tbody>
          <tfoot><tr><th colSpan={4}>Вкупно</th><th className="n">{fmt(sT)}</th><th className="n">{fmt(sP)}</th><th colSpan={2}>должат: {fmt(Math.round((sT - sP) * 100) / 100)}</th></tr></tfoot></table></div>
      ) : <div className="empty">Сè уште нема фактури од тури. Во „🚛 Тури“ штиклирајте завршени тури на ист клиент → „🧾 Фактура од избраните тури“.</div>}
    </>
  );
}
