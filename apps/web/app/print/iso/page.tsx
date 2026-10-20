/**
 * „Преглед од раководството“ (ISO 9001 §9.3) of the office for one year, composed from the ISO registers: complaints
 * (ISO 10002), nonconformities and corrective actions, internal audits, risks, objectives, trainings, information
 * security incidents (ISO 27001), the documents in force, the system evidence; the decisions are written by hand.
 */
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { ISO_STATUS, isoNo, isoReview, type IsoKind, type IsoRow, type IsoStatus } from '@wise/core/office/iso';
import { getOfficeProfile, isoEvidence, isoRecords } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { viewAllowed } from '@/lib/nav';

export const metadata = { title: 'Преглед од раководството' };

export default async function PrintIso({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'iso') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : new Date().getFullYear();
  const [R0, O] = await Promise.all([db().select().from(isoRecords), getOfficeProfile(db())]);
  const R: IsoRow[] = R0.map((r) => ({ id: r.id, kind: r.kind as IsoKind, no: r.no, year: r.year, title: r.title, status: r.status as IsoStatus, due: r.due, created: r.createdAt.toISOString(), closed: r.closedAt?.toISOString() ?? null, data: r.data ?? {} }));
  const V = isoReview(R, year);
  const ev = await db().transaction((tx) => isoEvidence(tx, new Date(`${year}-01-01T00:00:00Z`)));
  const no = (r: IsoRow) => isoNo(r.kind, r.no, r.year);
  const H = ({ n, t }: { n: number; t: string }) => <h2 style={{ fontSize: '11.5pt', margin: '5mm 0 2mm', borderBottom: '1px solid #999' }}>{n}. {t}</h2>;
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: '.pdfdoc table{font-size:9pt;width:100%}.pdfdoc td,.pdfdoc th{vertical-align:top}.lines div{border-bottom:1px solid #999;height:7mm}' }} />
      <div style={{ textAlign: 'center', marginBottom: '4mm' }}>
        <div style={{ fontSize: '9pt' }}>{O.name}</div>
        <div style={{ fontSize: '15pt', fontWeight: 700 }}>ПРЕГЛЕД ОД РАКОВОДСТВОТО за {year}</div>
        <div style={{ fontSize: '9pt' }}>ISO 9001:2015 §9.3 · ISO/IEC 27001:2022 §9.3 · ISO 10002 · изработено {dmy(new Date().toISOString())}</div>
      </div>

      <H n={1} t="Поплаки на клиенти (ISO 10002)" />
      <p>Примени <b>{V.complaints.n}</b>, решени <b>{V.complaints.closed}</b>{V.complaints.avgDays != null ? <>, просечно време на решавање <b>{V.complaints.avgDays}</b> дена</> : null}{V.complaints.satisfied != null ? <>, задоволни клиенти <b>{V.complaints.satisfied}%</b></> : null}.</p>

      <H n={2} t="Неусогласености и корективни мерки (§10.2)" />
      <p>Вкупно <b>{V.nc.n}</b>, отворени <b>{V.nc.open}</b>.{V.nc.bySource.length ? <> По извор: {V.nc.bySource.map(([k, n]) => `${k} ${n}`).join(', ')}.</> : null}</p>

      <H n={3} t="Резултати од внатрешните проверки (§9.2)" />
      {V.audits.length ? <table><thead><tr><th>Бр.</th><th>Проверка</th><th>Датум</th><th>Заклучок</th></tr></thead><tbody>
        {V.audits.map((r) => <tr key={r.id}><td>{no(r)}</td><td>{r.title}</td><td>{r.data.date ? dmy(String(r.data.date)) : ''}</td><td>{String(r.data.conclusion ?? '')}</td></tr>)}
      </tbody></table> : <p>⚠ Во {year} нема евидентирана внатрешна проверка.</p>}

      <H n={4} t="Ризици и можности (§6.1)" />
      <p>Отворени ризици <b>{V.risks.open}</b>, високи (≥ 15) <b>{V.risks.high.length}</b>.</p>
      {V.risks.list.length > 0 && <table><thead><tr><th>Бр.</th><th>Ризик</th><th>Оценка</th><th>Мерка</th></tr></thead><tbody>
        {V.risks.list.map(({ r, sc }) => <tr key={r.id}><td>{no(r)}</td><td>{r.title}</td><td>{sc?.s ?? '—'}</td><td>{String(r.data.treatment ?? '')}</td></tr>)}
      </tbody></table>}

      <H n={5} t="Цели на квалитетот (§6.2)" />
      {V.objectives.length ? <table><thead><tr><th>Цел</th><th>Мерење</th><th>Постигнато</th><th>Статус</th></tr></thead><tbody>
        {V.objectives.map((r) => <tr key={r.id}><td>{r.title}{r.data.target ? ` – ${String(r.data.target)}` : ''}</td><td>{String(r.data.measure ?? '')}</td><td>{String(r.data.value ?? '')}</td><td>{ISO_STATUS[r.status]}</td></tr>)}
      </tbody></table> : <p>⚠ Нема поставени цели.</p>}

      <H n={6} t="Обуки и компетентност (§7.2)" />
      <p>Обуки <b>{V.trainings.n}</b>, вкупно <b>{V.trainings.hours}</b> часа.</p>

      <H n={7} t="Безбедност на информациите (ISO 27001)" />
      <p>Инциденти <b>{V.incidents.n}</b> (известени надлежни / клиенти: {V.incidents.notified}). Активни корисници <b>{ev.users.filter((x) => x.active).length}</b>, евидентирани промени во годината <b>{ev.changes.toLocaleString('mk-MK')}</b>, најавувања <b>{ev.logins.toLocaleString('mk-MK')}</b>, грешки на системот отворени <b>{ev.errors.open}</b> / решени <b>{ev.errors.fixed}</b>.</p>

      <H n={8} t="Документи во сила (§7.5)" />
      {V.policies.length ? <table><thead><tr><th>Документ</th><th>Верзија</th><th>Одобрил</th><th>Одобрено</th></tr></thead><tbody>
        {V.policies.map((r) => <tr key={r.id}><td>{r.title}</td><td>{String(r.data.version ?? '')}</td><td>{String(r.data.approvedBy ?? '')}</td><td>{r.data.approvedOn ? dmy(String(r.data.approvedOn)) : '⚠ неодобрено'}</td></tr>)}
      </tbody></table> : <p>⚠ Нема документи.</p>}

      <H n={9} t="Одлуки и мерки за подобрување (§9.3.3)" />
      <div className="lines">{Array.from({ length: 6 }, (_, i) => <div key={i} />)}</div>
      <table style={{ marginTop: '10mm' }}><tbody><tr>
        <td style={{ width: '50%' }}>Изработил: ______________________</td><td>Управител: ______________________</td>
      </tr></tbody></table>
    </div>
  );
}
