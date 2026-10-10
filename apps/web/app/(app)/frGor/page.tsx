/**
 * Legacy `VIEWS.frGor` 14624 — ⛽ Картички за гориво: import of fuel-card statements, per-vehicle month table
 * (fill-ups, litres, amount per currency, denars), list of imports.
 */
import Link from 'next/link';
import { currencyText, fuelByPlate } from '@wise/core/industry';
import { fmt } from '@/lib/fmt';
import { fuelImports, fuelRowsOf, fxLookup } from '@/lib/fuel';
import { industryPage, today } from '@/lib/industry';
import { FuelImport } from '@/components/fuel-import';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { deleteFuelImportAction } from './actions';

export default async function FrGor({ searchParams }: { searchParams: Promise<{ mo?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frGor', 'Картички за гориво');
  if (g.blocked) return g.blocked;
  const mo = /^\d{4}-\d{2}$/.test(sp.mo ?? '') ? sp.mo! : today().slice(0, 7);
  const [I, fx] = await Promise.all([fuelImports(g.firm.id), fxLookup(g.firm.id)]);
  const m = fuelByPlate(fuelRowsOf(I), mo, fx);
  return (
    <>
      <Hd t="⛽ Картички за гориво" sub={`${I.length} увези`}><Link className="btn" href="/frTuri">🚛 Тури</Link></Hd>
      {g.write && <FuelImport />}
      <form className="row" style={{ gap: 8, margin: '8px 0', alignItems: 'center' }}>Месец <input type="month" name="mo" defaultValue={mo} style={{ width: 'auto' }} /><button className="btn sm">Прикажи</button></form>
      {m.miss.length > 0 && <div className="callout warn">Нема курс за <b>{m.miss.join(', ')}</b> – тие износи не се пресметани во денари. Внесете го курсот во Шифрарник → <Link href="/kursna">Курсна листа</Link>.</div>}
      {m.rows.length ? (
        <div className="tw"><table><thead><tr><th>Возило</th><th className="n">Точења</th><th className="n">Литри</th><th className="n">Износ</th><th className="n">Денари</th></tr></thead>
          <tbody>{m.rows.map((a) => <tr key={a.plate}><td><b>{a.plate}</b></td><td className="n">{a.n}</td><td className="n">{a.l.toLocaleString('de-DE')}</td><td className="n">{currencyText(a.by, fmt)}</td><td className="n">{fmt(a.mkd)}</td></tr>)}</tbody></table></div>
      ) : <div className="empty">Нема точења за {mo}.</div>}
      {I.length > 0 && <>
        <h2 style={{ fontSize: 15, margin: '14px 0 6px' }}>Увези</h2>
        <div className="tw"><table className="dense"><thead><tr><th>Датотека</th><th>Внесено</th><th className="n">Редови</th><th /></tr></thead>
          <tbody>{I.map((x) => <tr key={x.id}><td>{x.data.name}</td><td>{String(x.data.at ?? '').slice(0, 16).replace('T', ' ')}</td><td className="n">{x.data.rows?.length ?? 0}</td>
            <td>{g.del && <RowAction className="btn sm ghost danger" action={deleteFuelImportAction.bind(null, x.id)} confirm="Да се избрише целиот увоз?" label="🗑" title="Избриши увоз" />}</td></tr>)}</tbody></table></div>
      </>}
    </>
  );
}
