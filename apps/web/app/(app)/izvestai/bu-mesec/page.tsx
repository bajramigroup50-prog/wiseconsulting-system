/**
 * „Биланс на успех по месеци“ (📊 Извештаи): приходи, расходи по групи и резултат за секој месец од годината, вкупно и
 * претходната година (`pnlByMonth` over `acctMonths`, the closing journal excluded).
 */
import Link from 'next/link';
import { MON } from '@wise/core/firms/dash';
import { pnlByMonth } from '@wise/core/firms/reports';
import { booksPage } from '@/lib/books';
import { acctMonths } from '@/lib/dash';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export const metadata = { title: 'Биланс на успех по месеци' };

export default async function BuMesecPage() {
  const { firm, year } = await booksPage('izvestai');
  if (!firm) return <NoFirm t="Биланс на успех по месеци" />;
  const [L, LP] = await Promise.all([acctMonths(firm.id, year), acctMonths(firm.id, year - 1)]);
  const P = pnlByMonth(L, LP);
  const any = P.some((l) => l.y || l.py);
  return (
    <>
      <Hd t="Биланс на успех по месеци" sub={`${year} · со споредба со ${year - 1}`} />
      <div className="card row" style={{ gap: 8 }}><Link className="btn sm ghost" href="/izvestai">← Сите извештаи</Link>
        <span className="mini mut">Приходи = класа 74–79, расходи = 40–48 и 70–73 (без налогот за затворање).</span></div>
      {any ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Позиција</th>{MON.map((m) => <th key={m} className="n">{m}</th>)}<th className="n">{year}</th><th className="n">{year - 1}</th><th className="n">Промена</th></tr></thead>
          <tbody>{P.map((l) => {
            const strong = l.kind === 'res' || l.key === 'rev' || l.key === 'exp';
            const ch = l.py ? Math.round(((l.y - l.py) / Math.abs(l.py)) * 1000) / 10 : null;
            return (
              <tr key={l.key} style={strong ? { fontWeight: 700, borderTop: l.kind === 'res' ? '2px solid var(--line)' : undefined } : undefined}>
                <td>{l.label}</td>
                {l.m.map((v, i) => <td key={i} className="n" style={l.kind === 'res' && v < 0 ? { color: 'var(--bad)' } : undefined}>{v ? fmt(v) : ''}</td>)}
                <td className="n" style={l.kind === 'res' && l.y < 0 ? { color: 'var(--bad)' } : undefined}>{fmt(l.y)}</td>
                <td className="n mut">{l.py ? fmt(l.py) : ''}</td>
                <td className="n mut">{ch == null ? '' : (ch > 0 ? '+' : '') + ch.toLocaleString('mk-MK') + '%'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : <div className="card empty">Нема приходи ни расходи во {year}.</div>}
    </>
  );
}
