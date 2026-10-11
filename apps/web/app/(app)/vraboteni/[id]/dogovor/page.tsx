/** Legacy `ctRender` 7755 → 16134 (contract editor, opened from Вработени → Договор) + extension (`empExtend` / `extSave`). */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { hrCtDefaults, hrDocLabel, monthHours, resolvePayParams, type HrContract } from '@wise/core';
import { employees, hrContracts, hrDocs, hrNumbersTaken } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { hrOwnDocIds } from '@/lib/own-template';
import { dmy } from '@/lib/fmt';
import { payCtx, payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ContractEditor } from './contract-editor';
import { HR_LOCK_MSG, hrOfficeLocked } from '@/lib/hr-lock';

export default async function DogovorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { u, firm } = await payPage('vraboteni');
  if (!firm) return <NoFirm t="Договор за вработување" />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (await hrOfficeLocked(firm, u)) return <><Hd t="Договор за вработување" /><div className="callout bad">{HR_LOCK_MSG}</div></>;
  const [e] = await db().select().from(employees).where(and(eq(employees.id, id), eq(employees.firmId, firm.id))).limit(1);
  if (!e) notFound();
  const [ct] = await db().select().from(hrContracts).where(and(eq(hrContracts.employeeId, e.id), eq(hrContracts.current, true))).limit(1);
  const [ctx, docs, taken] = await Promise.all([
    payCtx(firm),
    db().select().from(hrDocs).where(and(eq(hrDocs.firmId, firm.id), eq(hrDocs.employeeId, e.id))).orderBy(desc(hrDocs.date), desc(hrDocs.createdAt)),
    hrNumbersTaken(db(), firm.id, e.id),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const P = { ...resolvePayParams({}, today.slice(0, 7), ctx.overrides), hours: monthHours(today.slice(0, 7)) };
  const saved: Partial<HrContract> | null = ct ? {
    ...(ct.data as Partial<HrContract>), type: ct.type as HrContract['type'], no: ct.no, signDate: ct.signDate, place: ct.place ?? '', start: ct.start, end: ct.end ?? '',
    reason: ct.reason ?? '', position: ct.position ?? '', duties: ct.duties ?? '', workPlace: ct.workPlace ?? '', hours: Number(ct.hours), probation: ct.probation ?? '',
    gross: Number(ct.gross ?? 0), net: Number(ct.net ?? 0), leave: ct.leave, notice: ct.notice, rep: ct.rep ?? '', repRole: ct.repRole ?? '', firstStart: ct.firstStart ?? ct.start,
  } : null;
  const c0 = hrCtDefaults({ ...e, netBase: Number(e.netBase), coef: Number(e.coef) }, { ...ctx.firm }, P, today, saved);
  const ownW = await hrOwnDocIds(docs);
  const contractDoc = ct ? docs.find((d) => d.contractId === ct.id && d.kind === 'contract') : undefined;
  return (
    <>
      <Hd t={'Договор за вработување – ' + e.name} sub={ct ? `заведен под бр. ${ct.no}` : 'нов договор'}>
        <Link className="btn" href="/vraboteni">← Вработени</Link>
        <Link className="btn" href={`/vraboteni/${e.id}/merki`}>⚖ Мерки и престанок</Link>
        {contractDoc && <a className="btn" href={`/dogovori/${contractDoc.id}`} target="_blank" rel="noopener">🖨 Печати заведениот договор</a>}
        {contractDoc && ownW.has(contractDoc.id) && <a className="btn" href={`/dogovori/${contractDoc.id}?word=1`} title="Word од сопствениот шаблон">📝 Word (шаблон)</a>}
      </Hd>
      <ContractEditor
        employee={{ id: e.id, name: e.name, embg: e.embg, address: e.address, position: e.position, end: e.end }}
        firm={ctx.firm} c0={c0} saved={!!ct} params={P} taken={taken} canWrite={canDo(u, 'write', firm.id)}
        fixedEnd={ct && (ct.type === 'opr' || ct.type === 'sez') ? ct.end : null}
      />
      {docs.length > 0 && (
        <div className="card"><h2>Досие – документи во евиденцијата</h2>
          <table className="dense"><thead><tr><th>Дел. број</th><th>Датум</th><th>Документ</th><th>До</th><th>Контролен код</th><th></th></tr></thead>
            <tbody>{docs.map((d) => <tr key={d.id}><td><b>{d.no}</b></td><td>{dmy(d.date)}</td><td>{hrDocLabel(d)}</td><td>{dmy(d.end)}</td><td className="mini">{d.code}</td>
              <td style={{ whiteSpace: 'nowrap' }}><a className="btn sm" href={`/dogovori/${d.id}`} target="_blank" rel="noopener">Печати</a>{ownW.has(d.id) && <> <a className="btn sm" href={`/dogovori/${d.id}?word=1`} title="Word од сопствениот шаблон">📝 Word (шаблон)</a></>}</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
