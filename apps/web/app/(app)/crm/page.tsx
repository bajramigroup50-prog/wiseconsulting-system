/**
 * 🤝 CRM – the office's own sales (new clients and offers): leads with source, activity, employees and estimated fee,
 * the pipeline Нов → Контакт → Понуда → Преговори → Добиен / Изгубен as a kanban and a list, notes and the next step
 * with a date (reminders on the owner's home dashboard, `home.tsx`), offers („Понуда за сметководствени услуги“ in the
 * office style, print / PDF `/crm/ponuda`), „Конвертирај во клиент“ (the new-firm form of `/firmi`, prefilled) and
 * the report (by stage and source, win rate). Leads from the public website's form arrive by themselves (`/api/crm/lead`).
 * Office OWNER only (like the contracts `kdogovori`).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { CRM_NOTE_KINDS, CRM_OPEN, CRM_SOURCES, CRM_STAGES, crmOfferNew, crmSourceName, crmStageName, crmStats, isCrmSource, isCrmStage, type CrmOffer } from '@wise/core/firms/crm';
import { KD_SVC } from '@wise/core/firms/kdog';
import { wordsMatch } from '@wise/core/firms/picker';
import { crmLeads, crmNotes, crmOffers, firms, users, type CrmLead } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { isUuid, today } from '@/lib/office';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { DownloadCsv } from '@/components/download-csv';
import { loadProvider } from '../kdogovori/lib';
import { addNote, deleteLead, deleteNote, deleteOffer, doneNext, moveStageForm, saveLead, saveOffer, setOfferStatus } from './actions';
import { Kanban } from './kanban';
import { crmUser, offerHtml, rowToOffer } from './lib';

const T = '🤝 CRM – нови клиенти и понуди';
type Sp = { v?: string; id?: string; ed?: string; ponuda?: string; q?: string; st?: string; src?: string };
const OF_ST: Record<string, [string, string]> = { draft: ['нацрт', 'info'], sent: ['испратена', 'warn'], accepted: ['прифатена', 'good'], declined: ['одбиена', 'bad'] };
const stageColor = (s: string) => CRM_STAGES.find(([k]) => k === s)?.[2] ?? '#64748b';
const StagePill = ({ s }: { s: string }) => <span className="pill" style={{ background: stageColor(s), color: '#fff' }}>{crmStageName(s)}</span>;

export default async function CrmPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const u = await crmUser();
  if (!u) {
    const u0 = await requireUser();
    if (u0.role === 'klient' || u0.role === 'teren') notFound();
    return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  }
  const sp = await searchParams;
  const td = today();
  const view = sp.v === 'lista' || sp.v === 'izv' ? sp.v : 'kanban';
  const tabs = (
    <div className="ftabs noprint" style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {([['kanban', '🗂 Фази (канбан)'], ['lista', '📋 Листа'], ['izv', '📊 Извештај']] as const).map(([k, n]) =>
        <Link key={k} className={`btn sm${!sp.id && !sp.ed && view === k ? ' pri' : ''}`} href={`/crm?v=${k}`}>{n}</Link>)}
      <Link className="btn sm" href="/crm?ed=new" style={{ marginLeft: 'auto' }}>+ Нов потенцијален клиент</Link>
    </div>
  );

  /* ---------- lead form (new / edit) ---------- */
  if (sp.ed) {
    const [l] = isUuid(sp.ed) ? await db().select().from(crmLeads).where(eq(crmLeads.id, sp.ed)).limit(1) : [];
    if (sp.ed !== 'new' && !l) notFound();
    return <><Hd t={T} exp={false} />{tabs}<LeadForm l={l ?? null} /></>;
  }

  /* ---------- lead card ---------- */
  if (sp.id) {
    if (!isUuid(sp.id)) notFound();
    const [l] = await db().select().from(crmLeads).where(eq(crmLeads.id, sp.id)).limit(1);
    if (!l) notFound();
    const [N, OF, firm] = await Promise.all([
      db().select({ n: crmNotes, by: users.name }).from(crmNotes).leftJoin(users, eq(users.id, crmNotes.createdBy)).where(eq(crmNotes.leadId, l.id)).orderBy(desc(crmNotes.createdAt)),
      db().select().from(crmOffers).where(eq(crmOffers.leadId, l.id)).orderBy(desc(crmOffers.createdAt)),
      l.firmId ? db().select({ id: firms.id, name: firms.name }).from(firms).where(eq(firms.id, l.firmId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
    ]);
    const { O } = await loadProvider(u);
    let editor: React.ReactNode = null;
    if (sp.ponuda) {
      const row = isUuid(sp.ponuda) ? OF.find((o) => o.id === sp.ponuda) : undefined;
      if (sp.ponuda !== 'new' && !row) notFound();
      const p: CrmOffer = row ? rowToOffer(row) : crmOfferNew(O, l, td);
      editor = <OfferEditor l={l} p={p} id={row?.id ?? null} html={row ? await offerHtml(u, p, l) : null} status={row?.status ?? 'draft'} />;
    }
    const open = (CRM_OPEN as readonly string[]).includes(l.stage);
    return (
      <>
        <Hd t={T} exp={false} />{tabs}
        <div className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{l.company}</h2><StagePill s={l.stage} />
            {firm && <Link className="pill good" href={`/firmi?edit=${firm.id}`}>✓ Клиент: {firm.name}</Link>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Link className="btn sm" href={`/crm?ed=${l.id}`}>✎ Измени</Link>
              {!l.firmId && <Link className="btn sm pri" href={`/firmi?nova&crm=${l.id}`} title="Ја отвора формата „Нова фирма“ пополнета со податоците – по зачувувањето записот е „Добиен“">➜ Конвертирај во клиент</Link>}
              <RowAction action={deleteLead.bind(null, l.id)} label="🗑" title="Избриши" confirm={`Да се избрише „${l.company}“ со белешките и понудите?`} />
            </span>
          </div>
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '4px 18px', marginTop: 10, fontSize: 14 }}>
            <div><span className="muted">Контакт:</span> {l.contact || '—'}</div>
            <div><span className="muted">Телефон:</span> {l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : '—'}</div>
            <div><span className="muted">Е-пошта:</span> {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '—'}</div>
            <div><span className="muted">ЕДБ:</span> {l.edb || '—'}</div>
            <div><span className="muted">Извор:</span> {crmSourceName(l.source)}{l.sourceNote ? ` – ${l.sourceNote}` : ''}</div>
            <div><span className="muted">Дејност:</span> {l.activity || '—'}</div>
            <div><span className="muted">Вработени:</span> {l.employees ?? '—'}</div>
            <div><span className="muted">Проценет надоместок:</span> {Number(l.fee) ? `${fmt(l.fee)} ден./мес.` : '—'}</div>
            {(l.address || l.city) && <div><span className="muted">Адреса:</span> {[l.address, l.city].filter(Boolean).join(', ')}</div>}
            <div><span className="muted">Внесено:</span> {dmyHm(l.createdAt)}</div>
            {l.stage === 'izguben' && l.lostReason && <div><span className="muted">Причина:</span> {l.lostReason}</div>}
          </div>
          {l.note && <p style={{ whiteSpace: 'pre-line', marginBottom: 0 }}>{l.note}</p>}
          {typeof (l.data as { message?: string }).message === 'string' && <div className="callout" style={{ marginTop: 8 }}>🌐 Порака од веб-формата: <i style={{ whiteSpace: 'pre-line' }}>{(l.data as { message: string }).message}</i></div>}
          <ActionForm action={moveStageForm} reset={false} className="row" style={{ marginTop: 10, gap: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="hidden" name="id" value={l.id} />
            <span className="muted">Фаза:</span>
            {CRM_STAGES.map(([k, n, c]) => <Submit key={k} name="stage" value={k} className={`btn sm${k === l.stage ? ' pri' : ' ghost'}`}><span style={{ color: k === l.stage ? undefined : c }}>{n}</span></Submit>)}
            <input name="reason" placeholder="причина (за Изгубен)" style={{ maxWidth: 220 }} defaultValue={l.lostReason ?? ''} />
          </ActionForm>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>⏰ Следен чекор</h3>
            {l.nextStep || l.nextDate ? (
              <p style={{ color: l.nextDate && l.nextDate <= td ? '#b42318' : undefined }}><b>{dmy(l.nextDate)}</b> {l.nextStep}{' '}
                <RowAction action={doneNext.bind(null, l.id)} label="✓ Завршено" className="btn sm" /></p>
            ) : <p className="muted">{open ? 'Нема закажан следен чекор.' : 'Затворено.'}</p>}
            <ActionForm action={addNote} className="">
              <input type="hidden" name="id" value={l.id} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select name="kind" defaultValue="call" style={{ width: 'auto' }}>{CRM_NOTE_KINDS.filter(([k]) => k !== 'stage').map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                <textarea name="text" rows={2} placeholder="Што е договорено / разговарано…" style={{ flex: 1, minWidth: 200 }} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                <span className="muted">Следен чекор:</span>
                <input name="nextStep" placeholder="на пр. Јави се за одговор на понудата" style={{ flex: 1, minWidth: 180 }} />
                <input name="nextDate" type="date" style={{ width: 'auto' }} />
                <Submit>Зачувај</Submit>
              </div>
            </ActionForm>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
              {N.map(({ n, by }) => (
                <li key={n.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0', fontSize: 14 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{dmyHm(n.createdAt)} · {CRM_NOTE_KINDS.find(([k]) => k === n.kind)?.[1] ?? n.kind}{by ? ` · ${by}` : ''}</span>
                  {n.kind !== 'stage' && <RowAction action={deleteNote.bind(null, n.id, l.id)} label="×" title="Избриши белешка" confirm="Да се избрише белешката?" className="btn sm ghost" style={{ float: 'right', padding: '0 6px' }} />}
                  <div style={{ whiteSpace: 'pre-line' }}>{n.text}</div>
                </li>
              ))}
              {!N.length && <li className="muted">Нема белешки.</li>}
            </ul>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>📄 Понуди <Link className="btn sm pri" href={`/crm?id=${l.id}&ponuda=new#ponuda`} style={{ float: 'right' }}>+ Нова понуда</Link></h3>
            <table className="tbl"><thead><tr><th>Број</th><th>Датум</th><th>Важи до</th><th style={{ textAlign: 'right' }}>Месечно</th><th>Статус</th><th /></tr></thead><tbody>
              {OF.map((o) => {
                const p = rowToOffer(o);
                const [sn, sc] = OF_ST[o.status] ?? [o.status, 'info'];
                return (
                  <tr key={o.id}>
                    <td><Link href={`/crm?id=${l.id}&ponuda=${o.id}#ponuda`}>{o.number}</Link></td><td>{dmy(o.date)}</td><td>{dmy(o.validUntil)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(p.fee) ? fmt(p.fee) : '—'}</td><td><span className={`pill ${sc}`}>{sn}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <a className="btn sm" href={`/crm/ponuda?id=${o.id}`} target="_blank" rel="noopener">🖨 PDF</a>
                      {o.status !== 'sent' && <RowAction action={setOfferStatus.bind(null, o.id, 'sent')} label="✉" title="Означи како испратена" />}
                      {o.status !== 'accepted' && <RowAction action={setOfferStatus.bind(null, o.id, 'accepted')} label="✓" title="Прифатена" />}
                      {o.status !== 'declined' && <RowAction action={setOfferStatus.bind(null, o.id, 'declined')} label="✗" title="Одбиена" />}
                      <RowAction action={deleteOffer.bind(null, o.id)} label="🗑" title="Избриши" confirm={`Да се избрише понудата ${o.number}?`} />
                    </td>
                  </tr>
                );
              })}
              {!OF.length && <tr><td colSpan={6} className="muted">Нема понуди.</td></tr>}
            </tbody></table>
          </div>
        </div>
        {editor}
      </>
    );
  }

  /* ---------- kanban / list / report ---------- */
  const L = await db().select().from(crmLeads).orderBy(desc(crmLeads.updatedAt));
  const due = L.filter((l) => l.nextDate && l.nextDate <= td && (CRM_OPEN as readonly string[]).includes(l.stage));
  const dueBox = due.length > 0 && (
    <div className="callout warn">⏰ <b>Следни чекори до денес ({due.length}):</b>{' '}
      {due.sort((a, b) => (a.nextDate! < b.nextDate! ? -1 : 1)).map((l) => <Link key={l.id} className="btn sm" style={{ margin: '2px 4px 2px 0' }} href={`/crm?id=${l.id}`}>{dmy(l.nextDate)} · {l.company}{l.nextStep ? ` – ${l.nextStep}` : ''}</Link>)}
    </div>
  );
  const S = crmStats(L);
  const sub = `${S.open} отворени · ${S.won} добиени · ${S.lost} изгубени${S.winRate != null ? ` · успешност ${S.winRate}%` : ''}`;

  if (view === 'kanban') {
    const cards = L.filter((l) => !l.closedAt || l.stage !== 'izguben' || Date.now() - l.closedAt.getTime() < 90 * 864e5)
      .map((l) => ({ id: l.id, company: l.company, contact: l.contact, stage: l.stage, fee: Number(l.fee) || 0, source: l.source, nextDate: l.nextDate, nextStep: l.nextStep, firmId: l.firmId }));
    return (
      <>
        <Hd t={T} sub={sub} exp={false} />{tabs}{dueBox}
        {L.length ? <Kanban cards={cards} today={td} /> : <Empty />}
        <p className="note">Повлечете картичка во друга колона (или ‹ ›) за да ја смените фазата. Изгубените постари од 90 дена се само во Листа.</p>
      </>
    );
  }

  if (view === 'izv') {
    const months = [...new Set(L.map((l) => l.createdAt.toISOString().slice(0, 7)))].sort().reverse().slice(0, 12);
    return (
      <>
        <Hd t={T} sub={sub} />{tabs}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          {[['Вкупно', String(S.total)], ['Отворени', String(S.open)], ['Добиени', String(S.won)], ['Изгубени', String(S.lost)], ['Успешност', S.winRate != null ? `${S.winRate}%` : '—'],
            ['Отворени (мес.)', `${fmt(S.pipelineFee)} ден.`], ['Добиени (мес.)', `${fmt(S.wonFee)} ден.`]].map(([a, b]) => (
            <div key={a} className="card" style={{ margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{a}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{b}</div></div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginTop: 12 }}>
          <div className="card"><h3 style={{ marginTop: 0 }}>По фаза</h3>
            <table className="tbl"><thead><tr><th>Фаза</th><th style={{ textAlign: 'right' }}>Број</th><th style={{ textAlign: 'right' }}>Месечно (ден.)</th><th style={{ width: '40%' }} /></tr></thead><tbody>
              {S.byStage.map((s) => <tr key={s.stage}><td><StagePill s={s.stage} /></td><td style={{ textAlign: 'right' }}>{s.n}</td><td style={{ textAlign: 'right' }}>{fmt(s.fee)}</td>
                <td><div style={{ height: 10, borderRadius: 5, background: stageColor(s.stage), width: `${S.total ? Math.max(2, (s.n / S.total) * 100) : 0}%` }} /></td></tr>)}
            </tbody></table></div>
          <div className="card"><h3 style={{ marginTop: 0 }}>По извор</h3>
            <table className="tbl"><thead><tr><th>Извор</th><th style={{ textAlign: 'right' }}>Број</th><th style={{ textAlign: 'right' }}>Добиени</th><th style={{ textAlign: 'right' }}>Изгубени</th><th style={{ textAlign: 'right' }}>Успешност</th></tr></thead><tbody>
              {S.bySource.map((s) => <tr key={s.source}><td>{s.name}</td><td style={{ textAlign: 'right' }}>{s.n}</td><td style={{ textAlign: 'right' }}>{s.won}</td><td style={{ textAlign: 'right' }}>{s.lost}</td><td style={{ textAlign: 'right' }}>{s.winRate != null ? `${s.winRate}%` : '—'}</td></tr>)}
            </tbody></table>
            <p className="note">Успешност = добиени / (добиени + изгубени); отворените не се бројат.</p></div>
          <div className="card"><h3 style={{ marginTop: 0 }}>По месец (внесени)</h3>
            <table className="tbl"><thead><tr><th>Месец</th><th style={{ textAlign: 'right' }}>Нови</th><th style={{ textAlign: 'right' }}>Добиени</th><th style={{ textAlign: 'right' }}>Изгубени</th></tr></thead><tbody>
              {months.map((m) => { const X = L.filter((l) => l.createdAt.toISOString().startsWith(m)); return <tr key={m}><td>{m.split('-').reverse().join('.')}</td><td style={{ textAlign: 'right' }}>{X.length}</td><td style={{ textAlign: 'right' }}>{X.filter((l) => l.stage === 'dobien').length}</td><td style={{ textAlign: 'right' }}>{X.filter((l) => l.stage === 'izguben').length}</td></tr>; })}
              {!months.length && <tr><td colSpan={4} className="muted">Нема податоци.</td></tr>}
            </tbody></table></div>
        </div>
      </>
    );
  }

  // list
  const q = (sp.q ?? '').trim();
  const R = L.filter((l) => (!isCrmStage(sp.st) || l.stage === sp.st) && (!isCrmSource(sp.src) || l.source === sp.src)
    && (!q || wordsMatch([[l.company, l.contact, l.edb, l.email, l.phone, l.activity, l.city].filter(Boolean).join(' ')], q)));
  return (
    <>
      <Hd t={T} sub={sub} excel={false}>
        <DownloadCsv name="crm.csv" rows={[['Фирма', 'ЕДБ', 'Контакт', 'Телефон', 'Е-пошта', 'Извор', 'Дејност', 'Вработени', 'Месечно', 'Фаза', 'Следен чекор', 'Датум', 'Внесено'],
          ...R.map((l) => [l.company, l.edb, l.contact, l.phone, l.email, crmSourceName(l.source), l.activity, l.employees, Number(l.fee) || null, crmStageName(l.stage), l.nextStep, dmy(l.nextDate), dmy(l.createdAt.toISOString())])]} />
      </Hd>
      {tabs}{dueBox}
      <form className="card noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="hidden" name="v" value="lista" />
        <input name="q" defaultValue={q} placeholder="Барај фирма, контакт, ЕДБ…" style={{ flex: 1, minWidth: 200 }} />
        <select name="st" defaultValue={sp.st ?? ''} style={{ width: 'auto' }}><option value="">Сите фази</option>{CRM_STAGES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <select name="src" defaultValue={sp.src ?? ''} style={{ width: 'auto' }}><option value="">Сите извори</option>{CRM_SOURCES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <button className="btn">Филтрирај</button>
      </form>
      {L.length ? (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl"><thead><tr><th>Фирма</th><th>Контакт</th><th>Извор</th><th style={{ textAlign: 'right' }}>Вработени</th><th style={{ textAlign: 'right' }}>Месечно</th><th>Фаза</th><th>Следен чекор</th><th>Внесено</th></tr></thead><tbody>
            {R.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/crm?id=${l.id}`}><b>{l.company}</b></Link>{l.firmId && <span className="pill good" style={{ marginLeft: 4 }}>клиент</span>}</td>
                <td>{l.contact}{l.phone ? <div className="muted" style={{ fontSize: 12 }}>{l.phone}</div> : null}</td>
                <td>{crmSourceName(l.source)}</td><td style={{ textAlign: 'right' }}>{l.employees ?? ''}</td><td style={{ textAlign: 'right' }}>{Number(l.fee) ? fmt(l.fee) : ''}</td>
                <td><StagePill s={l.stage} /></td>
                <td style={{ color: l.nextDate && l.nextDate <= td && (CRM_OPEN as readonly string[]).includes(l.stage) ? '#b42318' : undefined }}>{dmy(l.nextDate)} {l.nextStep}</td>
                <td>{dmy(l.createdAt.toISOString())}</td>
              </tr>
            ))}
            {!R.length && <tr><td colSpan={8} className="muted">Нема записи за овој филтер.</td></tr>}
          </tbody></table>
        </div>
      ) : <Empty />}
    </>
  );
}

function Empty() {
  return <div className="card empty">Сè уште нема потенцијални клиенти. <Link href="/crm?ed=new">+ Внесете го првиот</Link> – барањата од веб-формата на wiseconsulting.com.mk доаѓаат тука сами.</div>;
}

function LeadForm({ l }: { l: CrmLead | null }) {
  const I = ({ k, t, type, ph, w }: { k: keyof CrmLead; t: string; type?: string; ph?: string; w?: number }) => (
    <label className="f" style={{ flex: `1 1 ${w ?? 220}px` }}><span>{t}</span><input name={k} type={type} placeholder={ph} defaultValue={l?.[k] == null ? '' : String(l[k])} /></label>
  );
  return (
    <ActionForm action={saveLead} reset={false}>
      <h3 style={{ marginTop: 0 }}>{l ? `✎ ${l.company}` : '+ Нов потенцијален клиент'}</h3>
      {l && <input type="hidden" name="id" value={l.id} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
        <I k="company" t="Фирма *" w={320} /><I k="edb" t="ЕДБ" ph="13 цифри" /><I k="contact" t="Лице за контакт" /><I k="phone" t="Телефон" type="tel" /><I k="email" t="Е-пошта" type="email" />
        <I k="address" t="Адреса" /><I k="city" t="Град" ph="Скопје" />
        <label className="f" style={{ flex: '1 1 160px' }}><span>Извор</span><select name="source" defaultValue={l?.source ?? 'telefon'}>{CRM_SOURCES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <I k="sourceNote" t="Препорачал / кампања" />
        <I k="activity" t="Дејност" ph="трговија, градежништво, угостителство…" w={260} /><I k="employees" t="Број на вработени" type="number" w={140} /><I k="fee" t="Проценет месечен надоместок (ден., без ДДВ)" type="number" w={220} />
        {!l && <label className="f" style={{ flex: '1 1 160px' }}><span>Фаза</span><select name="stage" defaultValue="nov">{CRM_STAGES.slice(0, 4).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}
        <I k="nextStep" t="Следен чекор" ph="на пр. Испрати понуда" w={300} /><I k="nextDate" t="Датум" type="date" w={150} />
      </div>
      <label className="f"><span>Белешка</span><textarea name="note" rows={3} defaultValue={l?.note ?? ''} /></label>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><Submit>Зачувај</Submit><Link className="btn" href={l ? `/crm?id=${l.id}` : '/crm'}>Откажи</Link></div>
    </ActionForm>
  );
}

function OfferEditor({ l, p, id, html, status }: { l: CrmLead; p: CrmOffer; id: string | null; html: string | null; status: string }) {
  const N = ({ k, t, w }: { k: keyof CrmOffer; t: string; w?: number }) => (
    <label className="f" style={{ flex: `1 1 ${w ?? 150}px` }}><span>{t}</span><input name={k} type="number" step="any" defaultValue={String(p[k] ?? '')} /></label>
  );
  return (
    <div id="ponuda" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
      <ActionForm action={saveOffer} reset={false}>
        <h3 style={{ marginTop: 0 }}>{id ? `✎ Понуда ${p.number}` : '+ Нова понуда'} {id && <span className={`pill ${OF_ST[status]?.[1] ?? 'info'}`}>{OF_ST[status]?.[0] ?? status}</span>}</h3>
        <input type="hidden" name="leadId" value={l.id} />
        {id && <input type="hidden" name="offerId" value={id} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
          <label className="f" style={{ flex: '1 1 140px' }}><span>Датум</span><input name="date" type="date" defaultValue={p.date} /></label>
          <label className="f" style={{ flex: '1 1 140px' }}><span>Важи до</span><input name="validUntil" type="date" defaultValue={p.validUntil} /></label>
          <label className="f" style={{ flex: '1 1 140px' }}><span>Почеток на соработка</span><input name="start" type="date" defaultValue={p.start} /></label>
        </div>
        <fieldset className="fs"><legend>Услуги (исти како во договорот)</legend>
          {KD_SVC.map(([k, n]) => <label key={k} style={{ display: 'block' }}><input type="checkbox" name={`svc_${k}`} defaultChecked={p.svc.includes(k)} /> {n}</label>)}
          <label className="f"><span>Други услуги (секоја во нов ред)</span><textarea name="extra" rows={2} defaultValue={p.extra} /></label>
        </fieldset>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
          <label className="f" style={{ flex: '1 1 150px' }}><span>Цените се</span><select name="feeMode" defaultValue={p.feeMode}><option value="net">без ДДВ</option><option value="gross">со ДДВ</option></select></label>
          <N k="fee" t="Месечен надоместок (ден.)" w={180} /><N k="feeEmp" t="По вработен над бројот" /><N k="empFree" t="Вработени вклучени" w={120} />
          <N k="feeYear" t="Годишна сметка (ден.)" /><N k="feeHour" t="По час (ден.)" w={120} /><N k="docDay" t="Документи до (ден во месецот)" w={160} /><N k="payDay" t="Плаќање до (ден)" w={130} />
        </div>
        <label className="f"><span>Забелешка во понудата</span><textarea name="note" rows={3} defaultValue={p.note} placeholder="на пр. Првиот месец бесплатно преземање на книгите од претходниот сметководител." /></label>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Submit>{id ? 'Зачувај ја понудата' : 'Креирај понуда'}</Submit>
          {id && <a className="btn" href={`/crm/ponuda?id=${id}`} target="_blank" rel="noopener">🖨 Печати / PDF</a>}
          <Link className="btn ghost" href={`/crm?id=${l.id}`}>Затвори</Link>
        </div>
      </ActionForm>
      {html ? <div className="card" style={{ background: '#fff', color: '#000', maxHeight: 900, overflow: 'auto' }}><div className="pdfdoc" dangerouslySetInnerHTML={{ __html: html }} /></div>
        : <div className="card empty">Прегледот се прикажува по зачувувањето.</div>}
    </div>
  );
}
