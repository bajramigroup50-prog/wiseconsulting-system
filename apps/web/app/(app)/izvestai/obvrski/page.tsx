/**
 * „Обврски кон УЈП и фондови“ (📊 Извештаи): per liability konto (данок, придонеси, нето плати, ДДВ) and month –
 * пресметано (Побарува), платено (Должи) and the saldo still owed at the end of each month (`liabilitiesByMonth`).
 */
import Link from 'next/link';
import { MON } from '@wise/core/firms/dash';
import { liabilitiesByMonth } from '@wise/core/firms/reports';
import { booksPage } from '@/lib/books';
import { acctMonths } from '@/lib/dash';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export const metadata = { title: 'Обврски кон УЈП и фондови' };

export default async function ObvrskiPage() {
  const { firm, year } = await booksPage('izvestai');
  if (!firm) return <NoFirm t="Обврски кон УЈП и фондови" />;
  const R = liabilitiesByMonth(await acctMonths(firm.id, year));
  const c = (v: number, bold?: boolean) => <td className="n" style={bold && Math.abs(v) > 0.004 ? { fontWeight: 700, color: v > 0 ? 'var(--bad)' : undefined } : undefined}>{v ? fmt(v) : ''}</td>;
  return (
    <>
      <Hd t="Обврски кон УЈП и фондови" sub={`${year} · пресметано / платено / салдо по месеци`} />
      <div className="card row" style={{ gap: 8 }}><Link className="btn sm ghost" href="/izvestai">← Сите извештаи</Link>
        <span className="mini mut">Салдо = уште за плаќање на крајот на месецот (− = платено повеќе). Придонесите и данокот за месецот се плаќаат следниот месец.</span></div>
      {R.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Конто</th><th /> {MON.map((m) => <th key={m} className="n">{m}</th>)}<th className="n">Година</th></tr></thead>
          <tbody>{R.map((r) => [
            <tr key={r.k + 'c'} style={{ borderTop: '2px solid var(--line)' }}><td rowSpan={3}><Link href={`/kkart?k=${r.k}`}><b>{r.k}</b></Link><br /><small>{r.name}</small></td><td className="mini">пресметано</td>{r.calc.map((v, i) => <td key={i} className="n">{v ? fmt(v) : ''}</td>)}<td className="n"><b>{fmt(r.calcY)}</b></td></tr>,
            <tr key={r.k + 'p'}><td className="mini">платено</td>{r.paid.map((v, i) => <td key={i} className="n">{v ? fmt(v) : ''}</td>)}<td className="n"><b>{fmt(r.paidY)}</b></td></tr>,
            <tr key={r.k + 's'}><td className="mini"><b>салдо</b></td>{r.saldo.map((v, i) => <span key={i} style={{ display: 'contents' }}>{c(v, true)}</span>)}{c(r.saldo[11]!, true)}</tr>,
          ])}</tbody>
        </table></div>
      ) : <div className="card empty">Нема книжења на контата за данок, придонеси, плати и ДДВ во {year}.</div>}
    </>
  );
}
