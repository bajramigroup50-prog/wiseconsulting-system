/**
 * „🏛 Институции – барања и плаќања“ — everything the state institutions send to or demand from the client firms (УЈП
 * and its regional offices, the ministries of finance and economy, the market / labour / food-and-veterinary /
 * environment inspectorates, ФПИОМ, ФЗО, АВРМ, ЦРМ, Царина, the municipalities, courts and enforcement agents…):
 * requests, decisions, notices, warnings, inspection minutes — per firm or across all firms, with filters by
 * institution, status and deadline (overdue in red). Each item: number, dates, deadline, description, the amount with
 * its payment details (→ „💳 Налог“ = the КТБ / КТД order of `ppNal`, marked paid when the bank statement shows the
 * payment), the attached documents (read by AI / without AI for a text PDF), notes and who handles it.
 * The deadlines are in the deadline calendar (`/rokovi`, reminders to the colleagues) and in Известувања.
 */
import Link from 'next/link';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  INST_BY_ID, INST_DUE_CLS, INST_DUE_LBL, INST_SOURCES, INST_STATUS, INST_TYPES, INSTITUTIONS, instDueState, instDueText, instLabel, instOpen, instOrderRef, instPublicRevenue,
  isInstId, isInstStatus, type InstDueState, type InstSource,
} from '@wise/core/office/institutions';
import { addDays } from '@wise/core/office/dates';
import { FORMS0, INST_FORM_LINKS, INST_FORMS, TPL0 } from '@wise/core/firms/requests';
import { applyInstReads, INST_FILE_ENTITY, instItems, instReadStates, kontroli, paymentOrders, users, type InstItem } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, filesOf, officePage, today } from '@/lib/office';
import { ActionForm, Submit } from '@/components/action-form';
import { AutoRefresh } from '@/components/auto-refresh';
import { DownloadCsv } from '@/components/download-csv';
import { FileChips } from '@/components/file-chips';
import { FirmGo } from '@/components/firm-go';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { instAttach, instDelete, instMatchNow, instSave, instStatus } from './actions';

type SP = { f?: string; st?: string; i?: string; rok?: string; mine?: string; id?: string; nov?: string; q?: string; obr?: string };
const T = '🏛 Институции – барања и плаќања';
const ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,.docx,.txt';
const den = (v: string | number | null | undefined) => (v == null || v === '' ? '' : Number(v).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ST_CLS: Record<string, string> = { new: 'info', work: 'warn', answered: 'good', paid: 'good', closed: '' };
const ROK = { late: 'Задоцнети', week: 'Рок до 7 дена', month: 'Рок до 30 дена', none: 'Без рок' } as const;

export default async function InstituciiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('institucii', { perm: 'office' });
  const td = today();
  const F = await allowedFirms(u, { year: 'all' });
  const fName = new Map(F.map((x) => [x.id, x.name]));
  // the firm filter: `?f=` (all = every firm of the user), else the working firm, else every firm
  const fSel = sp.f === 'all' ? null : sp.f && fName.has(sp.f) ? sp.f : sp.f ? null : firm && fName.has(firm.id) ? firm.id : null;
  const ids = fSel ? [fSel] : F.map((x) => x.id);
  // finished reads are applied before listing (the worker applies them too; this covers a read finished meanwhile)
  await applyInstReads(db(), { firmIds: ids }).catch(() => 0);
  const staff = await db().select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.active, true), sql`${users.role} not in ('klient','teren')`)).orderBy(asc(users.name));
  const sName = new Map(staff.map((s) => [s.id, s.name]));

  const qs = (o: Partial<SP>) => {
    const m: Record<string, string | undefined> = { f: sp.f, st: sp.st, i: sp.i, rok: sp.rok, mine: sp.mine, q: sp.q, ...o };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(m)) if (v) q.set(k, v);
    const s = q.toString();
    return '/institucii' + (s ? '?' + s : '');
  };

  /* ---------- one item / new item ---------- */
  if (sp.nov !== undefined || sp.id) {
    const [it] = sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) && ids.length
      ? await db().select().from(instItems).where(and(eq(instItems.id, sp.id), inArray(instItems.firmId, F.map((x) => x.id)))).limit(1) : [];
    if (sp.id && !it) return <><Hd t={T} /><div className="empty">Записот не постои. <Link href="/institucii">← Назад</Link></div></>;
    const fid = it?.firmId ?? (sp.f && fName.has(sp.f) ? sp.f : firm && fName.has(firm.id) ? firm.id : null);
    if (!fid) {
      return (
        <>
          <Hd t={`${T} · ново`}><Link className="btn" href="/institucii">Откажи</Link></Hd>
          <form className="card" method="get" action="/institucii">
            <input type="hidden" name="nov" value="1" />
            <label className="f">За која фирма?<select name="f" required defaultValue="">{[<option key="" value="">— изберете —</option>, ...F.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)]}</select></label>
            <button className="btn pri">Понатаму →</button>
          </form>
        </>
      );
    }
    const [FL, RS, orders, K] = it ? await Promise.all([
      filesOf(INST_FILE_ENTITY, [it.id]),
      instReadStates(db(), [it.id]),
      db().select({ id: paymentOrders.id, date: paymentOrders.date, amount: paymentOrders.amount, kind: paymentOrders.kind, printedAt: paymentOrders.printedAt })
        .from(paymentOrders).where(and(eq(paymentOrders.firmId, it.firmId), eq(paymentOrders.refId, instOrderRef(it.id)))).orderBy(desc(paymentOrders.date)),
      it.kontrolaId ? db().select({ id: kontroli.id, docNo: kontroli.docNo }).from(kontroli).where(and(eq(kontroli.id, it.kontrolaId), eq(kontroli.firmId, it.firmId))).limit(1) : Promise.resolve([]),
    ]) : [new Map(), new Map(), [], []] as const;
    const reads: { id: string; status: string; error: string | null }[] = it ? RS.get(it.id) ?? [] : [];
    const busy = reads.some((r) => r.status === 'queued' || r.status === 'reading');
    const files: { id: string; name: string }[] = it ? FL.get(it.id) ?? [] : [];
    const ds: InstDueState = it ? instDueState({ ...it, amount: it.amount }, td) : 'none';
    const pay = it && Number(it.amount) > 0;
    return (
      <>
        <Hd t={it ? `${instLabel(it)} · ${INST_TYPES[it.type as keyof typeof INST_TYPES] ?? it.type}${it.refNo ? ' бр. ' + it.refNo : ''}` : `${T} · ново`} sub={fName.get(fid)} exp={false}>
          <Link className="btn" href={qs({ id: undefined, nov: undefined })}>← Сите</Link>
          {it && <RowAction className="btn ghost" action={instDelete.bind(null, it.id)} label="🗑 Избриши" confirm="Да се избрише записот (прикачените документи остануваат во архивата)?" />}
        </Hd>
        {busy && <div className="callout info" role="status"><AutoRefresh seconds={4} />📄 Прикачениот документ се чита – институцијата, бројот, рокот, износот и податоците за плаќање ќе се пополнат во празните полиња…</div>}
        {reads.filter((r) => r.status === 'error').map((r) => <div key={r.id} className="callout warn">Документот не е прочитан: {r.error ?? 'грешка'} – пополнете ги полињата рачно.</div>)}
        {it && (
          <div className="card"><div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`pill ${ST_CLS[it.status] ?? ''}`}>{INST_STATUS[it.status as keyof typeof INST_STATUS] ?? it.status}</span>
            {it.due && <span className={`pill ${INST_DUE_CLS[ds]}`}>рок {dmy(it.due)}{instOpen(it.status) ? ` · ${instDueText(it.due, td)}` : ''}</span>}
            {pay && <span className="pill">{den(it.amount)} ден.{it.paidOn ? ` · платено ${dmy(it.paidOn)}` : ' · неплатено'}</span>}
            <span style={{ flex: 1 }} />
            {it.status !== 'work' && instOpen(it.status) && <RowAction className="btn sm" action={instStatus.bind(null, it.id, 'work')} label="▶ Во работа" />}
            {it.status !== 'answered' && it.status !== 'closed' && <RowAction className="btn sm" action={instStatus.bind(null, it.id, 'answered')} label="✉ Одговорено" />}
            {it.status !== 'closed' && <RowAction className="btn sm" action={instStatus.bind(null, it.id, 'closed')} label="✓ Затвори" />}
            {!instOpen(it.status) && <RowAction className="btn sm ghost" action={instStatus.bind(null, it.id, 'new')} label="↺ Отвори повторно" />}
          </div></div>
        )}
        {it && pay && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>💳 Плаќање</h3>
            {it.paidOn ? <p className="callout good">{it.paidNote || `✓ платено на ${dmy(it.paidOn)}`}</p>
              : <p className="mini">Кога изводот ќе го покаже плаќањето (ист износ и „повикување на број“, или сметката на примачот), записот сам се означува „Платено“ – секое утро или со „↻ Провери плаќања“.</p>}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {!it.paidOn && <FirmGo className="btn pri" fid={it.firmId} current={firm?.id ?? null} to={`/ppNal?inst=${it.id}`} title="Отвора нов налог пополнет од овој запис">
                💳 Направи налог {instPublicRevenue(it) ? 'КТБ (јавни приходи)' : 'КТД'}</FirmGo>}
              {orders.map((o) => <FirmGo key={o.id} className="btn sm" fid={it.firmId} current={firm?.id ?? null} to={`/ppNal?edit=${o.id}`}>Налог од {dmy(o.date)} · {den(o.amount)}{o.printedAt ? ' · печатен' : ''}</FirmGo>)}
              {!it.paidOn && <RowAction className="btn sm" action={instMatchNow.bind(null, [it.firmId])} label="↻ Провери во изводите" showOk />}
            </div>
            {!it.paidOn && (
              <ActionForm action={instStatus.bind(null, it.id, 'paid')} className="row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                <label className="f">Платено на (рачно)<input type="date" name="paidOn" defaultValue={td} /></label>
                <label className="f wide">Белешка<input name="paidNote" placeholder="пр. платено во готово / компензација" /></label>
                <Submit className="btn">✓ Означи платено</Submit>
              </ActionForm>
            )}
          </div>
        )}
        <ItemForm it={it} fid={fid} staff={staff} uid={u.id} />
        {it && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>📎 Документи</h3>
            {files.length ? <FileChips files={files} /> : <p className="muted">Нема прикачени документи.</p>}
            <ActionForm action={instAttach.bind(null, it.id)} className="row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
              <UploadField firmId={it.firmId} accept={ACCEPT} label="📎 Додај документ (одговор, доказ, уплатница…)" />
              <label className="row" style={{ gap: 4 }}><input type="checkbox" name="read" /> прочитај го (пополни празни полиња)</label>
              <Submit className="btn">Прикачи</Submit>
            </ActionForm>
            <p className="mini">Документите се чуваат во архивата на фирмата (📁 Архива), со рокот на чување на категоријата.</p>
            {(it.type === 'zapisnik' || it.type === 'reshenie') && (
              <p className="mini">📑 За анализа на наодите, приговор / жалба и рокови за правни лекови: {K[0]
                ? <FirmGo inline fid={it.firmId} current={firm?.id ?? null} to={`/kontroli?id=${K[0].id}`}>отвори ја контролата{K[0].docNo ? ' ' + K[0].docNo : ''} →</FirmGo>
                : <FirmGo inline fid={it.firmId} current={firm?.id ?? null} to="/kontroli?nov=1">Контроли и решенија (анализа) →</FirmGo>}</p>
            )}
            <p className="mini muted">Извор: {INST_SOURCES[it.source as InstSource] ?? it.source} · внесено {it.createdAt.toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>
        )}
      </>
    );
  }

  /* ---------- the list ---------- */
  const st = sp.st === 'all' ? 'all' : sp.st && isInstStatus(sp.st) ? sp.st : 'open';
  const inst = sp.i && isInstId(sp.i) ? sp.i : '';
  const rok = sp.rok && sp.rok in ROK ? sp.rok as keyof typeof ROK : '';
  const all: InstItem[] = ids.length ? await db().select().from(instItems).where(inArray(instItems.firmId, ids)).orderBy(asc(instItems.due), desc(instItems.received)) : [];
  const q = (sp.q ?? '').trim().toLowerCase();
  const L = all.filter((i) => (st === 'all' ? true : st === 'open' ? instOpen(i.status) : i.status === st)
    && (!inst || i.inst === inst)
    && (!sp.mine || i.assigneeId === u.id)
    && (!q || [i.refNo, i.subject, i.instName, i.note, i.payRef, fName.get(i.firmId)].some((x) => String(x ?? '').toLowerCase().includes(q)))
    && (!rok || (rok === 'none' ? !i.due : !!i.due && instOpen(i.status) && (rok === 'late' ? i.due < td : i.due <= addDays(td, rok === 'week' ? 7 : 30)))))
    // open items with a deadline first (the oldest deadline on top), then without a deadline, then the finished ones
    .sort((a, b) => Number(!instOpen(a.status)) - Number(!instOpen(b.status)) || Number(!a.due) - Number(!b.due) || String(a.due ?? '').localeCompare(String(b.due ?? '')));
  const open = all.filter((i) => instOpen(i.status));
  const late = open.filter((i) => i.due && i.due < td).length;
  const soon = open.filter((i) => i.due && i.due >= td && i.due <= addDays(td, 7)).length;
  const toPay = all.filter((i) => Number(i.amount) > 0 && !i.paidOn && i.status !== 'closed');
  const toPaySum = toPay.reduce((s, i) => s + Number(i.amount), 0);
  const csv: (string | number | null)[][] = [['Фирма', 'Институција', 'Вид', 'Број', 'Датум', 'Примено', 'Рок', 'Опис', 'Износ', 'Повик. на број', 'Статус', 'Платено', 'Одговорен', 'Белешка']];
  for (const i of L) csv.push([fName.get(i.firmId) ?? '', instLabel(i), INST_TYPES[i.type as keyof typeof INST_TYPES] ?? i.type, i.refNo, dmy(i.docDate), dmy(i.received), dmy(i.due), i.subject,
    i.amount == null ? null : Number(i.amount), i.payRef, INST_STATUS[i.status as keyof typeof INST_STATUS] ?? i.status, dmy(i.paidOn), i.assigneeId ? sName.get(i.assigneeId) ?? '' : '', i.note]);

  return (
    <>
      <Hd t={T} sub="барања, решенија, опомени, записници и плаќања од УЈП, министерствата, инспекторатите, фондовите, општините и судовите" exp={false}>
        <Link className="btn pri" href={`/institucii?nov=1${fSel ? '&f=' + fSel : ''}`}>+ Ново / 📄 од скен</Link>
        <RowAction className="btn" action={instMatchNow.bind(null, ids)} label="↻ Провери плаќања во изводите" showOk />
        <Link className="btn" href={qs({ obr: '1' })}>📄 Барања и обрасци</Link>
        <DownloadCsv name="institucii.csv" rows={csv} />
        <Link className="btn ghost" href="/rokovi">📅 Календар на рокови</Link>
        <Link className="btn ghost" href="/prist">📥 Пристигнати документи</Link>
      </Hd>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '0 0 8px' }}>
        <Link className={`pill ${late ? 'bad' : 'good'}`} href={qs({ rok: 'late', st: undefined })}>🔴 задоцнети: {late}</Link>
        <Link className={`pill ${soon ? 'warn' : ''}`} href={qs({ rok: 'week', st: undefined })}>🟠 рок до 7 дена: {soon}</Link>
        <Link className="pill info" href={qs({ rok: undefined, st: undefined })}>отворени: {open.length}</Link>
        <span className="pill">за плаќање: {toPay.length} · {den(toPaySum)} ден.</span>
      </div>
      <form className="card noprint" method="get" action="/institucii"><div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="f">Фирма<select name="f" defaultValue={fSel ?? 'all'}><option value="all">Сите фирми ({F.length})</option>{F.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="f">Институција<select name="i" defaultValue={inst}><option value="">Сите</option>{INSTITUTIONS.map((x) => <option key={x.id} value={x.id}>{x.n}</option>)}</select></label>
        <label className="f">Статус<select name="st" defaultValue={st}><option value="open">Отворени (ново + во работа)</option>{Object.entries(INST_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="all">Сите</option></select></label>
        <label className="f">Рок<select name="rok" defaultValue={rok}><option value="">Сите</option>{Object.entries(ROK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Барај<input name="q" defaultValue={sp.q ?? ''} placeholder="број, опис, повик…" /></label>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" name="mine" value="1" defaultChecked={!!sp.mine} /> само мои</label>
        <button className="btn">Прикажи</button>
      </div></form>
      <FormsCatalog inst={inst} firmId={fSel ?? (firm && fName.has(firm.id) ? firm.id : F[0]?.id ?? null)} firmName={fName.get(fSel ?? firm?.id ?? '') ?? F[0]?.name ?? ''} open={sp.obr === '1'} />
      {!L.length ? <div className="empty">{all.length ? 'Нема записи за избраните филтри.' : 'Сè уште нема записи. Внесете барање / решение рачно, прикачете скен (AI ги чита рокот и износот), или пратете го документот од „📥 Пристигнати документи“ → „Институција“.'}</div> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Фирма</th><th>Институција</th><th>Вид · број</th><th>Примено</th><th>Рок</th><th>Опис</th><th className="r">Износ (ден.)</th><th>Статус</th><th>Одговорен</th><th /></tr></thead>
            <tbody>
              {L.map((i) => {
                const ds = instDueState({ ...i, amount: i.amount }, td);
                return (
                  <tr key={i.id} className={ds === 'late' || ds === 'today' ? 'bad' : undefined} style={ds === 'late' || ds === 'today' ? { color: '#b00020' } : undefined}>
                    <td>{fName.get(i.firmId)}</td>
                    <td title={i.instName ?? INST_BY_ID[i.inst]?.n}>{instLabel(i)}</td>
                    <td>{INST_TYPES[i.type as keyof typeof INST_TYPES] ?? i.type}{i.refNo ? <div className="mini">бр. {i.refNo}</div> : null}</td>
                    <td>{dmy(i.received)}</td>
                    <td>{i.due ? <><b>{dmy(i.due)}</b>{ds !== 'done' && <div className={`mini pill ${INST_DUE_CLS[ds]}`}>{ds === 'ok' ? instDueText(i.due, td) : `${INST_DUE_LBL[ds]} · ${instDueText(i.due, td)}`}</div>}</> : <span className="muted">—</span>}</td>
                    <td style={{ maxWidth: 320 }}>{i.subject}</td>
                    <td className="r">{den(i.amount)}{Number(i.amount) > 0 && <div className="mini">{i.paidOn ? `✓ ${dmy(i.paidOn)}` : 'неплатено'}</div>}</td>
                    <td><span className={`pill ${ST_CLS[i.status] ?? ''}`}>{INST_STATUS[i.status as keyof typeof INST_STATUS] ?? i.status}</span></td>
                    <td>{i.assigneeId ? sName.get(i.assigneeId) ?? '' : ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={qs({ id: i.id })}>Отвори</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mini">Роковите се во 📅 Календарот на рокови (потсетници до одговорните колеги) и во 🔔 Известувања (задоцнети и рок до 7 дена). Документ од е-пошта или од клиентот: 📥 Пристигнати документи → „Институција (барање / решение)“.</p>
    </>
  );
}

function ItemForm({ it, fid, staff, uid }: { it?: InstItem; fid: string; staff: { id: string; name: string }[]; uid: string }) {
  return (
    <ActionForm action={instSave} reset={false}>
      {it ? <input type="hidden" name="id" value={it.id} /> : <input type="hidden" name="firmId" value={fid} />}
      {!it && (
        <div className="callout info" style={{ marginBottom: 8 }}>
          📄 Прикачете го скенот / PDF-от и зачувајте – програмата ги чита институцијата, бројот, рокот, износот и податоците за плаќање (AI, или без AI за PDF со текст). Може и сè рачно.
          <div style={{ marginTop: 6 }}><UploadField firmId={fid} accept={ACCEPT} label="📎 Прикачи го документот (PDF, слика, Word)" /></div>
        </div>
      )}
      <div className="form">
        <label className="f">Институција<select name="inst" defaultValue={it?.inst ?? 'ujp'}>{INSTITUTIONS.map((x) => <option key={x.id} value={x.id}>{x.n}</option>)}</select></label>
        <label className="f wide">Назив (како во документот)<input name="instName" defaultValue={it?.instName ?? ''} placeholder="пр. УЈП – Регионална дирекција Скопје / Општина Аеродром / Основен суд Скопје II" /></label>
        <label className="f">Вид<select name="type" defaultValue={it?.type ?? 'baranje'}>{Object.entries(INST_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Број на документот<input name="refNo" defaultValue={it?.refNo ?? ''} /></label>
        <label className="f">Датум на документот<input type="date" name="docDate" defaultValue={it?.docDate ?? ''} /></label>
        <label className="f">Примено на<input type="date" name="received" defaultValue={it?.received ?? today()} /></label>
        <label className="f">Рок (одговор / плаќање)<input type="date" name="due" defaultValue={it?.due ?? ''} /></label>
        <label className="f wide">Краток опис (што се бара)<textarea name="subject" rows={2} defaultValue={it?.subject ?? ''} /></label>
        <label className="f">Статус<select name="status" defaultValue={it?.status ?? 'new'}>{Object.entries(INST_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Одговорен колега<select name="assigneeId" defaultValue={it?.assigneeId ?? (it ? '' : uid)}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <h3>💳 За плаќање (ако има)</h3>
      <div className="form">
        <label className="f">Износ (ден.)<input name="amount" inputMode="decimal" defaultValue={it?.amount ?? ''} /></label>
        <label className="f wide">Примач<input name="payRecip" defaultValue={it?.payRecip ?? ''} placeholder="празно за јавни приходи (Буџет на РСМ)" /></label>
        <label className="f">Сметка на примачот<input name="payAccount" defaultValue={it?.payAccount ?? ''} placeholder="15 цифри или МК07…" /></label>
        <label className="f">Уплатна сметка<input name="payUplSm" defaultValue={it?.payUplSm ?? ''} placeholder="пр. 840-XXX-02687" /></label>
        <label className="f">Приходна шифра и програма<input name="payPrihod" defaultValue={it?.payPrihod ?? ''} placeholder="пр. 714116 00" /></label>
        <label className="f">Повикување на број<input name="payRef" defaultValue={it?.payRef ?? ''} /></label>
        <label className="f wide">Опис на плаќањето (на налогот)<input name="payPurpose" maxLength={140} defaultValue={it?.payPurpose ?? ''} placeholder="празно = „Плаќање по решение бр. … – УЈП“" /></label>
      </div>
      <label className="f wide">Белешки<textarea name="note" rows={3} defaultValue={it?.note ?? ''} /></label>
      <Submit>{it ? 'Зачувај' : 'Зачувај (и прочитај го документот)'}</Submit>
    </ActionForm>
  );
}

/** `/baranja` institution names → `INSTITUTIONS` ids. */
const REQ_INST: Record<string, string> = { 'УЈП': 'ujp', 'ЦРСМ': 'crm', 'АВРМ': 'avrm', 'ФЗО': 'fzo', 'ПИОМ': 'fpiom', 'Општина': 'opstina', 'Суд': 'sud', 'Нотар': 'notar' };

/**
 * „📄 Барања и обрасци по институција“: every form of the site's list (wiseconsulting.com.mk › Обрасци) and of
 * „Барања и обрасци“ — „✎ Пополни“ opens it filled with the firm's data (name, ЕДБ, ЕМБС, address, phone, e-mail,
 * activity, the manager as signer, today) for printing / PDF; the others link to the official original.
 */
function FormsCatalog({ inst, firmId, firmName, open }: { inst: string; firmId: string | null; firmName: string; open: boolean }) {
  type Row = { key: string; code: string; name: string; fill: string | null; url: string | null; kind: string };
  const by = new Map<string, Row[]>();
  const add = (i: string, r: Row) => by.set(i, [...(by.get(i) ?? []), r]);
  for (const f of [...FORMS0, ...TPL0]) {
    const i = REQ_INST[f.inst];
    if (i) add(i, { key: f.id, code: '', name: f.name, fill: f.id, url: null, kind: 'form' in f ? 'образец' : 'барање' });
  }
  for (const l of INST_FORM_LINKS) add(l.inst, { key: l.url, code: l.code, name: l.name, fill: l.form, url: l.url, kind: l.kind });
  const fillable = INST_FORMS.length + FORMS0.length + TPL0.filter((t) => REQ_INST[t.inst]).length;
  const list = INSTITUTIONS.filter((x) => (!inst || x.id === inst) && x.id !== 'other');
  const href = (id: string) => `/baranja?t=${encodeURIComponent(id)}${firmId ? '&src=' + firmId : ''}`;
  return (
    <details className="card" open={open || !!inst}>
      <summary><b>📄 Барања и обрасци по институција</b> <span className="mini">– {fillable} се пополнуваат сами за {firmName || 'избраната фирма'}; другите се линкови до официјалниот образец</span></summary>
      {list.map((x) => {
        const R = by.get(x.id) ?? [];
        return (
          <div key={x.id} style={{ marginTop: 10 }}>
            <b>{x.n}</b>
            {!R.length ? <div className="mini muted">Сè уште нема образец во програмата – испратете го образецот (PDF / Word) за да се додаде.</div> : (
              <table className="tbl dense" style={{ marginTop: 4 }}><tbody>
                {R.map((r) => (
                  <tr key={r.key}>
                    <td style={{ width: 90 }}>{r.code && <span className="pill">{r.code}</span>}</td>
                    <td>{r.name}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {r.fill && firmId && <Link className="btn sm pri" href={href(r.fill)}>✎ Пополни</Link>}{' '}
                      {r.url && <a className="btn sm" href={r.url} target="_blank" rel="noopener noreferrer">↗ {r.fill ? 'Оригинал' : r.kind === 'WEB' ? 'Отвори' : r.kind}</a>}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
        );
      })}
    </details>
  );
}
