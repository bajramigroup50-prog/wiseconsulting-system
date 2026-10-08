/** Legacy v522 "⚖ Мерки и престанок" (`empDisc` 15683, `diRender` 15660): warnings, disciplinary measures, termination. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, like } from 'drizzle-orm';
import { hrDocLabel } from '@wise/core';
import { employees, hrContracts, hrDocs, nextHrDocNo } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { payCtx, payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { DiEditor } from './di-editor';

export default async function MerkiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { u, firm } = await payPage('vraboteni');
  if (!firm) return <NoFirm t="Мерки и престанок" />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [e] = await db().select().from(employees).where(and(eq(employees.id, id), eq(employees.firmId, firm.id))).limit(1);
  if (!e) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const [ctx, [ct], hist, nextNo] = await Promise.all([
    payCtx(firm),
    db().select({ no: hrContracts.no, position: hrContracts.position }).from(hrContracts).where(and(eq(hrContracts.employeeId, e.id), eq(hrContracts.current, true))).limit(1),
    db().select().from(hrDocs).where(and(eq(hrDocs.employeeId, e.id), like(hrDocs.kind, 'di-%'))).orderBy(desc(hrDocs.date)),
    db().transaction((tx) => nextHrDocNo(tx, firm.id, today)),
  ]);
  return (
    <>
      <Hd t={'⚖ Мерки и престанок – ' + e.name} sub={e.end ? `престанок ${dmy(e.end)}${e.endReason ? ' · ' + e.endReason : ''}` : undefined}>
        <Link className="btn" href="/vraboteni">← Вработени</Link>
        <Link className="btn" href={`/vraboteni/${e.id}/dogovor`}>Договор</Link>
      </Hd>
      <DiEditor employee={{ id: e.id, name: e.name, embg: e.embg, address: e.address, position: ct?.position || e.position, end: e.end, ctNo: ct?.no ?? null }}
        firm={ctx.firm} nextNo={nextNo} today={today} warnRefs={hist.filter((d) => d.kind === 'di-warn').map((d) => `бр. ${d.no} од ${dmy(d.date)}`)}
        canWrite={canDo(u, 'write', firm.id)} />
      {hist.length > 0 && (
        <div className="card"><h3 className="fh" style={{ marginTop: 0 }}>Историја</h3>
          <table className="dense"><tbody>{hist.map((d) => <tr key={d.id}><td>{dmy(d.date)}</td><td>{hrDocLabel(d)}</td><td>{d.no}</td><td className="mini">{d.code}</td><td><a className="btn sm" href={`/dogovori/${d.id}`} target="_blank" rel="noopener">Печати</a></td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
