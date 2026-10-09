/** Legacy `VIEWS.vraboteni` 6813 → 14726 (MPIN selects) → 15691 (⚖), Плата › Матични податоци за вработени. */
import Link from 'next/link';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { mkAccountValid, mpinEmpCodes, mpOpsName, payLeaveStats, stazFor } from '@wise/core';
import { hrDocs, payrollEmp, payrollLines, payrollRuns } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { firmEmployees, payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteEmployee, setEmployeeActive } from './actions';
import { EmployeeForm } from './employee-form';
import { EmpScan } from './emp-scan';

export default async function VraboteniPage({ searchParams }: { searchParams: Promise<{ edit?: string; nov?: string; all?: string; q?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await payPage('vraboteni');
  if (!firm) return <NoFirm t="Вработени" />;
  const all = await firmEmployees(firm.id);
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = all.filter((e) => (sp.all !== undefined || e.active) && (!q || `${e.no} ${e.name} ${e.embg} ${e.position}`.toLowerCase().includes(q)));
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const edit = sp.edit ? all.find((e) => e.id === sp.edit) : undefined;
  const nextNo = String(Math.max(0, ...all.map((e) => parseInt(e.no ?? '') || 0)) + 1);
  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

  /* leave / sick leave of the business year: payroll lines (legacy leaveStats) + registry entries */
  const lines = await db().select({ empId: payrollEmp.employeeId, type: payrollLines.type, hours: payrollLines.hours })
    .from(payrollLines).innerJoin(payrollEmp, eq(payrollEmp.id, payrollLines.runEmpId)).innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
    .where(and(eq(payrollRuns.firmId, firm.id), like(payrollRuns.month, `${year}-%`)));
  const reg = await db().select({ empId: hrDocs.employeeId, kind: hrDocs.kind, days: sql<string>`coalesce(sum(${hrDocs.days}),0)` }).from(hrDocs)
    .where(and(eq(hrDocs.firmId, firm.id), inArray(hrDocs.kind, ['leave', 'sick']), sql`extract(year from ${hrDocs.start}) = ${year}`))
    .groupBy(hrDocs.employeeId, hrDocs.kind);
  const runsByEmp = new Map<string, { type: string; hours: number }[]>();
  for (const l of lines) if (l.empId) (runsByEmp.get(l.empId) ?? runsByEmp.set(l.empId, []).get(l.empId)!).push({ type: l.type, hours: Number(l.hours) });
  const regDays = (id: string, k: string) => Number(reg.find((r) => r.empId === id && r.kind === k)?.days ?? 0);
  const active = all.filter((e) => e.active);

  return (
    <>
      <Hd t="Вработени" sub={`${all.filter((e) => e.active).length} активни · ${all.length} вкупно`}>
        {write && <Link className="btn pri" href="/vraboteni?nov">+ Додај</Link>}
        <Link className="btn" href="/plati">Пресметка на плата</Link>
        <Link className="btn" href="/dogovori">Евиденција на договори</Link>
      </Hd>
      {write && sp.nov === undefined && !edit && <EmpScan firmId={firm.id} />}
      {(sp.nov !== undefined || edit) && write && <EmployeeForm e={edit ?? null} nextNo={nextNo} positions={[...new Set(all.map((e) => e.position).filter((x): x is string => !!x))]} />}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={sp.q ?? ''} placeholder="🔍 Барај по име, број, ЕМБГ, работно место…" style={{ flex: 1, minWidth: 220 }} />
        <label className="chk"><input type="checkbox" name="all" defaultChecked={sp.all !== undefined} /> и неактивни</label>
        <button className="btn">Барај</button>
      </form>
      {rows.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Бр.</th><th>Име и презиме</th><th>ЕМБГ</th><th>Работно место</th><th className="n">Основна нето плата</th><th className="n">Коеф.</th><th>Вработен од</th><th>Договор до</th><th>МПИН општина</th><th>Сметка</th><th></th></tr></thead>
          <tbody>{rows.map((e) => {
            const codes = mpinEmpCodes({ city: e.city ?? '', address: e.address ?? '', mpOps: e.mpOps ?? '', mpZan: e.mpZan ?? '' });
            return (
              <tr key={e.id} style={e.active ? undefined : { opacity: 0.55 }}>
                <td>{e.no}</td><td>{e.name}{e.endReason && <> <span className="pill">{e.endReason}</span></>}</td>
                <td>{e.embg}{e.embg && e.embg.length !== 13 && <span className="pill bad">ЕМБГ?</span>}</td>
                <td>{e.position}</td><td className="n">{fmt(e.netBase)}</td><td className="n">{Number(e.coef)}</td>
                <td>{dmy(e.start)}</td>
                <td>{e.end ? <span className={'pill ' + (e.end < today ? 'bad' : e.end <= soon ? 'warn' : '')}>{dmy(e.end)}</span> : ''}</td>
                <td>{codes.ops ? `${codes.ops} ${mpOpsName(codes.ops)}` : <span className="pill warn">нема</span>}{!e.mpOps && codes.ops && <small className="note"> (од град)</small>}</td>
                <td>{e.bankAcc}{e.bankAcc && !mkAccountValid(e.bankAcc) && <span className="pill warn" title="Контролните цифри не одговараат">?</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {write && <Link className="btn sm" href={`/vraboteni?edit=${e.id}`}>Измени</Link>}{' '}
                  <Link className="btn sm" href={`/vraboteni/${e.id}/dogovor`}>Договор</Link>{' '}
                  <Link className="btn sm ghost" href={`/vraboteni/${e.id}/merki`} title="Предупредување, дисциплинска мерка, отказ, спогодба">⚖</Link>{' '}
                  {write && <RowAction action={setEmployeeActive.bind(null, e.id, !e.active)} label={e.active ? 'Неактивен' : 'Активирај'} />}
                  {del && <RowAction action={deleteEmployee.bind(null, e.id)} label="Избриши" confirm={`Да се избрише „${e.name}“?`} />}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : <div className="card empty">{q ? `Нема вработен што одговара на „${q}“.` : 'Нема внесени вработени. Притиснете „+ Додај“.'}</div>}

      {active.length > 0 && (
        <div className="card">
          <div className="hd"><h2>Годишен одмор и боледување {year}</h2></div>
          <div className="tw"><table>
            <thead><tr><th>Вработен</th><th>Вработен од</th><th className="n">Стаж (год.)</th><th className="n">Право на одмор</th><th className="n">Искористено</th><th className="n">Остаток</th><th className="n">Боледување (дена)</th><th className="n">Заведено: решенија за одмор / боледувања (дена)</th><th>Договор / документи</th></tr></thead>
            <tbody>{active.map((e) => {
              const L = payLeaveStats(e.id, [{ emps: [{ empId: e.id, lines: runsByEmp.get(e.id) ?? [] }] }], e.leaveDays);
              return (
                <tr key={e.id}>
                  <td>{e.name}</td><td>{dmy(e.start)}</td>
                  <td className="n">{stazFor({ start: e.start ?? undefined, stazY: e.stazY, stazPrev: e.stazPrev }, today.slice(0, 7))}</td>
                  <td className="n">{L.right}</td><td className="n">{L.used}</td>
                  <td className="n" style={{ color: L.rest < 0 ? 'var(--bad)' : 'inherit' }}>{L.rest}</td><td className="n">{L.sick}</td><td className="n">{regDays(e.id, 'leave')} / {regDays(e.id, 'sick')}</td>
                  <td>
                    <Link className="btn sm" href={`/vraboteni/${e.id}/dogovor`}>Договор</Link>{' '}
                    {e.contract === 'определено' && e.end && <Link className="btn sm pri" href={`/vraboteni/${e.id}/dogovor#prodolzi`}>Продолжи</Link>}{' '}
                    {e.end && e.end < soon && <span className={'pill ' + (e.end < today ? 'bad' : 'warn')}>договор до {dmy(e.end)}</span>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <p className="note">Искористено и боледување се пресметуваат од часовите „Годишен одмор“ и „Боледување“ во платите за {year} (како во старата програма); решенијата за одмор и боледувањата заведени во „Евиденција на договори“ се прикажани посебно.</p>
        </div>
      )}
    </>
  );
}
