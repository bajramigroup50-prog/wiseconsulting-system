/**
 * Legacy `VIEWS.delovi` 9716 — Пребарување делови: by OE / cross / code / barcode number or name, narrowed to a
 * customer's vehicle (make, model, year from the item's „Возила“ text); alternatives with the same number;
 * „+ во налог“ adds the part to the work order the search was opened from.
 */
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { partAlternatives, searchParts, vehicleLabel } from '@wise/core/industry';
import { workOrders } from '@wise/db';
import { customerVehicleList, partsCatalog, type CatalogItem } from '@/lib/auto';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { addPartToWorkOrderAction } from '../servis/actions';

type SP = { q?: string; veh?: string; mk?: string; md?: string; yr?: string; sel?: string; wo?: string };
const fq = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 3 });

export default async function Delovi({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('delovi', 'Пребарување делови');
  if (g.blocked) return g.blocked;
  const { firm } = g;
  const [V, I] = await Promise.all([customerVehicleList(firm.id), partsCatalog(firm.id)]);
  const [wo] = sp.wo ? await db().select({ id: workOrders.id, number: workOrders.number, invoiceId: workOrders.invoiceId }).from(workOrders).where(and(eq(workOrders.id, sp.wo), eq(workOrders.firmId, firm.id))).limit(1) : [];
  const toWo = wo && !wo.invoiceId && g.write ? wo : null;
  const v = V.find((x) => x.id === sp.veh);
  const mk = v ? v.make : sp.mk, md = v ? v.model : sp.md, yr = v ? v.year : sp.yr;
  const goods = I.filter((i) => i.type !== 'service');
  const q = (sp.q ?? '').trim();
  const L = q || mk || md ? searchParts(goods, { q, mk, md, yr }) : [];
  const sel = goods.find((i) => i.id === sp.sel);
  const alt = sel ? partAlternatives(goods, sel) : [];
  const qs = (o: Partial<SP>) => '/delovi?' + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, x]) => x) as [string, string][]).toString();
  const row = (i: CatalogItem) => (
    <tr key={i.id} style={sel?.id === i.id ? { background: 'var(--accent-soft)' } : undefined}>
      <td>{i.code}</td><td><Link href={qs({ sel: i.id })}><b>{i.name}</b></Link>{i.fits && <div className="mini">{i.fits.slice(0, 90)}</div>}</td>
      <td className="mini">{i.oe}</td><td className="mini">{i.crossRefs}</td>
      <td className="n" style={i.stock <= 0 ? { color: 'var(--bad)' } : undefined}>{fq(i.stock)}</td><td className="n">{fmt(i.price * (1 + i.rate / 100))}</td>
      <td>{toWo && <RowAction className="btn sm pri" action={addPartToWorkOrderAction.bind(null, toWo.id, i.id)} label="+ во налог" />}</td>
    </tr>
  );
  return (
    <>
      <Hd t="Пребарување делови" sub="OE број · замени · возило">
        <Link className="btn" href={toWo ? `/servis?id=${toWo.id}` : '/servis'}>🔧 {toWo ? `Назад во налогот ${toWo.number}` : 'Работни налози'}</Link>
      </Hd>
      <form className="card">
        {sp.wo && <input type="hidden" name="wo" value={sp.wo} />}
        <div className="form">
          <label className="f wide">Број на дел (OE, замена, шифра, баркод) или назив<input name="q" defaultValue={q} placeholder="на пр. 03L115562 или „филтер масло“" /></label>
          <label className="f">Возило на клиент<select name="veh" defaultValue={sp.veh ?? ''}><option value="">—</option>{V.map((x) => <option key={x.id} value={x.id}>{vehicleLabel(x)}</option>)}</select></label>
          <label className="f">Марка<input name="mk" defaultValue={mk ?? ''} disabled={!!v} /></label>
          <label className="f">Модел<input name="md" defaultValue={md ?? ''} disabled={!!v} /></label>
          <label className="f">Година<input name="yr" type="number" defaultValue={yr ?? ''} disabled={!!v} /></label>
        </div>
        <div className="row" style={{ marginTop: 6 }}><span style={{ flex: 1 }} /><button className="btn pri">🔍 Барај</button></div>
        <p className="note" style={{ margin: '6px 0 0' }}>Кај артиклите (Шифрарник → Производи) внесете „OE броеви“, „Замени / еквиваленти“ и „Возила“ (на пр. „VW Golf 5 2004-2008; Škoda Octavia 2 2004-2013“). Пребарувањето игнорира празни места и цртички.</p>
      </form>
      {(q || mk || md) && <div className="tw"><table><thead><tr><th>Шифра</th><th>Назив / возила</th><th>OE</th><th>Замени</th><th className="n">Залиха</th><th className="n">Цена со ДДВ</th><th /></tr></thead>
        <tbody>{L.slice(0, 200).map(row)}{!L.length && <tr><td colSpan={7} className="note">Не е пронајдено.</td></tr>}</tbody></table></div>}
      {sel && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Замени за „{sel.name}“ (ист OE / еквивалентен број) – {alt.length}</h2>
        {alt.length ? <div className="tw"><table className="dense"><tbody>{alt.map(row)}</tbody></table></div> : <p className="note">Нема други артикли со ист број.</p>}</div>}
    </>
  );
}
