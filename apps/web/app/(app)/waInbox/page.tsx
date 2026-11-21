/**
 * 💬 WhatsApp разговори: the office inbox of the WhatsApp Business number — one row per phone (newest first, unread
 * count), „Неразпоредени“ (numbers WISE did not recognise: pick the firm, the phone is remembered), and the thread
 * of one phone: in / out messages, delivery status (✓ sent, ✓✓ delivered, 🔵 read, ✕ failed), attachments (the
 * client's files are already in „📥 Пристигнати документи“), and the reply box (free text inside the 24-hour window,
 * a template outside it). `?firm=` = one firm's conversations (from the dossier / firm screens).
 * Office staff only; a colleague sees only the firms they may open, the unassigned numbers need the office permission.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, firmAllowed } from '@wise/core';
import { WA_PURPOSES, waActive, waPhone, waShow, waWindowOpen, type WaPurpose } from '@wise/core/whatsapp/wa';
import { waConversations, waMarkRead, waSecrets, waThread, type Tx } from '@wise/db';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { viewAllowed } from '@/lib/nav';
import { allowedFirms, isUuid } from '@/lib/office';
import { waAssignAction } from './actions';
import { WaReply } from './reply';

const T = '💬 WhatsApp разговори';
const dt = (d: Date | null) => (d ? d.toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' }) : '');
const ST: Record<string, [string, string]> = { sent: ['✓', 'испратено'], delivered: ['✓✓', 'доставено'], read: ['🔵✓✓', 'прочитано'], failed: ['✕', 'неуспешно'], received: ['', ''] };

export default async function WaInboxPage({ searchParams }: { searchParams: Promise<{ p?: string; firm?: string; f?: string }> }) {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren' || !viewAllowed(u.role, 'waInbox')) notFound();
  if (isDemoUser(u)) return <><Hd t={T} exp={false} /><div className="card empty">Не е достапно во демото.</div></>;
  const sp = await searchParams;
  const office = can(u.principal, 'office');
  const F = await allowedFirms(u, { year: 'all' });
  const firmName = new Map(F.map((f) => [f.id, f.name]));
  const firmId = isUuid(sp.firm) && firmName.has(sp.firm) ? sp.firm : null;
  const un = sp.f === 'un' && office;
  const s = await waSecrets(db() as unknown as Tx);
  const on = waActive(s);
  const all = u.allFirms || u.role === 'admin';
  const C = (await waConversations(db(), { unassigned: un, firmIds: firmId ? [firmId] : un || all ? null : F.map((f) => f.id), limit: 300 }))
    .filter((c) => (c.firmId ? firmAllowed(u.principal, c.firmId) : office));
  const unCount = office ? (await waConversations(db(), { unassigned: true, limit: 300 })).length : 0;
  const phone = waPhone(sp.p ?? '');
  const sel = phone ? C.find((c) => c.phone === phone) ?? (await waConversations(db(), { limit: 1000 })).find((c) => c.phone === phone && (c.firmId ? firmAllowed(u.principal, c.firmId) : office)) : null;
  const M = sel ? await waThread(db(), { phone: sel.phone }) : [];
  if (sel && sel.unread) await waMarkRead(db(), sel.phone);
  const q = (o: Record<string, string | undefined>) => '?' + new URLSearchParams(Object.entries({ firm: firmId ?? undefined, f: un ? 'un' : undefined, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const open = sel ? waWindowOpen(sel.lastIn) : false;
  return (
    <>
      <Hd t={T} sub={firmId ? firmName.get(firmId) : 'Бројот на канцеларијата (WhatsApp Business)'} exp={false}>
        <Link className={`btn ${!un && !firmId ? 'pri' : ''}`} href="/waInbox">Сите</Link>
        {office && <Link className={`btn ${un ? 'pri' : ''}`} href="/waInbox?f=un">❓ Неразпоредени{unCount ? ` (${unCount})` : ''}</Link>}
        {firmId && <Link className="btn" href="/waInbox">✕ {firmName.get(firmId)}</Link>}
        {viewAllowed(u.role, 'whatsapp') && <Link className="btn" href="/whatsapp">⚙ Поставки</Link>}
      </Hd>
      {!on && <div className="callout warn">WhatsApp од WISE е исклучен или не е поврзан – нови пораки не пристигнуваат и не се праќаат. Сопственикот го вклучува во 💬 WhatsApp (поставки).</div>}
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '0 1 360px', minWidth: 280, padding: 0, maxHeight: '75vh', overflowY: 'auto', overflowX: 'hidden' }}>
          {C.length ? C.map((c) => (
            <Link key={c.phone} href={q({ p: c.phone })} style={{ display: 'block', padding: '8px 12px', borderBottom: '1px solid var(--line, #eee)', textDecoration: 'none', color: 'inherit', background: c.phone === sel?.phone ? 'var(--sel, #e8f7ee)' : undefined }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                <b>{c.firm ?? '❓ ' + (c.name || waShow(c.phone))}</b>
                <span className="mini">{dt(c.last)}</span>
              </div>
              <div className="mini">{c.name && c.firm ? c.name + ' · ' : ''}{waShow(c.phone)}{c.unread && c.phone !== sel?.phone ? <> · <span className="pill good">{c.unread} нови</span></> : null}</div>
              <div className="mini" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.lastDir === 'out' ? '↗ ' : ''}{c.lastBody}</div>
            </Link>
          )) : <div className="empty" style={{ padding: 16 }}>{un ? '✓ Нема неразпоредени броеви.' : 'Сè уште нема разговори.'}</div>}
        </div>
        <div style={{ flex: '1 1 480px', minWidth: 320 }}>
          {sel ? (
            <>
              <div className="card">
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div><b>{sel.firm ?? 'Непознат број'}</b> · {sel.name ? sel.name + ' · ' : ''}{waShow(sel.phone)}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className={`pill ${open ? 'good' : 'warn'}`}>{open ? '⏱ 24-часовниот прозорец е отворен' : 'надвор од 24 часа – само шаблони'}</span>
                    {sel.firmId && <Link className="btn sm" href={`/waInbox?firm=${sel.firmId}`}>Разговори на фирмата</Link>}
                    {sel.firmId && <Link className="btn sm" href="/prist">📥 Пристигнати документи</Link>}
                  </div>
                </div>
                {!sel.firmId && office && (
                  <ActionForm action={waAssignAction.bind(null, sel.phone)} className="" reset={false}>
                    <div className="row" style={{ gap: 8, alignItems: 'end', marginTop: 8, flexWrap: 'wrap' }}>
                      <label className="f" style={{ margin: 0 }}>На која фирма ѝ припаѓа бројот?<select name="firmId" defaultValue="">
                        <option value="" disabled>– изберете –</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
                      <Submit>Додели (и запамети го бројот)</Submit>
                    </div>
                  </ActionForm>
                )}
              </div>
              <div className="card" style={{ maxHeight: '55vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {M.map((m) => {
                  const out = m.dir === 'out';
                  const st = ST[m.status] ?? ['', m.status];
                  return (
                    <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '78%', background: out ? '#dcf8c6' : 'var(--card2, #f3f3f3)', color: '#111', borderRadius: 10, padding: '6px 10px' }}>
                      {m.template && <div className="mini">📋 шаблон {m.template}{m.purpose ? ' · ' + (WA_PURPOSES[m.purpose as WaPurpose] ?? m.purpose) : ''}</div>}
                      {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
                      {m.fileId ? <div>📎 <a href={`/api/files/${m.fileId}`} target="_blank" rel="noreferrer">{m.fileName ?? 'датотека'}</a>{m.incomingDocId && <span className="mini"> · во Пристигнати документи</span>}</div>
                        : m.kind !== 'text' && m.kind !== 'template' && !m.body ? <div className="mini">[{m.kind}{m.fileName ? ' ' + m.fileName : ''}{(m.data as { media?: unknown }).media ? ' – се презема…' : ''}]</div> : null}
                      <div className="mini" style={{ textAlign: 'right', opacity: 0.75 }}>{dt(m.createdAt)}{out && st[0] ? <> · <span title={st[1]}>{st[0]}</span></> : null}</div>
                      {m.error && <div className="mini" style={{ color: '#b00020' }}>✕ {m.error}</div>}
                    </div>
                  );
                })}
              </div>
              <WaReply phone={sel.phone} firmId={sel.firmId} open={open} on={on} firm={sel.firm ?? ''} templates={s.templates} />
            </>
          ) : <div className="card empty">Изберете разговор лево.</div>}
        </div>
      </div>
    </>
  );
}
