/**
 * „⚙ Автоматизации“ (UX Phase 3, office settings — OWNER only): every scheduled automation (P35–P38, P43) with its
 * „автоматски“ switch, its schedule, its last run and the drafts waiting for a person. The rule on top: the program
 * prepares, a person confirms — nothing is posted, filed, sent to a client or to УЈП without a click; nothing in a
 * locked period; never a 🎭 demo firm. Everything is OFF until the owner switches it on (the law texts excepted: they
 * were already synchronised weekly).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { AUTO_KINDS, AUTO_META, type AutoKind } from '@wise/core/office/automations';
import { lastFinishedMonth, periodLabel } from '@wise/core/office';
import { amlPurgeList, autoFirms, autoLastRuns, autopilotFindings, autoSettings, draftCounts, draftReportCount, firms, realFirmSql } from '@wise/db';
import { ActionForm, Submit } from '@/components/action-form';
import { whenText } from '@/components/auto-status';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { today } from '@/lib/office';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';
import { runAutomationNow, saveAutomations } from './actions';

const T = '⚙ Автоматизации';

export default async function AutomationsPage() {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  if (isDemoUser(u) || !(await isOfficeOwner(u))) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const td = today();
  const rp = lastFinishedMonth(td);
  const [S, runs, counts, clients, lr, purge] = await Promise.all([
    autoSettings(db()), autoLastRuns(db()), draftCounts(db()), autoFirms(db(), { office: false }),
    db().select({ n: sql<number>`count(*)::int` }).from(autopilotFindings).innerJoin(firms, eq(firms.id, autopilotFindings.firmId))
      .where(and(like(autopilotFindings.key, 'lr:%'), isNull(autopilotFindings.resolvedAt), realFirmSql)),
    amlPurgeList(db(), td),
  ]);
  const reports = await draftReportCount(db(), rp, clients.map((f) => f.id));
  const waiting: Record<AutoKind, React.ReactNode> = {
    close: counts.close ? <Link href="/zatvoranje">{counts.close} месеци подготвени</Link> : null,
    payroll: counts.payroll ? <Link href="/plati/nacrti">{counts.payroll} нацрти</Link> : null,
    vat: counts.vat ? <Link href="/ddv/nacrti">{counts.vat} нацрти</Link> : null,
    reports: reports ? <Link href="/mesIzv">{reports} за {periodLabel(rp)} – необјавени</Link> : null,
    lawrep: lr[0]?.n ? <Link href="/autop">{lr[0].n} отворени наоди</Link> : null,
    dunning: counts.dunning ? <Link href="/opomeni">{counts.dunning} фирми со предлози</Link> : null,
    aml: purge.clients.length + purge.reports.length ? <Link href="/aml?tab=reg">{purge.clients.length + purge.reports.length} за бришење (истечен рок)</Link> : null,
    lawTexts: null,
    service: counts.service ? <Link href="/potsetnici">{counts.service} фирми со пораки</Link> : null,
  };
  return (
    <>
      <Hd t={T} sub="закажани задачи на канцеларијата" />
      <div className="callout">
        <b>Програмата подготвува, човекот потврдува.</b> Секоја автоматизација прави само <b>нацрти</b> и листа „Преглед“: ништо не се книжи,
        не се поднесува, не се праќа до клиент или до УЈП без ваш клик. Во заклучен период не се прави ништо, демо фирмите никогаш не се допираат,
        а секое масовно потврдување се запишува во „Активност“. Сите се исклучени додека не ги вклучите.
      </div>
      <ActionForm action={saveAutomations} reset={false} className="card tw">
        <table className="dense">
          <thead><tr><th>Автоматски</th><th>Автоматизација</th><th>Распоред</th><th>Последно</th><th>Чека преглед</th><th /></tr></thead>
          <tbody>{AUTO_KINDS.map((k) => {
            const M = AUTO_META[k], r = runs[k];
            return (
              <tr key={k}>
                <td><label className="chk" style={{ margin: 0 }}><input type="checkbox" name={`on_${k}`} defaultChecked={S.on[k]} aria-label={`${M.name}: автоматски`} /> {S.on[k] ? 'вклучено' : 'исклучено'}</label></td>
                <td><b>{M.name}</b> <span className="mini">{M.p}</span><div className="mini">{M.what}</div></td>
                <td className="mini">{M.when}{k === 'payroll' && ` (ден ${S.payDay})`}{k === 'reports' && ` (ден ${S.reportDay})`}</td>
                <td className="mini">{r ? <><b>{whenText(r.at)}</b>{r.summary && <div>{r.summary}</div>}</> : 'сè уште не'}</td>
                <td className="mini">{waiting[k] ?? '—'}</td>
                <td>{S.on[k] && <RowAction action={runAutomationNow.bind(null, k)} label="▶ Сега" title="Пушти ја сега (повторно само подготвува)" />} <Link className="btn sm ghost" href={M.screen}>Отвори</Link></td>
              </tr>
            );
          })}</tbody>
        </table>
        <h3 style={{ fontSize: 14, margin: '12px 0 6px' }}>Поставки</h3>
        <div className="form">
          <label className="f">Плати – ден во месецот (1–28)<input name="payDay" type="number" min={1} max={28} defaultValue={S.payDay} /></label>
          <label className="f">Плати – кој месец<select name="payMonth" defaultValue={S.payMonth}><option value="prev">месецот што заврши (на 1-ви: минатиот)</option><option value="cur">тековниот месец</option></select></label>
          <label className="f">Месечен извештај – ден во месецот (1–28)<input name="reportDay" type="number" min={1} max={28} defaultValue={S.reportDay} /></label>
        </div>
        <label className="chk"><input type="checkbox" name="reportAi" defaultChecked={S.reportAi} /> Месечен извештај: и 💲 AI преглед (трошок; месечниот AI лимит важи)</label>
        <label className="chk"><input type="checkbox" name="reportPublish" defaultChecked={S.reportPublish} /> Месечен извештај: објави го автоматски во порталот на клиентот (без „Објави ги сите подготвени“)</label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><Submit>Зачувај</Submit></div>
      </ActionForm>
      <p className="note">Нацртите се гледаат и потврдуваат на: <Link href="/zatvoranje">Месечно затворање</Link> („🔒 Заклучи ги сите подготвени“), <Link href="/plati/nacrti">Плати – нацрти</Link>, <Link href="/ddv/nacrti">ДДВ-04 – нацрти</Link>, <Link href="/mesIzv">Месечен извештај</Link> („📢 Објави ги сите подготвени“), <Link href="/autop">Автопилот</Link> (даночен преглед), <Link href="/opomeni">Опомени</Link>, <Link href="/aml">УФР</Link>, <Link href="/potsetnici">Потсетници за сервис</Link>. Колегите со „само сметководство“ ги гледаат нацртите за плати и ДДВ на своите фирми.</p>
    </>
  );
}
