/**
 * „Преглед од раководството“ (ISO 9001 §9.3) of the office for one year, composed from the ISO registers: complaints
 * (ISO 10002), nonconformities and corrective actions, internal audits, risks, objectives, trainings, information
 * security incidents (ISO 27001), personal data (ISO 27701 / ЗЗЛП – with the ЗЗЛП screen's register), business
 * continuity (ISO 22301), the audit programme, the employees (A.6), suppliers, the certification readiness, the
 * documents in force, the system evidence; the decisions of the recorded review (register „Прегледи од раководството“)
 * or lines to write them by hand. `?doc=soa` prints the Statement of Applicability (ISO/IEC 27001 §6.1.3 d).
 */
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { BCP_STATE, ISO_DOC, ISO_STATUS, isoNo, isoReview, type IsoRow, type IsoSign } from '@wise/core/office/iso';
import { SOA_THEMES, soaSummary, type SoaTheme } from '@wise/core/office/iso-soa';
import { getOfficeProfile, isoEvidence, isoGdprLinks } from '@wise/db';
import { loadIsoRows, loadReadiness, loadSoaMerged, loadStaff } from '../../(app)/iso/iso-data';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { today } from '@/lib/office';
import { dmy } from '@/lib/fmt';
import { viewAllowed } from '@/lib/nav';

export const metadata = { title: 'Преглед од раководството' };

export default async function PrintIso({ searchParams }: { searchParams: Promise<{ y?: string; doc?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'iso') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : new Date().getFullYear();
  const [R, O] = await Promise.all([loadIsoRows(), getOfficeProfile(db())]);
  if (sp.doc === 'soa') return <SoaPrint office={O.name ?? ''} R={R} />;
  const td = today(), asOf = String(year) === td.slice(0, 4) ? td : `${year}-12-31` < td ? `${year}-12-31` : td;
  const staff = await loadStaff(R, asOf);
  const ready = await loadReadiness(R, staff.lines, year, asOf);
  const plans = R.filter((r) => r.kind === 'auditplan' && (r.year === year || String(r.data.month ?? '').startsWith(String(year))));
  const rec = R.filter((r) => r.kind === 'review' && (r.year === year || String(r.data.date ?? '').startsWith(String(year)))).sort((a, b) => b.created.localeCompare(a.created))[0];
  const sup = R.filter((r) => r.kind === 'supplier');
  const V = isoReview(R, year, asOf);
  const [ev, G] = await Promise.all([db().transaction((tx) => isoEvidence(tx, new Date(`${year}-01-01T00:00:00Z`))), db().transaction((tx) => isoGdprLinks(tx, year, asOf))]);
  const P = V.privacy, C = V.continuity;
  const title = (id: unknown) => R.find((r) => r.id === id)?.title ?? '';
  const no = (r: IsoRow) => isoNo(r.kind, r.no, r.year);
  const H = ({ n, t }: { n: number; t: string }) => <h2 style={{ fontSize: '11.5pt', margin: '5mm 0 2mm', borderBottom: '1px solid #999' }}>{n}. {t}</h2>;
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: '.pdfdoc table{font-size:9pt;width:100%}.pdfdoc td,.pdfdoc th{vertical-align:top}.lines div{border-bottom:1px solid #999;height:7mm}' }} />
      <div style={{ textAlign: 'center', marginBottom: '4mm' }}>
        <div style={{ fontSize: '9pt' }}>{O.name}</div>
        <div style={{ fontSize: '15pt', fontWeight: 700 }}>ПРЕГЛЕД ОД РАКОВОДСТВОТО за {year}</div>
        <div style={{ fontSize: '9pt' }}>ISO 9001:2015 §9.3 · ISO/IEC 27001:2022 §9.3 · ISO 10002 · ISO/IEC 27701 · ISO 22301 §9.3 · изработено {dmy(new Date().toISOString())}</div>
      </div>

      <H n={1} t="Поплаки на клиенти (ISO 10002)" />
      <p>Примени <b>{V.complaints.n}</b>, решени <b>{V.complaints.closed}</b>{V.complaints.avgDays != null ? <>, просечно време на решавање <b>{V.complaints.avgDays}</b> дена</> : null}{V.complaints.satisfied != null ? <>, задоволни клиенти <b>{V.complaints.satisfied}%</b></> : null}.</p>

      <H n={2} t="Неусогласености и корективни мерки (§10.2)" />
      <p>Вкупно <b>{V.nc.n}</b>, отворени <b>{V.nc.open}</b>.{V.nc.bySource.length ? <> По извор: {V.nc.bySource.map(([k, n]) => `${k} ${n}`).join(', ')}.</> : null}</p>

      <H n={3} t="Резултати од внатрешните проверки (§9.2)" />
      {plans.length > 0 ? <table style={{ marginBottom: '2mm' }}><thead><tr><th>Програма {year}</th><th>Планирано</th><th>Проверувач</th><th>Извршено</th></tr></thead><tbody>
        {plans.map((p) => { const a = V.audits.find((x) => x.data.plan === p.id && x.status === 'done'); return <tr key={p.id}><td>{p.title}</td><td>{p.data.month ? dmy(String(p.data.month)) : ''}</td><td>{String(p.data.auditor ?? '')}</td><td>{a ? `${no(a)}${a.data.date ? ' · ' + dmy(String(a.data.date)) : ''}` : String(p.data.month ?? '') < asOf ? '⚠ не е извршена' : 'претстои'}</td></tr>; })}
      </tbody></table> : <p>⚠ Нема програма за внатрешни проверки за {year}.</p>}
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

      <H n={8} t="Заштита на личните податоци (ISO/IEC 27701 · ЗЗЛП)" />
      <p>Евидентирани обработки на канцеларијата <b>{P.processing.length}</b>{P.processing.length ? <> ({P.processing.filter((r) => String(r.data.role ?? '').startsWith('контролор')).length} како контролор, {P.processing.filter((r) => String(r.data.role ?? '').startsWith('обработувач')).length} како обработувач)</> : null}; договори за обработка со <b>{G.dpa}</b> клиенти, обработки по клиент <b>{G.activities}</b> кај {G.activityFirms} клиенти, изјави за доверливост <b>{G.statements}</b>.</p>
      <p>Барања од субјекти <b>{P.dsr.n + G.requests.n}</b>{P.dsr.n ? <> (во ISO регистарот {P.dsr.n}: одговорени {P.dsr.answered}, во рок {P.dsr.inTime}{P.dsr.late ? <>, <b>задоцнети {P.dsr.late}</b></> : null}{P.dsr.byType.length ? <>; {P.dsr.byType.map(([k, n]) => `${k} ${n}`).join(', ')}</> : null})</> : null}{G.requests.n ? <> · во регистарот ЗЗЛП по клиент {G.requests.n}{G.requests.late ? <>, отворени по рокот {G.requests.late}</> : null}</> : null}.</p>
      <p>Повреди на безбедноста со лични податоци <b>{P.breaches.n + G.breaches.n}</b>{P.breaches.n ? <> – известена АЗЛП во 72 часа: {P.breaches.ok}{P.breaches.late ? <>, <b>задоцнето / неизвестено: {P.breaches.late}</b></> : null}</> : null}.</p>
      {P.dpia.length > 0 ? <table><thead><tr><th>Бр.</th><th>Процена на влијание (DPIA)</th><th>Обработка</th><th>Преостанат ризик</th><th>Статус</th></tr></thead><tbody>
        {P.dpia.map((r) => <tr key={r.id}><td>{no(r)}</td><td>{r.title}</td><td>{title(r.data.processing)}</td><td>{String(r.data.residual ?? '')}</td><td>{ISO_STATUS[r.status]}</td></tr>)}
      </tbody></table> : <p>Нема процени на влијание (DPIA) – потребни се пред нова обработка со висок ризик.</p>}
      {!P.processing.length && <p>⚠ Евиденцијата на обработки (ЗЗЛП чл. 30) е празна.</p>}

      <H n={9} t="Континуитет на работењето (ISO 22301)" />
      {C.plans.length ? <table><thead><tr><th>Сценарио</th><th>RTO</th><th>RPO</th><th>Последен тест</th><th>Резултат</th><th>Состојба</th></tr></thead><tbody>
        {C.plans.map((b) => <tr key={b.r.id}><td>{no(b.r)} {b.r.title}</td><td>{b.rto != null ? `${b.rto} ч.` : '—'}</td><td>{b.rpo != null ? `${b.rpo} ч.` : '—'}</td><td>{b.lastTest ? dmy(b.lastTest) : '—'}</td>
          <td>{b.test ? <>{String(b.test.data.result ?? '')}{b.test.data.took != null ? ` · ${String(b.test.data.took)} ч.` : ''}</> : ''}</td><td>{BCP_STATE[b.state]}</td></tr>)}
      </tbody></table> : <p>⚠ Нема план за континуитет.</p>}
      <p>Тестови на враќање од резервна копија и вежби во {year}: <b>{C.tests.length}</b>{C.tests.length ? <> (успешни {C.tests.filter((r) => r.data.result === 'успешно').length})</> : null}{C.tests.filter((r) => r.data.type === 'тест на враќање од резервна копија').length < 2 ? <> – ⚠ препорачано најмалку 2 теста на враќање годишно.</> : '.'}</p>

      <H n={10} t="Вработени – безбедност на човечките ресурси (ISO/IEC 27001 A.6)" />
      {staff.lines.length ? <table><thead><tr><th>Вработен</th><th>Договор (одредби за безбедност, потпишан)</th><th>Политики</th><th>Обука</th><th>Пристап</th></tr></thead><tbody>
        {staff.lines.map((l) => <tr key={l.emp.id}><td>{l.emp.name}</td><td>{l.s.contract === 'ok' ? '✓' : l.s.contract === 'part' ? '◐' : '✗'} {l.contract ? `бр. ${l.contract.no}` : 'не е заведен'}{l.row?.data.contractOn ? ` · потпишан ${dmy(String(l.row.data.contractOn))}` : ''}</td>
          <td>{l.s.policies === 'ok' ? '✓' : l.s.policies === 'na' ? '–' : l.s.policies === 'part' ? '◐ нова верзија' : '✗'}</td><td>{l.s.trainedOn ? dmy(l.s.trainedOn) : '✗'}</td><td>{l.s.access === 'ok' || l.s.access === 'na' ? '✓' : '⚠'}</td></tr>)}
      </tbody></table> : <p>Нема вработени во фирмата на канцеларијата.</p>}

      <H n={11} t="Надворешни добавувачи (§8.4 · A.5.19–5.22)" />
      <p>Добавувачи <b>{sup.length}</b>, оценети <b>{sup.filter((r) => r.data.evaluation).length}</b>, со лични податоци без договор за обработка <b>{sup.filter((r) => r.data.personal === 'да' && r.data.dpa !== 'потпишан / прифатен').length}</b>.</p>

      <H n={12} t="Подготвеност за сертификација" />
      <table><thead><tr><th>Стандард</th><th>Подготвено</th><th>Отворено</th></tr></thead><tbody>
        {ready.map((s) => <tr key={s.std}><td>{s.n}</td><td>{s.pct}%</td><td>{s.items.filter((x) => x.state !== 'ok').map((x) => `${x.clause} ${x.n}`).filter((x, i, a) => a.indexOf(x) === i).slice(0, 12).join('; ') || '—'}</td></tr>)}
      </tbody></table>

      <H n={13} t="Документи во сила (§7.5)" />
      {V.policies.length ? <table><thead><tr><th>Ознака</th><th>Документ</th><th>Верзија</th><th>Одобрил</th><th>Одобрено</th><th>Преглед</th></tr></thead><tbody>
        {[...V.policies].sort((a, b) => String(a.data.docNo ?? '').localeCompare(String(b.data.docNo ?? ''), 'mk')).map((r) => <tr key={r.id}><td>{String(r.data.docNo ?? '')}</td><td>{r.title}</td><td>{String(r.data.version ?? '')}</td><td>{String(r.data.approvedBy ?? '')}</td><td>{r.data.approvedOn && r.status === 'done' ? dmy(String(r.data.approvedOn)) : '⚠ нацрт'}</td><td>{r.data.reviewOn ? dmy(String(r.data.reviewOn)) : ''}</td></tr>)}
      </tbody></table> : <p>⚠ Нема документи.</p>}

      <H n={14} t="Одлуки и мерки за подобрување (§9.3.3)" />
      {rec ? <>
        <p>Прегледот е одржан{rec.data.date ? ` на ${dmy(String(rec.data.date))}` : ''}{rec.data.participants ? `; присутни: ${String(rec.data.participants)}` : ''} ({no(rec)}).</p>
        {rec.data.decisions ? <p style={{ whiteSpace: 'pre-line' }}><b>Одлуки:</b> {String(rec.data.decisions)}</p> : null}
        {rec.data.resources ? <p style={{ whiteSpace: 'pre-line' }}><b>Ресурси / промени:</b> {String(rec.data.resources)}</p> : null}
        {rec.data.nextOn ? <p>Следен преглед: {dmy(String(rec.data.nextOn))}.</p> : null}
        {(rec.data._sign as IsoSign | undefined) ? <p className="mini">✍ Потврдил {(rec.data._sign as IsoSign).name}, {dmy((rec.data._sign as IsoSign).at)}</p> : null}
      </> : <div className="lines">{Array.from({ length: 6 }, (_, i) => <div key={i} />)}</div>}
      <table style={{ marginTop: '10mm' }}><tbody><tr>
        <td style={{ width: '50%' }}>Изработил: ______________________</td><td>Управител: ______________________</td>
      </tr></tbody></table>
    </div>
  );
}

/** ISO/IEC 27001:2022 §6.1.3 d – the Statement of Applicability for print (93 controls), with the approval of СУ-06. */
async function SoaPrint({ office, R }: { office: string; R: readonly IsoRow[] }) {
  const L = await loadSoaMerged();
  const S = soaSummary(L);
  const d = R.find((r) => r.kind === 'policy' && r.data.docNo === ISO_DOC.soa);
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}.pdfdoc table{font-size:8pt;width:100%;border-collapse:collapse}.pdfdoc td,.pdfdoc th{border:1px solid #bbb;padding:1px 3px;vertical-align:top}' }} />
      <div style={{ textAlign: 'center', marginBottom: '3mm' }}>
        <div style={{ fontSize: '9pt' }}>{office}</div>
        <div style={{ fontSize: '14pt', fontWeight: 700 }}>ИЗЈАВА ЗА ПРИМЕНЛИВОСТ (SoA)</div>
        <div style={{ fontSize: '9pt' }}>ISO/IEC 27001:2022 §6.1.3 d) · Анекс А · {ISO_DOC.soa}{d ? ` · верзија ${String(d.data.version ?? '')}${d.data.approvedOn ? ` · одобрено ${dmy(String(d.data.approvedOn))} (${String(d.data.approvedBy ?? '')})` : ' · ⚠ неодобрено'}` : ' · ⚠ документот не постои'} · изработено {dmy(new Date().toISOString())}</div>
        <div style={{ fontSize: '9pt' }}>Контроли {S.total}: применливи {S.applicable} (спроведени {S.done}, делумно {S.partial}, планирани {S.planned}), исклучени {S.excluded}; потврдени {S.confirmed}</div>
      </div>
      {(Object.keys(SOA_THEMES) as SoaTheme[]).map((t) => (
        <table key={t} style={{ marginBottom: '3mm' }}><thead><tr><th colSpan={5} style={{ textAlign: 'left', background: '#eee' }}>{SOA_THEMES[t]}</th></tr>
          <tr><th style={{ width: '20%' }}>Контрола</th><th style={{ width: '6%' }}>Се применува</th><th>Оправдување</th><th style={{ width: '9%' }}>Состојба</th><th>Доказ / спроведување</th></tr></thead>
          <tbody>{L.filter((c) => c.theme === t).map((c) => <tr key={c.id}><td><b>{c.id}</b> {c.n}</td><td>{c.applicable ? 'да' : 'не'}</td><td>{c.justification}</td><td>{c.status}{c.confirmed ? '' : ' *'}</td><td>{c.evidence}</td></tr>)}</tbody></table>
      ))}
      <p style={{ fontSize: '8pt' }}>* предлог, сè уште непотврден од канцеларијата.</p>
      <table style={{ marginTop: '8mm', border: 0 }}><tbody><tr><td style={{ border: 0, width: '50%' }}>Изработил: ______________________</td><td style={{ border: 0 }}>Одобрил (управител): ______________________</td></tr></tbody></table>
    </div>
  );
}
