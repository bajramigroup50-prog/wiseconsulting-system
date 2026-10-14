/**
 * „📑 Контроли и решенија (анализа)“ — register of inspections per firm (УЈП, ДПИ, ДИТ, УФР, Царина, АЗЛП):
 * the uploaded / typed record or decision, its findings (AI read or manual, with the article cited), for each finding
 * the evidence from the books of the controlled period, the program's own checks and the audit trail, the office's
 * analysis and recommendation (accept / object), the remedy deadlines (приговор / жалба / тужба), the draft of the
 * objection (print / PDF / Word) and the corrective actions with owners and due dates.
 * A client sees only the cases the office marked „видливо за клиентот“, read-only, if the portal section is on.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import {
  daysLeftText, FINDING_AREA, fmtCents, isDisputed, kontrolaClientData, isKontrolaAuth, isKontrolaDoc, KONTROLA_AUTH, KONTROLA_DOC, KONTROLA_STATUS, kontrolaDeadlines, kontrolaSummary,
  recommendFinding, RECOMMEND_LBL, SUBMISSION_LBL, VERDICT_LBL, versionsOf, type DeadlineState, type Recommendation,
} from '@wise/core/compliance';
import { klAllowedViews, type KlConfig } from '@wise/core/office';
import {
  auditLog, type FindingEvidence, KONTROLA_FILE_ENTITY, kontrolaActions, kontrolaAiState, kontrolaDue, kontrolaFindings, kontrolaTexts, kontroli, userFirms, users,
  type Firm, type Kontrola, type KontrolaFinding,
} from '@wise/db';
import { requireUser } from '@/lib/auth';
import { isOfficeOwner } from '@/lib/office-owner';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { isKontrolaReadable, kontrolaCaseDocs, pendingKontrolaReads, toFinding } from '@/lib/kontrola';
import { CaseDocs } from './case-docs';
import { viewAllowed } from '@/lib/nav';
import { filesOf, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { KontrolaAi } from '@/components/kontrola-ai';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { kAction, kActionDone, kDelete, kFinding, kFindingDelete, kMark, kPrepare, kReadFile, kRecalc, kSave } from './actions';

type SP = { id?: string; nov?: string };
const den = (c: number) => `${fmtCents(c)} ден.`;
const ST_CLS: Record<DeadlineState, string> = { expired: 'bad', today: 'bad', urgent: 'warn', open: 'good' };
const ST_LBL: Record<DeadlineState, string> = { expired: 'истечен', today: 'истекува денес', urgent: 'истекува наскоро', open: 'во рок' };
const REC_CLS: Record<Recommendation, string> = { accept: 'good', object: 'bad', partial: 'warn', review: 'info' };
const authOf = (k: Pick<Kontrola, 'auth'>) => (isKontrolaAuth(k.auth) ? KONTROLA_AUTH[k.auth] : k.auth);
const docOf = (k: Pick<Kontrola, 'doc'>) => (isKontrolaDoc(k.doc) ? KONTROLA_DOC[k.doc] : k.doc);
const deadlinesOf = (k: Kontrola, td: string) => (isKontrolaAuth(k.auth) && isKontrolaDoc(k.doc) ? kontrolaDeadlines(k.auth, k.doc, k.delivered, td, kontrolaDue(k)) : []);

function HeaderFields({ k }: { k?: Kontrola }) {
  return (
    <div className="form">
      <label className="f">Орган<select name="auth" defaultValue={k?.auth ?? 'ujp'}>{Object.entries(KONTROLA_AUTH).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      <label className="f">Акт<select name="doc" defaultValue={k?.doc ?? 'zapisnik'}>{Object.entries(KONTROLA_DOC).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      <label className="f">Број на актот<input name="docNo" defaultValue={k?.docNo ?? ''} /></label>
      <label className="f">Датум на актот<input name="docDate" type="date" defaultValue={k?.docDate ?? ''} /></label>
      <label className="f">Примен (доставен) на<input name="delivered" type="date" defaultValue={k?.delivered ?? ''} /></label>
      <label className="f" title="Ако во правната поука е наведен рок, тој има предност">Рок од правната поука<input name="dueOverride" type="date" defaultValue={k?.dueOverride ?? ''} /></label>
      <label className="f">Контролиран период од<input name="periodFrom" type="date" defaultValue={k?.periodFrom ?? ''} /></label>
      <label className="f">до<input name="periodTo" type="date" defaultValue={k?.periodTo ?? ''} /></label>
      <label className="f wide">Предмет<input name="subject" defaultValue={k?.subject ?? ''} placeholder="пр. Даночна контрола на ДДВ за I–III 2026" /></label>
      <label className="f">Статус<select name="status" defaultValue={k?.status ?? 'record'}>{Object.entries(KONTROLA_STATUS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      <label className="f">Поднесен приговор / жалба на<input name="filedOn" type="date" defaultValue={k?.filedOn ?? ''} /></label>
      <label className="chk"><input type="checkbox" name="clientVisible" defaultChecked={!!k?.clientVisible} /> видливо за клиентот (портал)</label>
    </div>
  );
}

export default async function KontroliPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const firm = await currentFirm(u);
  const client = u.role === 'klient';
  if (client) {
    if (!firm || !klAllowedViews((firm.settings as { kl?: KlConfig }).kl, firm.mods).includes('kontroli')) notFound();
  } else if (!viewAllowed(u.role, 'kontroli')) notFound();
  if (!firm) return <NoFirm t="📑 Контроли и решенија" />;
  const edit = !client && can(u.principal, 'office', firm.id);
  const td = today();

  const K0 = await db().select().from(kontroli).where(and(eq(kontroli.firmId, firm.id), client ? eq(kontroli.clientVisible, true) : undefined)).orderBy(desc(kontroli.docDate), desc(kontroli.createdAt));
  // a client (portal) never receives the office's work on a case: drafts, versions, the internal analysis, AI
  const K = client ? K0.map((x) => ({ ...x, data: kontrolaClientData(x.data) })) : K0;
  const k = sp.id ? K.find((x) => x.id === sp.id) : undefined;
  if (sp.id && !k) notFound();
  // deleting an inspection case: only the office owner (user decision 2026-10-12)
  const owner = !client && await isOfficeOwner(u);
  if (k) return <Detail k={k} firm={firm} edit={edit} client={client} canDel={owner} td={td} />;

  const FA = K.length ? await db().select().from(kontrolaFindings).where(inArray(kontrolaFindings.kontrolaId, K.map((x) => x.id))) : [];
  return (
    <>
      <Hd t="📑 Контроли и решенија (анализа)" sub={`${firm.name} · записници, решенија, рокови, приговори`}>
        {!client && <Link className="btn" href="/zakon">⚖ Законска усогласеност</Link>}
      </Hd>
      {!client && <div className="callout">Внесете го записникот или решението (или прикачете го – наодите ги чита програмата). За секој наод програмата ги покажува доказите од книгите за контролираниот период, кој и кога ги менувал, и пресметува дали износот одговара. Роковите се пресметуваат од датумот на прием (со викенди и празници); <b>рокот од правната поука на актот секогаш има предност</b> – внесете го.</div>}
      <div className="card tw">{K.length ? <table className="dense">
        <thead><tr><th>Датум</th><th>Орган</th><th>Акт</th><th>Период</th><th>Предмет</th><th>Статус</th><th>Рок</th><th className="n">Утврдено</th><th className="n">Оспорено</th>{owner && <th></th>}</tr></thead>
        <tbody>{K.map((x) => {
          const S = kontrolaSummary(FA.filter((f) => f.kontrolaId === x.id).map(toFinding));
          const [d] = deadlinesOf(x, td);
          return (
            <tr key={x.id}>
              <td><Link href={`/kontroli?id=${x.id}`}>{dmy(x.docDate) || '—'}</Link></td>
              <td>{authOf(x)}</td><td>{docOf(x)}{x.docNo ? ` бр. ${x.docNo}` : ''}</td>
              <td>{x.periodFrom || x.periodTo ? `${dmy(x.periodFrom)}–${dmy(x.periodTo)}` : '—'}</td>
              <td>{x.subject}{x.clientVisible && !client ? <span className="pill info"> клиент</span> : null}</td>
              <td>{KONTROLA_STATUS[x.status as keyof typeof KONTROLA_STATUS] ?? x.status}</td>
              <td>{x.filedOn ? <span className="pill good">поднесено {dmy(x.filedOn)}</span> : d ? <span className={`pill ${ST_CLS[d.state]}`}>{d.remedy.name}: {dmy(d.due)}</span> : '—'}</td>
              <td className="n">{den(S.total)}</td><td className="n">{den(S.disputed)}</td>
              {owner && <td><RowAction action={kDelete.bind(null, x.id)} label="🗑" title="Избриши (само сопственикот)" confirm="Да се избрише контролата со сите наоди и мерки? (записот останува во дневникот на активности)" className="btn sm ghost" /></td>}
            </tr>
          );
        })}</tbody>
      </table> : <div className="empty">Нема евидентирани контроли.</div>}</div>
      {edit && <ActionForm action={kSave}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>+ Нова контрола / акт</h2>
        <HeaderFields />
        <UploadField firmId={firm.id} label="📎 Скенираниот акт" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,.docx,.txt" />
        <div className="mini">Прикачениот акт (PDF, слика, Word) се чита автоматски по зачувувањето – наодите се додаваат во предметот за проверка.</div>
        <button className="btn pri" style={{ marginTop: 6 }}>Зачувај и отвори</button>
      </ActionForm>}
    </>
  );
}

async function Detail({ k, firm, edit, client, canDel, td }: { k: Kontrola; firm: Firm; edit: boolean; client: boolean; canDel: boolean; td: string }) {
  const [F, A, FL] = await Promise.all([
    db().select().from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, k.id)).orderBy(asc(kontrolaFindings.no)),
    db().select().from(kontrolaActions).where(eq(kontrolaActions.kontrolaId, k.id)).orderBy(asc(kontrolaActions.due)),
    filesOf(KONTROLA_FILE_ENTITY, [k.id]),
  ]);
  const reads = edit ? await pendingKontrolaReads(k) : [];
  const readable = (FL.get(k.id) ?? []).filter(isKontrolaReadable);
  const remedy = (k.data as { remedy?: { n: number; unit: string } }).remedy;
  const S = kontrolaSummary(F.map(toFinding));
  const D = deadlinesOf(k, td);
  // the office's documents (external submission + internal analysis) — never built for a client (portal)
  const docs = client ? null : await kontrolaCaseDocs(firm.id, k.id);
  const EV: (FindingEvidence | undefined)[] = docs ? F.map((f) => docs.c.ev[docs.c.F.findIndex((x) => x.id === f.id)]) : [];
  const texts = client ? {} : kontrolaTexts(k);
  const versions = client ? [] : versionsOf(k.data);
  const aiSt = client ? null : kontrolaAiState(k);
  const disputedN = F.filter((f) => isDisputed(toFinding(f))).length;
  const ch = docs?.external.choice;
  const staff = client ? [] : await db().selectDistinct({ id: users.id, name: users.name }).from(users).leftJoin(userFirms, eq(userFirms.userId, users.id))
    .where(and(eq(users.active, true), sql`${users.role} not in ('klient','teren')`, or(eq(users.allFirms, true), eq(users.role, 'admin'), eq(userFirms.firmId, firm.id)))).orderBy(asc(users.name));
  const trail = client ? [] : await db().select({ at: auditLog.at, action: auditLog.action, user: users.name, data: auditLog.data }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.firmId, firm.id), or(eq(auditLog.entityId, k.id), sql`${auditLog.data}->>'kontrolaId' = ${k.id}`))).orderBy(desc(auditLog.at)).limit(100);
  const title = `${docOf(k)}${k.docNo ? ` бр. ${k.docNo}` : ''} – ${authOf(k)}`;

  return (
    <>
      <Hd t={`📑 ${title}`} sub={`${firm.name} · ${k.subject ?? ''}`} exp={false}>
        <Link className="btn" href="/kontroli">← Сите контроли</Link>
        {!client && <a className="btn" href={`/kontroli/word?id=${k.id}&doc=analiza`}>⬇ Анализа (Word)</a>}
        {canDel && <RowAction action={kDelete.bind(null, k.id)} label="🗑 Избриши" title="Избриши (само сопственикот)" confirm="Да се избрише контролата со сите наоди и мерки? (записот останува во дневникот на активности)" className="btn sm ghost" />}
      </Hd>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '0 0 10px', alignItems: 'stretch' }}>
        {([['Утврдено вкупно', den(S.total), ''], ['Камата', den(S.interest), ''], ['Глоба', den(S.fine), ''], ['Според книгите (пресметани наоди)', `${den(S.ours)} / ${den(S.claimedRecalc)}`, ''], ['Оспорено', den(S.disputed), S.disputed ? 'warn' : ''], ['Препорака', RECOMMEND_LBL[S.overall], REC_CLS[S.overall]]] as const).map(([l, v, c]) => (
          <div key={l} className={`card ${c}`} style={{ flex: 1, minWidth: 150, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{l}</div><div style={{ fontSize: 17, fontWeight: 700 }}>{v}</div></div>
        ))}
      </div>

      {ch && disputedN > 0 && !k.filedOn && <div className={`callout ${ch.daysLeft != null && ch.daysLeft <= 3 ? 'bad' : 'warn'}`} id="kPrep" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22, fontWeight: 800, whiteSpace: 'nowrap' }}>⏰ {ch.daysLeft == null ? '—' : ch.daysLeft < 0 ? 'истечен' : `${ch.daysLeft} ${ch.daysLeft === 1 ? 'ден' : 'дена'}`}</span>
        <span style={{ flex: 1, minWidth: 240 }}>
          🧾 <b>{disputedN} {disputedN === 1 ? 'оспорен наод' : 'оспорени наоди'}</b> – програмата подготвува: <b>{SUBMISSION_LBL[ch.type]}</b> до {ch.to}
          {ch.deadline ? <> · рок <b>{dmy(ch.deadline)}</b> ({daysLeftText(ch.daysLeft)})</> : <> · {daysLeftText(null)}</>}
          {ch.verify && <span className="pill info" title="Правното средство, органот и рокот – проверете ги во правната поука на актот"> за проверка</span>}
          <div className="mini">{ch.reason}</div>
        </span>
        {edit && <RowAction action={kPrepare.bind(null, k.id)} label={`🧾 Подготви ${SUBMISSION_LBL[ch.type].toLowerCase()}`} className="btn pri" showOk />}
        <a className="btn" href="#kDocs">↓ Документи</a>
      </div>}

      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>⏰ Рокови за правна заштита</h2>
        <p style={{ margin: '0 0 6px' }}>Акт од {dmy(k.docDate) || '—'}, примен {dmy(k.delivered) || '— (внесете датум на прием)'} · период {dmy(k.periodFrom) || '—'}–{dmy(k.periodTo) || '—'} {k.filedOn && <span className="pill good">поднесено {dmy(k.filedOn)}</span>}</p>
        {D.length ? <table className="dense"><thead><tr><th>Правно средство</th><th>Рок</th><th>До</th><th>Одлага плаќање / извршување?</th><th>Основ</th></tr></thead>
          <tbody>{D.map((d, i) => (
            <tr key={i}><td><b>{d.remedy.name}</b>{d.remedy.note ? <div className="mini">{d.remedy.note}</div> : null}</td>
              <td style={{ whiteSpace: 'nowrap' }}><b>{dmy(d.due)}</b> {!k.filedOn && <span className={`pill ${ST_CLS[d.state]}`}>{ST_LBL[d.state]}</span>}{d.override ? <div className="mini">од правната поука</div> : <div className="mini">{d.remedy.n} {d.remedy.unit === 'workdays' ? 'работни дена' : d.remedy.unit === 'months' ? 'месеци' : 'дена'} од приемот</div>}</td>
              <td className="mini">{d.remedy.to}</td>
              <td>{d.remedy.suspends ? 'Да' : <b>Не – платете / постапете во рокот од актот</b>}</td>
              <td className="mini">{d.remedy.law}{d.remedy.confirm ? <span className="pill info" title="Читање на програмата – проверете ја правната поука на актот"> провери ја правната поука</span> : null}</td></tr>
          ))}</tbody></table> : <div className="callout warn">Внесете го датумот на прием на актот за да се пресмета рокот{remedy ? ` (правна поука: ${remedy.n} ${remedy.unit === 'workdays' ? 'работни ' : ''}дена од приемот)` : ''}.</div>}
        <div style={{ marginTop: 6 }}><FileChips files={FL.get(k.id)} /></div>
      </div>

      {edit && <details className="card"><summary><b>✎ Податоци за актот</b></summary>
        <ActionForm action={kSave} reset={false} className="">
          <input type="hidden" name="id" value={k.id} />
          <HeaderFields k={k} />
          <UploadField firmId={firm.id} label="📎 Додај документ" />
          <button className="btn pri" style={{ marginTop: 6 }}>Зачувај</button>
        </ActionForm>
      </details>}

      {edit && <div className="card">
        <KontrolaAi firmId={firm.id} kid={k.id} initial={reads} />
        {readable.length > 0 && <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {readable.map((f) => <RowAction key={f.id} action={kReadFile.bind(null, k.id, f.id)} label={readable.length > 1 ? `↻ Прочитај „${f.name}“` : '↻ Прочитај го прикачениот акт'} title={f.name} className="btn sm" />)}
          <span className="mini">Наодите се додаваат на постоечките – при повторно читање избришете ги старите.</span>
        </div>}
      </div>}

      <h2 style={{ fontSize: 16, margin: '12px 0 6px' }}>Наоди ({F.length})</h2>
      {F.map((f, i) => <FindingCard key={f.id} f={f} k={k} ev={EV[i]} edit={edit} client={client} />)}
      {!F.length && <div className="card empty">Нема наоди. {edit ? 'Прикачете го актот горе или внесете ги рачно.' : ''}</div>}
      {edit && <div id="rachen-vnes"><ActionForm action={kFinding.bind(null, k.id)}>
        <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>+ Нов наод (рачно)</h3>
        <FindingFields />
        <button className="btn sm pri" style={{ marginTop: 6 }}>Додај наод</button>
      </ActionForm></div>}

      {docs && (disputedN > 0 || texts.draft || versions.length > 0) && <CaseDocs k={k} ext={docs.external} int={docs.internal} texts={texts} versions={versions} ai={aiSt} edit={edit} />}

      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>🛠 Корективни мерки</h2>
        {A.length ? <table className="dense"><thead><tr><th>Мерка</th><th>Наод</th><th>Одговорен</th><th>Рок</th><th>Статус</th><th /></tr></thead>
          <tbody>{A.map((a) => {
            const late = !a.doneOn && a.due && a.due < td;
            return (
              <tr key={a.id}><td>{a.text}{a.note ? <div className="mini">{a.note}</div> : null}</td><td>{F.find((f) => f.id === a.findingId)?.no ?? '—'}</td><td>{a.ownerName ?? '—'}</td>
                <td style={late ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(a.due) || '—'}</td>
                <td>{a.doneOn ? <span className="pill good">✓ {dmy(a.doneOn)}</span> : late ? <span className="pill bad">задоцнета</span> : <span className="pill warn">отворена</span>}</td>
                <td>{edit && <RowAction action={kActionDone.bind(null, a.id, !a.doneOn)} label={a.doneOn ? '↺' : '✓ Извршено'} />}</td></tr>
            );
          })}</tbody></table> : <div className="empty">Нема мерки.</div>}
        {edit && <ActionForm action={kAction.bind(null, k.id)} className="" style={{ marginTop: 8 }}>
          <div className="form">
            <label className="f wide">Мерка<input name="text" required placeholder="пр. Исправка на ДДВ-04 за 03/2026; нов акт за благајнички максимум" /></label>
            <label className="f">Наод<select name="findingId" defaultValue=""><option value="">—</option>{F.map((f) => <option key={f.id} value={f.id}>{f.no}. {f.text.slice(0, 40)}</option>)}</select></label>
            <label className="f">Одговорен<select name="ownerId" defaultValue=""><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="f">или (клиент / друг)<input name="ownerName" /></label>
            <label className="f">Рок<input name="due" type="date" /></label>
            <label className="f wide">Белешка<input name="note" /></label>
          </div>
          <button className="btn sm" style={{ marginTop: 6 }}>+ Додај мерка</button>
        </ActionForm>}
      </div>

      {!client && <details className="card"><summary><b>🧾 Дневник на предметот</b> ({trail.length})</summary>
        <table className="dense"><tbody>{trail.map((t, i) => <tr key={i}><td className="num">{dmyHm(t.at)}</td><td>{t.user ?? '—'}</td><td>{t.action}</td><td className="mini">{t.data ? JSON.stringify(t.data) : ''}</td></tr>)}</tbody></table>
      </details>}
    </>
  );
}

function FindingFields({ f }: { f?: KontrolaFinding }) {
  const yn = (v: boolean | null | undefined) => (v == null ? '' : v ? 'yes' : 'no');
  return (
    <div className="form">
      <label className="f">Подрачје<select name="area" defaultValue={f?.area ?? 'vat'}>{Object.entries(FINDING_AREA).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      <label className="f wide">Наод (како во актот)<textarea name="text" rows={2} required defaultValue={f?.text ?? ''} style={{ width: '100%', font: 'inherit' }} /></label>
      <label className="f">Член што го наведува органот<input name="article" defaultValue={f?.article ?? ''} placeholder="пр. чл. 34 ЗДДВ" /></label>
      <label className="f">Утврден данок / придонес<input name="claimed" inputMode="decimal" defaultValue={f?.claimed ?? ''} /></label>
      <label className="f">Камата<input name="interest" inputMode="decimal" defaultValue={f?.interest ?? ''} /></label>
      <label className="f">Глоба<input name="fine" inputMode="decimal" defaultValue={f?.fine ?? ''} /></label>
      <label className="f">Конто за доказ (опц.)<input name="account" defaultValue={f?.account ?? ''} placeholder="пр. 4700" /></label>
      <label className="f">Износ според книгите<input name="ours" inputMode="decimal" defaultValue={f?.ours ?? ''} /></label>
      <label className="f">Извор на износот<input name="oursSource" defaultValue={f?.oursSource ?? ''} /></label>
      <label className="f">Оценка<select name="verdict" defaultValue={f?.verdict ?? ''}><option value="">— не е оценето —</option>{Object.entries(VERDICT_LBL).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      <label className="f">Постапено според закон?<select name="officeOk" defaultValue={yn(f?.officeOk)}><option value="">—</option><option value="yes">Да</option><option value="no">Не</option></select></label>
      <label className="f">Грешка во програмата?<select name="systemError" defaultValue={yn(f?.systemError)}><option value="">—</option><option value="no">Не</option><option value="yes">Да</option></select></label>
      <label className="f">Препорака<select name="recommendation" defaultValue={f?.recommendation ?? ''}><option value="">— автоматски —</option>{Object.entries(RECOMMEND_LBL).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      <label className="f wide">Анализа (со членови на кои се повикуваме)<textarea name="analysis" rows={3} defaultValue={f?.analysis ?? ''} style={{ width: '100%', font: 'inherit' }} /></label>
    </div>
  );
}

function FindingCard({ f, k, ev, edit, client }: { f: KontrolaFinding; k: Kontrola; ev?: FindingEvidence; edit: boolean; client: boolean }) {
  const x = toFinding(f);
  const rec = recommendFinding(x);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div><b>{f.no}. {FINDING_AREA[x.area]}</b> – {f.text}{f.article && <div className="mini">Основ на органот: {f.article}</div>}</div>
        <div style={{ textAlign: 'right' }}>
          <div>Утврдено: <b>{den(x.claimed)}</b>{x.interest ? ` + камата ${den(x.interest)}` : ''}{x.fine ? ` + глоба ${den(x.fine)}` : ''}</div>
          {!client && <div>Според книгите: <b>{x.ours == null ? '—' : den(x.ours)}</b>{x.ours != null && x.ours !== x.claimed ? <span className="pill warn"> разлика {den(x.claimed - x.ours)}</span> : null}</div>}
          {!client && <span className={`pill ${REC_CLS[rec]}`}>{RECOMMEND_LBL[rec]}</span>}
        </div>
      </div>
      {!client && <>
        {f.oursSource && <div className="mini">Извор: {f.oursSource}</div>}
        <div className="mini" style={{ marginTop: 4 }}>Оценка: <b>{x.verdict ? VERDICT_LBL[x.verdict] : 'не е оценето'}</b> · постапено според закон: <b>{f.officeOk == null ? '—' : f.officeOk ? 'да' : 'не'}</b> · грешка во програмата: <b>{f.systemError == null ? '—' : f.systemError ? 'да' : 'не'}</b></div>
        {f.analysis && <p style={{ margin: '4px 0' }}>{f.analysis}</p>}
        {ev && <div style={{ marginTop: 6, padding: 6, background: 'var(--bg2, #f6f7f9)', borderRadius: 6 }}>
          <div className="mini"><b>Докази од програмата</b> ({dmy(k.periodFrom) || 'почеток на годината'}–{dmy(k.periodTo) || 'крај'}):</div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', margin: '4px 0' }}>{ev.links.map((l) => <Link key={l.href} className="btn sm ghost" href={l.href} target="_blank">{l.label} ↗</Link>)}</div>
          {ev.recalc && <div className="mini">Пресметка од книгите: <b>{den(ev.recalc.cents)}</b> – {ev.recalc.source}</div>}
          {ev.checks.map((c, i) => <div key={i} className="mini"><span className={`pill ${c.s === 'ok' ? 'good' : c.s}`}>{c.s === 'ok' ? '✓' : c.s === 'warn' ? '⚠' : '✗'}</span> Проверка на програмата: {c.txt}</div>)}
          {ev.refs.length > 0 && <div className="mini">Документи (докази): {ev.refs.join('; ')}</div>}
          <div className="mini">Дневник (кој / кога): {ev.audit.n ? `${ev.audit.n} промени · ${ev.audit.users.map((u) => `${u.name} (${u.n})`).join(', ')} · од ${dmy(ev.audit.first?.slice(0, 10))} до ${dmy(ev.audit.last?.slice(0, 10))}` : 'нема промени во програмата во периодот'}</div>
        </div>}
        {edit && <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {([['object', '⚖ Оспори'], ['partial', '½ Делумно'], ['accept', '✓ Прифати']] as const).map(([r, l]) => (
            <RowAction key={r} action={kMark.bind(null, k.id, f.id, f.recommendation === r ? null : r)} label={l} title={f.recommendation === r ? 'Означено – клик за автоматска препорака' : `Означи: ${RECOMMEND_LBL[r]}`}
              className={`btn sm ${f.recommendation === r ? 'pri' : 'ghost'}`} />
          ))}
          {ev?.recalc && <RowAction action={kRecalc.bind(null, k.id, f.id)} label="⇩ Земи износ од книгите" className="btn sm" showOk />}
          <RowAction action={kFindingDelete.bind(null, k.id, f.id)} label="🗑" confirm="Да се избрише наодот?" />
        </div>}
        {edit && <details style={{ marginTop: 6 }}><summary>✎ Анализа и оценка</summary>
          <ActionForm action={kFinding.bind(null, k.id)} reset={false} className="">
            <input type="hidden" name="fid" value={f.id} />
            <input type="hidden" name="no" value={f.no} />
            <FindingFields f={f} />
            <button className="btn sm pri" style={{ marginTop: 6 }}>Зачувај</button>
          </ActionForm>
        </details>}
      </>}
    </div>
  );
}
