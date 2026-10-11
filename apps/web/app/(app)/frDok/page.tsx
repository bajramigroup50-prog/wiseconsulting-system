/**
 * Legacy `VIEWS.frDok` 14603 + patch 14667 — 📋 Лиценци и документи (превоз): licences, CEMT permits, tachographs and
 * drivers' documents with the 30-day expiry badge; one „+ Документ“ form with „За“ (vehicle / driver) switching the
 * kinds and the list, hints when there are no vehicles / employees; Excel import with template.
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { daysTo, FR_DOC_IMPORT_HEAD } from '@wise/core/industry';
import { employees, fleetVehicles, listDocs, type FreightDoc } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { FrDocForm } from '@/components/freight-ui';
import { XlsxImport } from '@/components/list-tools';
import { frDocDeleteAction, frDocImportAction } from '../frTuri/actions';

export default async function FrDok({ searchParams }: { searchParams: Promise<{ ed?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frDok', '📋 Лиценци и документи (превоз)');
  if (g.blocked) return g.blocked;
  const T = today();
  const V = await db().select({ id: fleetVehicles.id, plate: fleetVehicles.plate, name: fleetVehicles.name }).from(fleetVehicles).where(eq(fleetVehicles.firmId, g.firm.id)).orderBy(asc(fleetVehicles.plate));
  const Dr = await db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, g.firm.id)).orderBy(asc(employees.name));
  const D = (await listDocs<FreightDoc>(db(), g.firm.id, 'frdoc')).sort((a, b) => String(a.data.validTo || '9').localeCompare(String(b.data.validTo || '9')));
  const E = sp.ed === 'new' ? { id: '', who: 'veh' as const, ref: '', kind: '', no: '', validFrom: '', validTo: '', note: '' }
    : (() => { const x = D.find((y) => y.id === sp.ed); return x ? { id: x.id, who: x.data.who, ref: x.data.ref, kind: x.data.kind, no: x.data.no ?? '', validFrom: x.data.validFrom ?? '', validTo: x.data.validTo ?? '', note: x.data.note ?? '' } : null; })();
  const who = (x: FreightDoc) => (x.who === 'drv' ? '👤 ' + (Dr.find((y) => y.id === x.ref)?.name ?? '?') : '🚛 ' + (V.find((y) => y.id === x.ref)?.plate ?? '?'));
  const badge = (d: string | null | undefined) => { const n = daysTo(d, T); return n == null ? null : n < 0 ? <span className="pill bad">истечено</span> : n <= 30 ? <span className="pill warn">за {n} дена</span> : <span className="pill good">важи</span>; };
  return (
    <>
      <Hd t="📋 Лиценци и документи (превоз)" sub={`${D.length} документи`}>
        <Link className="btn" href="/frTuri">🚛 Тури</Link>
        {g.write && <Link className="btn pri" href="/frDok?ed=new">+ Документ</Link>}
      </Hd>
      {g.write && <div className="row" style={{ gap: 8, marginBottom: 8 }}><XlsxImport action={frDocImportAction} template={[[...FR_DOC_IMPORT_HEAD], ['возило', 'SK-1234-AB', 'CEMT дозвола', '123/2026', '01.01.2026', '31.12.2026', ''], ['возач', 'Петар Петровски', 'Тахограф картичка', 'MK0001', '', '30.06.2027', '']]} templateName="Licenci_obrazec.xlsx" /></div>}
      {E && g.write && <FrDocForm doc={E} vehicles={V.map((v) => ({ id: v.id, label: `${v.plate} ${v.name ?? ''}` }))} drivers={Dr.map((d) => ({ id: d.id, label: d.name }))} />}
      {D.length ? <div className="tw"><table><thead><tr><th>За</th><th>Вид</th><th>Број</th><th>Важи до</th><th /><th /></tr></thead>
        <tbody>{D.map((x) => (
          <tr key={x.id}><td>{who(x.data)}</td><td>{x.data.kind}</td><td>{x.data.no}</td><td>{dmy(x.data.validTo)}</td><td>{badge(x.data.validTo)}</td>
            <td>{g.write && <Link className="btn sm" href={`/frDok?ed=${x.id}`}>Измени</Link>}{g.del && <> <RowAction className="btn sm ghost danger" action={frDocDeleteAction.bind(null, x.id)} confirm="Да се избрише документот?" label="🗑" title="Избриши" /></>}</td></tr>))}</tbody></table></div>
        : <div className="empty">Внесете ги лиценците, CEMT дозволите, тахографите и документите на возачите – програмата ќе ве предупреди 30 дена пред истекување.</div>}
    </>
  );
}
