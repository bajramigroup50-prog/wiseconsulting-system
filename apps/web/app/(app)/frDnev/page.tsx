/**
 * Legacy `VIEWS.frDnev` 14580 — дневници во странство по возач и тура, and the per-diem amounts per country
 * (FR_CTRY reference data with firm overrides, FIX LEGACY-MAP 10.4 item 16).
 */
import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { fxRate } from '@wise/core';
import { FR_COUNTRIES, frPerDiems } from '@wise/core/industry';
import { employees, freightTours, industryConfigOf, loadFxSources } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { saveFreightRatesAction } from '../pnalozi/actions';

export default async function FrDnev({ searchParams }: { searchParams: Promise<{ cfg?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frDnev', 'Дневници во странство');
  if (g.blocked) return g.blocked;
  const rates = (industryConfigOf<{ rates: Record<string, [number, string]> }>(g.firm, 'frt').rates ?? {}) as Record<string, [number, string]>;
  const fx = await loadFxSources(db(), g.firm.id);
  const T = await db().select().from(freightTours).where(and(eq(freightTours.firmId, g.firm.id), sql`extract(year from ${freightTours.date}) = ${g.year}`)).orderBy(asc(freightTours.date));
  const E = await db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, g.firm.id));
  const R = T.filter((t) => t.segs.length && t.status !== 'cancel').map((t) => ({ t, d: frPerDiems(t, (c, d) => (c === 'MKD' ? 1 : fxRate(c, d, fx)), rates) }));
  const byDrv = new Map<string, number>();
  for (const { t, d } of R) for (const id of [t.driverId, t.driver2Id].filter(Boolean) as string[]) byDrv.set(id, (byDrv.get(id) ?? 0) + d.mkd);
  return (
    <>
      <Hd t="Дневници во странство" sub={String(g.year)}><Link className="btn" href="/frTuri">🚛 Тури</Link><Link className="btn" href={sp.cfg ? '/frDnev' : '/frDnev?cfg=1'}>⚙ Износи</Link></Hd>
      {sp.cfg && <BankForm action={saveFreightRatesAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Износи на дневници по држава (празно = од Уредбата)</h2>
        <div className="tw" style={{ maxHeight: 420, overflow: 'auto' }}><table className="dense"><tbody>{FR_COUNTRIES.map(([c, n, amt, cur]) => (
          <tr key={c}><td>{n}</td><td className="mini">{amt} {cur}</td><td><input name={`rate.${c}`} type="number" step="any" defaultValue={rates[c]?.[0] ?? ''} style={{ width: 90 }} /></td><td><input name={`cur.${c}`} defaultValue={rates[c]?.[1] ?? cur} style={{ width: 60 }} /></td></tr>
        ))}</tbody></table></div>
        {g.write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
      </BankForm>}
      <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>По возач</h2>
        <table className="dense"><tbody>{[...byDrv.entries()].map(([id, v]) => <tr key={id}><td>{E.find((e) => e.id === id)?.name}</td><td className="n"><b>{fmt(v)}</b></td></tr>)}
          {!byDrv.size && <tr><td className="note">Нема.</td></tr>}</tbody></table></div>
      <div className="tw"><table><thead><tr><th>Тура</th><th>Датум</th><th>Возач</th><th className="n">Часови</th><th className="n">Дневници</th><th>Во валута</th><th className="n">Ден.</th></tr></thead>
        <tbody>{R.map(({ t, d }) => <tr key={t.id}><td><Link href={`/frTuri?id=${t.id}`}>{t.number}</Link></td><td>{dmy(t.date)}</td><td>{E.find((e) => e.id === t.driverId)?.name}</td><td className="n">{d.totH}</td><td className="n">{d.totU}</td>
          <td>{Object.entries(d.by).map(([c, x]) => `${fmt(x)} ${c}`).join(' + ')}{d.miss.length ? ` ⚠ нема курс ${d.miss.join(', ')}` : ''}</td><td className="n">{fmt(d.mkd)}</td></tr>)}
          {!R.length && <tr><td colSpan={7} className="note">Нема тури со внесени држави.</td></tr>}</tbody></table></div>
    </>
  );
}
