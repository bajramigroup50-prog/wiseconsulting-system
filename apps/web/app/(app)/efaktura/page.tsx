/**
 * Legacy `VIEWS.efaktura` 5130 — Е-Фактура: UBL 2.1 export of issued invoices / credit notes and UBL import of
 * received e-invoices (through the scan pipeline, without AI).
 */
import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { invoices, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ScanUpload } from '@/components/sales/scan-upload';

export default async function EfakturaPage() {
  const { u, firm, year } = await booksPage('efaktura');
  if (!firm) return <NoFirm t="Е-Фактура" />;
  const L = await db().select({ i: invoices, p: { name: partners.name, edb: partners.edb } }).from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.firmId, firm.id), inArray(invoices.kind, ['invoice', 'credit']), sql`extract(year from ${invoices.date}) = ${year}`)).orderBy(desc(invoices.date));
  const edb = (x: string | null | undefined) => String(x ?? '').replace(/^MK/i, '').replace(/\D/g, '');
  const issues = [
    edb(firm.edb).length !== 13 && 'ЕДБ на фирмата нема 13 цифри.',
    !String(((firm.settings ?? {}) as Record<string, unknown>).bank ?? '') && 'Не е внесена жиро сметка (Излез › Изглед на фактура).',
  ].filter(Boolean) as string[];
  return (
    <>
      <Hd t="Е-Фактура" sub={`UBL 2.1 · ${year}`} />
      {issues.length ? <div className="callout warn">{issues.map((x) => <div key={x}>⚠ {x}</div>)}</div> : <div className="callout good">Податоците на фирмата се подготвени за е-фактура.</div>}
      {canDo(u, 'write', firm.id) && (
        <div className="card"><h2>Увоз на примена е-фактура (UBL XML)</h2>
          <ScanUpload firmId={firm.id} small opts={{ kind: 'purchase', batchId: null }} label={<><b>Прикачи UBL XML</b> — примените е-фактури се увезуваат како влезни фактури (без автоматско читање); потоа ги проверувате во „Скенирање документ“.</>} />
          <p className="note"><Link href="/skan">→ Скенирани / увезени документи</Link></p></div>
      )}
      {L.length ? <div className="tw"><table className="dense"><thead><tr><th>Број</th><th>Датум</th><th>Купувач</th><th>ЕДБ</th><th className="n">Износ</th><th>Вид</th><th /></tr></thead>
        <tbody>{L.map(({ i, p }) => (
          <tr key={i.id}><td className="num"><b>{i.number}</b></td><td>{dmy(i.date)}</td><td>{p?.name}</td>
            <td>{p?.edb ?? <span className="pill warn">нема ЕДБ</span>}</td><td className="n">{fmt(i.total)}{i.currency !== 'MKD' && ' ' + i.currency}</td>
            <td>{i.kind === 'credit' ? <span className="pill info">CreditNote</span> : <span className="pill">Invoice</span>}{i.status === 'pending' && <span className="pill warn"> чека одобрување</span>}</td>
            <td><a className="btn sm" href={`/api/ubl/${i.id}`}>⬇ XML</a><Link className="btn sm" href={`/print/doc/${i.id}`} target="_blank">👁</Link></td></tr>))}</tbody></table></div>
        : <div className="card empty">Нема излезни фактури за {year}.</div>}
    </>
  );
}
