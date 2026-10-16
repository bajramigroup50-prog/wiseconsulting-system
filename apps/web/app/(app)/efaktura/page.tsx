/**
 * Legacy `VIEWS.efaktura` 5130 — Е-Фактура: UBL 2.1 export of issued invoices / credit notes and UBL import of
 * received e-invoices (through the scan pipeline, without AI). P34: bulk export (period / not yet exported / ticked)
 * as a ZIP of validated UBL XML + `lista.csv`, and the „извезено за е-фактура“ marker per invoice (`data.efExport`).
 */
import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { einvoiceBuyerProblems, einvoiceSellerProblems } from '@wise/core/finance';
import { invoices, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { firmBank } from '@/lib/ubl';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ScanUpload } from '@/components/sales/scan-upload';
import { SelAll, SelBox } from '@/components/sales/bulk-select';
import { EfExport } from '@/components/sales/ef-export';

const when = (iso: string) => new Date(iso).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default async function EfakturaPage({ searchParams }: { searchParams: Promise<{ ne?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('efaktura');
  if (!firm) return <NoFirm t="Е-Фактура" />;
  const all = await db().select({ i: invoices, p: { name: partners.name, edb: partners.edb, address: partners.address, city: partners.city, foreign: partners.foreign } })
    .from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.firmId, firm.id), inArray(invoices.kind, ['invoice', 'credit']), sql`${invoices.date} between ${String(year) + '-01-01'} and ${String(year) + '-12-31'}`)).orderBy(desc(invoices.date));
  const unsent = all.filter(({ i }) => !i.data?.efExport && !i.data?.cancelled && i.status === 'posted').length;
  const onlyNew = sp.ne === '1';
  const L = onlyNew ? all.filter(({ i }) => !i.data?.efExport) : all;
  const issues = einvoiceSellerProblems({ edb: firm.edb, bank: firmBank(firm) }).map((x) => x === 'не е внесена жиро сметка на фирмата' ? 'Не е внесена жиро сметка (Излез › Изглед на фактура).' : x + '.');
  const write = canDo(u, 'write', firm.id);
  return (
    <>
      <Hd t="Е-Фактура" sub="УЈП · според предлог-законот: доброволно од 01.10.2026, задолжително за ДДВ обврзници од 01.04.2027 – проверете ги конечните рокови на УЈП" />
      <div className="callout warn">Испраќањето до системот е-Фактура на УЈП бара квалификуван дигитален сертификат и поврзување со нивниот систем (следна фаза). Засега за секоја фактура може да се преземе структуриран XML (UBL 2.1) со сите задолжителни податоци: ЕДБ на продавач и купувач, датуми, ставки, стапки и износи на ДДВ, член 32-а – поединечно или масовно (ZIP).</div>
      {issues.length ? <div className="callout warn">{issues.map((x) => <div key={x}>⚠ {x}</div>)}</div> : <div className="callout good">Податоците на фирмата се подготвени за е-фактура.</div>}
      {write && <EfExport firmId={firm.id} from={`${year}-01-01`} to={`${year}-12-31`} unsent={unsent} />}
      {write && (
        <div className="card"><h2>Увоз на примена е-фактура (UBL XML)</h2>
          <ScanUpload firmId={firm.id} small opts={{ kind: 'purchase', batchId: null }} label={<><b>Прикачи UBL XML</b> — примените е-фактури се увезуваат како влезни фактури (без автоматско читање); потоа ги проверувате во „Скенирање документ“.</>} />
          <p className="note"><Link href="/skan">→ Скенирани / увезени документи</Link></p></div>
      )}
      <div className="row noprint" style={{ gap: 8, margin: '6px 0' }}>
        <Link className={'btn sm' + (onlyNew ? '' : ' pri')} href="/efaktura">Сите ({all.length})</Link>
        <Link className={'btn sm' + (onlyNew ? ' pri' : '')} href="/efaktura?ne=1">Неизвезени ({all.filter(({ i }) => !i.data?.efExport).length})</Link>
      </div>
      {L.length ? <div className="tw"><table className="dense"><thead><tr>{write && <th><SelAll group="ef" /></th>}<th>Број</th><th>Датум</th><th>Купувач</th><th>ЕДБ</th><th className="n">Износ</th><th>Вид</th><th>Е-фактура</th><th /></tr></thead>
        <tbody>{L.map(({ i, p }) => {
          const bp = p && !p.foreign ? einvoiceBuyerProblems(p) : [];
          const ex = i.data?.efExport;
          return (
            <tr key={i.id}>{write && <td><SelBox id={i.id} group="ef" /></td>}<td className="num"><b>{i.number}</b></td><td>{dmy(i.date)}</td><td>{p?.name}</td>
              <td>{p?.edb || <span className="pill bad">нема ЕДБ</span>}{bp.length > 0 && p?.edb && <span className="pill warn" title={bp.join(', ')}>⚠ {bp.length}</span>}</td><td className="n">{fmt(i.total)}{i.currency !== 'MKD' && ' ' + i.currency}</td>
              <td>{i.kind === 'credit' ? <span className="pill info">CreditNote</span> : <span className="pill">Invoice</span>}{i.status === 'pending' && <span className="pill warn"> чека одобрување</span>}{i.data?.cancelled && <span className="pill bad"> сторнирана</span>}</td>
              <td>{ex ? <span className="pill good" title={`Извезено ${ex.n}×`}>извезено {when(ex.at)}</span> : <span className="pill">не е извезена</span>}</td>
              <td><a className="btn sm" href={`/api/ubl/${i.id}`}>XML (UBL)</a><Link className="btn sm" href={`/print/doc/${i.id}`} target="_blank">👁</Link></td></tr>
          );
        })}</tbody></table></div>
        : <div className="card empty">{onlyNew ? `Сите излезни фактури за ${year} се извезени.` : `Нема излезни фактури за ${year}.`}</div>}
    </>
  );
}
