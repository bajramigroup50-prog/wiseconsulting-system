/**
 * „Изјава за прифаќање на политиките“ (ISO/IEC 27001 A.6.3, §7.3): the colleague confirms receiving, reading and
 * following the documents in force – listed with their mark and version, so a new version needs a new statement.
 * One (`?e=`) or all active colleagues (`?all=1`) of the office's own firm.
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { policiesInForce } from '@wise/core/office/iso-staff';
import { employees, getOfficeProfile } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { viewAllowed } from '@/lib/nav';
import { loadIsoRows, officeFirm } from '../../../(app)/iso/iso-data';

export const metadata = { title: 'Изјава за прифаќање на политиките' };

export default async function PrintIsoPolicies({ searchParams }: { searchParams: Promise<{ e?: string; all?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'iso') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  const office = await officeFirm();
  if (!office) notFound();
  const [E0, R, O] = await Promise.all([db().select().from(employees).where(eq(employees.firmId, office.id)).orderBy(employees.name), loadIsoRows(), getOfficeProfile(db())]);
  const E = sp.e ? E0.filter((e) => e.id === sp.e) : sp.all ? E0.filter((e) => e.active) : [];
  if (!E.length) notFound();
  const P = policiesInForce(R);
  const name = O.name || office.name;
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: '.ackp+.ackp{break-before:page;page-break-before:always}.ackp table{width:100%;font-size:9.5pt;border-collapse:collapse}.ackp td,.ackp th{border:1px solid #999;padding:2px 4px;vertical-align:top}' }} />
      {E.map((e) => (
        <div key={e.id} className="ackp" style={{ fontFamily: "'Times New Roman',Georgia,serif", fontSize: '11pt', lineHeight: 1.5 }}>
          <div style={{ fontSize: '9pt' }}>{name}{office.address ? `, ${office.address}` : ''}{office.city ? `, ${office.city}` : ''}</div>
          <h1 style={{ textAlign: 'center', fontSize: '15pt', margin: '8mm 0 2mm' }}>ИЗЈАВА</h1>
          <p style={{ textAlign: 'center', margin: '0 0 6mm' }}><b>за прифаќање на политиките и постапките на системот за управување</b><br /><span style={{ fontSize: '9pt' }}>ISO 9001 · ISO/IEC 27001 · ISO/IEC 27701 · ISO 22301 · Закон за заштита на личните податоци</span></p>
          <p style={{ textAlign: 'justify' }}>Јас, долупотпишаниот/ата <b>{e.name}</b>, ЕМБГ {e.embg || '____________'}, вработен/а на работното место {e.position || '____________________'} во {name}, изјавувам дека ги примив, прочитав и разбрав следните документи што се во сила и се обврзувам да ги почитувам во својата работа:</p>
          {P.length ? (
            <table><thead><tr><th>Ознака</th><th>Документ</th><th>Верзија</th><th>Во сила од</th></tr></thead>
              <tbody>{P.map((p) => <tr key={p.docNo}><td>{p.docNo}</td><td>{p.title}</td><td>{p.version}</td><td>{p.approvedOn ? dmy(p.approvedOn) : ''}</td></tr>)}</tbody></table>
          ) : <p>⚠ Нема одобрени документи во сила.</p>}
          <p style={{ textAlign: 'justify', marginTop: '4mm' }}>Запознаен/а сум дека: важечката верзија на документите е секогаш достапна во програмата; при секоја нова верзија ќе потпишам нова изјава; безбедносните настани (изгубен уред, погрешно испратен документ, сомнителен пристап) веднаш ги пријавувам; обврската за доверливост трае и по престанокот на работниот однос; и дека повредата на политиките претставува повреда на работната обврска за која може да се изрече дисциплинска мерка во согласност со Законот за работните односи.</p>
          <table style={{ marginTop: '14mm', border: 0 }}><tbody><tr>
            <td style={{ border: 0, width: '50%' }}>Место: {office.city || '____________'}<br />Датум: ____________</td>
            <td style={{ border: 0, textAlign: 'center' }}>Изјавил/а<div style={{ borderTop: '1px solid #111', marginTop: '14mm', paddingTop: 2 }}>{e.name}</div></td>
          </tr></tbody></table>
        </div>
      ))}
    </div>
  );
}
