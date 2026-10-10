/** Legacy `VIEWS.poobjekti` 5156 (+ `poTable`) — Резултат по објекти (магацини и продавници). */
import { resultsByLocation } from '@wise/core/finance';
import { booksPage } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { finLines } from '@/lib/finance';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { locationNames, poRange } from './data';

export default async function PoobjektiPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('poobjekti');
  if (!firm) return <NoFirm t="Резултат по објекти" />;
  const { from, to } = poRange(sp, year);
  const [lines, names] = await Promise.all([finLines(firm.id, from, to, { excludeClose: true }), locationNames(firm.id)]);
  const R = resultsByLocation(lines, [...names.keys()]);
  const T = (k: 'rev' | 'cogs' | 'exp' | 'res') => fmt(R.reduce((a, r) => a + r[k], 0));
  const nm = (w: string) => (w ? names.get(w) ?? '—' : 'Заеднички (без објект)');
  return (
    <>
      <Hd t="Резултат по објекти" sub="магацини и продавници">
        <DownloadCsv name={`Rezultat_po_objekti_${from}_${to}.csv`} rows={[['Објект', 'Приходи', 'Набавна вредност на продаденото', 'Други трошоци', 'Резултат'], ...R.map((r) => [nm(r.w), r.rev, r.cogs, r.exp, r.res])]} />
        <a className="btn pri" href={`/print/fin/poobjekti?from=${from}&to=${to}`} target="_blank" rel="noopener">PDF</a>
      </Hd>
      <form className="card">
        <div className="row" style={{ gap: 12, alignItems: 'end' }}>
          <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </div>
        <p className="note">Приходите и трошоците се распоредуваат според објектот избран на документот (фактура, влезна фактура, каса, издатница). Книжењата без објект (изводи, плати, амортизација) се во „Заеднички“.</p>
      </form>
      <div className="tw"><table>
        <thead><tr><th>Објект</th><th className="n">Приходи</th><th className="n">Набавна вредност на продаденото</th><th className="n">Други трошоци</th><th className="n">Резултат</th></tr></thead>
        <tbody>{R.length ? R.map((r) => (
          <tr key={r.w}><td>{nm(r.w)}</td><td className="n">{fmt(r.rev)}</td><td className="n">{fmt(r.cogs)}</td><td className="n">{fmt(r.exp)}</td>
            <td className="n" style={{ color: r.res < 0 ? 'var(--bad)' : 'inherit' }}>{fmt(r.res)}</td></tr>
        )) : <tr><td colSpan={5} className="empty">Нема приходи и трошоци во периодот.</td></tr>}</tbody>
        <tfoot><tr><td>Вкупно</td><td className="n">{T('rev')}</td><td className="n">{T('cogs')}</td><td className="n">{T('exp')}</td><td className="n">{T('res')}</td></tr></tfoot>
      </table></div>
    </>
  );
}
