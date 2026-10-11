/**
 * Legacy `VIEWS.frDnev` 14580 — 🌍 Дневници во странство: month select, „+ Ново патување со дневници“, per driver
 * (tours, number, per diems, amount per currency, denars, PDF = `frDnevPdfHTML`), instructions when empty, warning for
 * the month's tours without borders, and ⚙ Износи по држава (FR_CTRY with firm overrides, 0 < amount < 1000).
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { FR_COUNTRIES, currencyText, frDnevByDriver, frDnevTours, frToursWithoutBorders, isMonth, monthOptions } from '@wise/core/industry';
import { freightTours } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { freightContext } from '@/lib/freight';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { MonthSelect } from '@/components/freight-ui';
import { ExportXlsx, ListPdf, type Cell } from '@/components/list-tools';
import { Hd } from '@/components/hd';
import { frRatesAction } from '../frTuri/actions';

export default async function FrDnev({ searchParams }: { searchParams: Promise<{ cfg?: string; mo?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frDnev', 'Дневници во странство');
  if (g.blocked) return g.blocked;
  const mo = isMonth(sp.mo) ? sp.mo : today().slice(0, 7);
  const X = await freightContext(g.firm);
  const all = await db().select().from(freightTours).where(eq(freightTours.firmId, g.firm.id)).orderBy(asc(freightTours.date), asc(freightTours.number));
  const T = frDnevTours(all, mo);
  const rows = frDnevByDriver(T, (t) => X.dn(t));
  const W = frToursWithoutBorders(all, mo);
  const C = X.rates;
  const name = (k: string) => (k === '-' ? '(без возач)' : X.driver(k));
  const xlsx: Cell[][] = [['Возач', 'Тури', 'Број', 'Дневници', 'Износ', 'Денари'], ...rows.map((r) => [name(r.driverId), r.tours.length, r.tours.map((t) => t.number).join(', '), r.units, currencyText(r.by, fmt), r.mkd])];
  const detail: Cell[][] = [['Тура', 'Датум', 'Возач', 'Часови', 'Дневници', 'Износ', 'Денари'], ...T.map((t) => { const d = X.dn(t); return [t.number, t.date, name(t.driverId || '-'), d.totH, d.rows.reduce((a, r) => a + r.u, 0), currencyText(d.by, fmt), d.mkd]; })];
  return (
    <>
      <Hd t="🌍 Дневници во странство" sub={mo}>
        <Link className="btn" href="/frTuri">🚛 Тури</Link>
        <ExportXlsx name={`Dnevnici_${mo}.xlsx`} sheets={[{ name: 'По возач', rows: xlsx }, { name: 'По тура', rows: detail }]} />
        <ListPdf target="frDnevList" title={`Дневници во странство ${mo}`} />
        <Link className="btn" href={sp.cfg ? `/frDnev?mo=${mo}` : `/frDnev?mo=${mo}&cfg=1`}>⚙ Износи по држава</Link>
      </Hd>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><MonthSelect value={mo} options={monthOptions(mo, g.year)} /></div>
      {g.write && <div className="row" style={{ gap: 8, marginBottom: 10 }}><Link className="btn pri" href="/frTuri?id=new&dn=1">+ Ново патување со дневници</Link></div>}
      {T.length ? (
        <div className="tw" id="frDnevList"><table><thead><tr><th>Возач</th><th className="n">Тури</th><th>Број</th><th className="n">Дневници</th><th className="n">Износ</th><th className="n">Денари</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.driverId}><td><b>{name(r.driverId)}</b></td><td className="n">{r.tours.length}</td>
              <td>{r.tours.map((t, i) => <span key={t.id}>{i > 0 && ', '}<Link href={`/frTuri?id=${t.id}`}>{t.number}</Link></span>)}</td>
              <td className="n">{r.units}</td><td className="n">{currencyText(r.by, fmt)}</td><td className="n"><b>{fmt(r.mkd)}</b></td>
              <td><Link className="btn sm" href={`/frDnev/print?drv=${encodeURIComponent(r.driverId)}&mo=${mo}`} target="_blank">PDF</Link></td></tr>
          ))}</tbody></table></div>
      ) : (
        <div className="card"><b>Нема патувања со внесени граници за {mo}.</b>
          <ol style={{ margin: '6px 0 0', lineHeight: 1.7 }}>
            <li>Кликнете <b>„+ Ново патување со дневници“</b> (или отворете постоечка тура).</li>
            <li>Изберете <b>возач</b> и возило.</li>
            <li>Кај „🌍 Граници“ со <b>„+ Држава“</b> внесете ја секоја држава со датум и час на влез и излез.</li>
            <li>Зачувајте – дневниците се пресметуваат и се појавуваат тука по возач, со PDF.</li>
          </ol></div>
      )}
      {W.length > 0 && <div className="callout warn" style={{ marginTop: 10 }}>Тури овој месец без внесени граници: {W.map((t, i) => <span key={t.id}>{i > 0 && ', '}<Link href={`/frTuri?id=${t.id}&dn=1`}>{t.number}</Link></span>)} – отворете и внесете ги државите.</div>}
      {sp.cfg && (
        <BankForm action={frRatesAction} className="card">
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>⚙ Износи по држава</h2>
          <p className="note">Стандардно: највисоките износи од Уредбата (табела објавена во е-Прописи бр. 8/2025). Ако вашиот акт предвидува помал износ, внесете го тука. Празно = стандардно.</p>
          <div className="tw" style={{ maxHeight: '50vh' }}><table className="dense"><thead><tr><th>Држава</th><th className="n">Стандардно</th><th className="n">Ваш износ</th><th>Валута</th></tr></thead>
            <tbody>{FR_COUNTRIES.map(([c, n, amt, cur]) => (
              <tr key={c}><td>{n}</td><td className="n">{amt} {cur}</td><td className="n"><input name={`rate.${c}`} defaultValue={C[c]?.[0] ?? ''} inputMode="decimal" style={{ width: 80, textAlign: 'right' }} /></td><td>{cur}</td></tr>
            ))}</tbody></table></div>
          {g.write && <div className="row" style={{ marginTop: 8 }}><button className="btn pri">Зачувај износи</button></div>}
        </BankForm>
      )}
    </>
  );
}
