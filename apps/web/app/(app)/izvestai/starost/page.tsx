/**
 * „Старосна структура“ (📊 Извештаи): open outgoing invoices (побарувања) or incoming purchases (обврски) per partner on a
 * date, by days overdue – во рок, 1–30, 31–60, 61–90, над 90 – from the documents and their payments (as on the dashboard).
 */
import Link from 'next/link';
import { AGE_BUCKETS, agingByPartner } from '@wise/core/firms/reports';
import { booksPage } from '@/lib/books';
import { invoicesWithPayments, partnerNames, purchasesWithPayments } from '@/lib/firms-office';
import { fmt } from '@/lib/fmt';
import { today } from '@/lib/office';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export const metadata = { title: 'Старосна структура' };

export default async function StarostPage({ searchParams }: { searchParams: Promise<{ v?: string; na?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('izvestai');
  if (!firm) return <NoFirm t="Старосна структура" />;
  const sup = sp.v === 'obv';
  const td = today();
  const na = /^\d{4}-\d{2}-\d{2}$/.test(sp.na ?? '') ? sp.na! : td.startsWith(String(year)) ? td : `${year}-12-31`;
  const D = sup ? await purchasesWithPayments(firm.id, { until: na }) : await invoicesWithPayments(firm.id, { until: na });
  const A = agingByPartner(D, na);
  const PN = await partnerNames(firm.id, A.rows.map((r) => r.partnerId));
  const tab = (v: string, t: string, on: boolean) => <Link className={`btn sm ${on ? 'pri' : ''}`} href={`/izvestai/starost?v=${v}&na=${na}`}>{t}</Link>;
  return (
    <>
      <Hd t="Старосна структура" sub={`${sup ? 'обврски кон добавувачи' : 'побарувања од купувачи'} · на ${na.split('-').reverse().join('.')}`} />
      <div className="card row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        {tab('pob', 'Побарувања (купувачи)', !sup)}{tab('obv', 'Обврски (добавувачи)', sup)}
        <form className="row" style={{ gap: 8, alignItems: 'end' }}>
          <input type="hidden" name="v" value={sup ? 'obv' : 'pob'} />
          <label className="f">На датум<input type="date" name="na" defaultValue={na} /></label>
          <button className="btn">Прикажи</button>
        </form>
        <Link className="btn sm ghost" href="/izvestai">← Сите извештаи</Link>
      </div>
      {A.rows.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Комитент</th>{AGE_BUCKETS.map((b) => <th key={b} className="n">{b === 'Во рок' ? b : b + ' дена'}</th>)}<th className="n">Вкупно</th><th className="n">Док.</th><th className="n">Најстаро (дена)</th></tr></thead>
          <tbody>{A.rows.map((r) => (
            <tr key={r.partnerId || '-'}>
              <td>{r.partnerId ? <Link href={`/kartici?k=${sup ? '2200' : '1200'}&pid=${r.partnerId}`}>{PN.get(r.partnerId)?.name ?? '—'}</Link> : <span className="mut">без комитент</span>}</td>
              {r.b.map((v, i) => <td key={i} className="n" style={i >= 3 && v ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{v ? fmt(v) : ''}</td>)}
              <td className="n"><b>{fmt(r.total)}</b></td><td className="n">{r.docs}</td><td className="n">{r.oldest > 0 ? r.oldest : '—'}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td><b>Вкупно</b></td>{A.tot.map((v, i) => <td key={i} className="n"><b>{fmt(v)}</b></td>)}<td className="n"><b>{fmt(A.total)}</b></td><td colSpan={2} /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">Нема отворени {sup ? 'обврски' : 'побарувања'} на овој датум.</div>}
      <p className="mini mut">Од фактурите и нивните плаќања (рок на плаќање, а без рок – датумот на фактурата). Почетните салда без фактура се во „Картици по комитент“.</p>
    </>
  );
}
