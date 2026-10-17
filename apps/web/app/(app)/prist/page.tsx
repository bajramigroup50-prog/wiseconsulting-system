/**
 * „📥 Пристигнати документи“ (UX P7 / P32 / P33, docs/ux-rindertim.md): ONE inbox for everything that arrives, per firm
 * and for the office — the files uploaded here (`incoming_docs`), the client's portal / 📷 phone messages
 * (`inbox_items`, routed exactly as in /klInbox, which stays as the client-messages view), the documents read on the
 * scan screens (`ai_documents`), the МПИН uploads (`mpin_inbox`). Each row: where it came from, the detected type, the
 * status (непрочитан · прочитан · обработен · прескокнат) and where it went; one click routes it (or confirms the
 * suggested route). Bank statements with the firm's own account are imported automatically (worker `incoming.detect`).
 *
 * Access: only the firms the user may access (`allowedFirms`; 🎭 demo → the demo firms); office-wide rows only for the
 * owner / unrestricted admins; 🔒 book-only colleagues see their firms' files only (`lib/incoming-scope.ts`).
 */
import Link from 'next/link';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { can } from '@wise/core';
import { inboxClassification } from '@wise/core/ai/classify';
import {
  DETECT_HOW, INBOX_ROUTES, INCOMING_KINDS, INCOMING_SOURCES, INCOMING_STATUS, incomingFromCapture, incomingFromClassify,
  type IncomingKind, type IncomingSource, type IncomingStatus,
} from '@wise/core/office';
import { aiDocuments, files, heldScanCount, inboxItems, incomingDocs, mpinInbox, OFFICE_FILE_ENTITY } from '@wise/db';
import { PastReview, pastReviewData } from '@/components/sales/past-review';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { allowedFirms, filesOf } from '@/lib/office';
import { isOfficeOwner } from '@/lib/office-owner';
import { viewsOf } from '@/lib/view-access';
import { inboxScope, routeRefLink } from '@/lib/incoming-scope';
import { Hd, dmyHm } from '@/components/hd';
import { FilePreview } from '@/components/file-preview';
import { AutoRefresh } from '@/components/sales/scan-upload';
import { InActions, InUpload, PortalActions } from './client';

type SP = { firm?: string; src?: string; st?: string; kind?: string };

interface Row {
  key: string; at: Date; src: IncomingSource; firmId: string | null; from?: string | null;
  files: { id: string; name: string; mime: string }[];
  kind: IncomingKind; how: string; what: string; status: IncomingStatus; result: string | null;
  link: { href: string; label: string } | null;
  inc?: { id: string; proposed: { id: string; name: string }[]; needsAi: boolean; aiBusy: boolean };
  portal?: { id: string };
}

const PILL: Record<IncomingStatus, string> = { unread: 'info', read: 'warn', done: 'good', skipped: '' };
const N = 150;

export default async function PristPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('prist');
  const F = await allowedFirms(u);
  const scope = inboxScope(u, { firmIds: F.map((f) => f.id), restricted: await viewsOf(db(), u), owner: await isOfficeOwner(u) });
  // the firm filter: one firm, „сите“ (every firm I may access) or „канцеларија“ (office-wide only)
  const want = sp.firm ?? (firm ? firm.id : 'all');
  const onlyOffice = want === 'office' && scope.office;
  const ids = onlyOffice ? [] : want !== 'all' && scope.firmIds.includes(want) ? [want] : scope.firmIds;
  const withOffice = scope.office && (onlyOffice || want === 'all');
  const fname = (id: string | null) => (id ? F.find((f) => f.id === id)?.name ?? '' : '🏢 Канцеларија');
  const firmCond = (col: Parameters<typeof inArray>[0]): SQL | undefined => {
    const a = ids.length ? inArray(col, ids) : undefined;
    const b = withOffice ? isNull(col) : undefined;
    return a && b ? or(a, b) : a ?? b ?? sql`false`;
  };

  const [INC, PORT, SCAN, MPIN] = await Promise.all([
    db().select({ r: incomingDocs, f: { id: files.id, name: files.name, mime: files.mime } }).from(incomingDocs).innerJoin(files, eq(files.id, incomingDocs.fileId))
      .where(firmCond(incomingDocs.firmId)).orderBy(desc(incomingDocs.createdAt)).limit(N),
    ids.length ? db().select().from(inboxItems).where(and(inArray(inboxItems.firmId, ids), eq(inboxItems.fromOffice, false))).orderBy(desc(inboxItems.createdAt)).limit(N) : [],
    ids.length ? db().select({ d: aiDocuments, f: { id: files.id, name: files.name, mime: files.mime } }).from(aiDocuments).innerJoin(files, eq(files.id, aiDocuments.fileId))
      .where(and(inArray(aiDocuments.firmId, ids), inArray(aiDocuments.kind, ['purchase', 'sale']),
        sql`not (${aiDocuments.options} ?| array['inline','inboxId','incomingId','parentId'])`))
      .orderBy(desc(aiDocuments.createdAt)).limit(N) : [],
    scope.mpin ? db().select({ m: mpinInbox, f: { id: files.id, name: files.name, mime: files.mime } }).from(mpinInbox).innerJoin(files, eq(files.id, mpinInbox.fileId))
      .where(and(eq(mpinInbox.cleared, false), firmCond(mpinInbox.firmId))).orderBy(desc(mpinInbox.createdAt)).limit(N) : [],
  ]);
  const PF = await filesOf(OFFICE_FILE_ENTITY.inbox, PORT.map((i) => i.id));
  // the AI classification started on a click (`🤖 Препознај`)
  const aiIds = INC.map((x) => x.r.aiDocId).filter((x): x is string => !!x);
  const AI = aiIds.length ? await db().select({ id: aiDocuments.id, status: aiDocuments.status, result: aiDocuments.result, error: aiDocuments.error }).from(aiDocuments).where(inArray(aiDocuments.id, aiIds)) : [];

  const rows: Row[] = [
    ...INC.map(({ r, f }): Row => {
      const d = r.detect as { proposed?: { id: string; name: string }[]; needsAi?: boolean; import?: { numbers?: string[] } };
      const ai = r.aiDocId ? AI.find((a) => a.id === r.aiDocId) : undefined;
      const c = ai?.status === 'done' && r.kind === 'unknown' ? inboxClassification(ai.result) : null;
      const kind = c ? incomingFromClassify(c.kind) : (r.kind as IncomingKind);
      return {
        key: 'i' + r.id, at: r.createdAt, src: (r.source as IncomingSource) ?? 'upload', firmId: r.firmId, files: [f], kind,
        how: c ? DETECT_HOW.ai : DETECT_HOW[(r.how ?? 'none') as keyof typeof DETECT_HOW] ?? '', what: c?.what || r.what || '',
        status: r.status as IncomingStatus, result: ai?.status === 'error' ? `AI: ${ai.error ?? 'грешка'}` : r.result,
        link: routeRefLink(r.routeRef, r.route, d.import?.numbers),
        inc: { id: r.id, proposed: (d.proposed ?? []).filter((p) => scope.firmIds.includes(p.id)), needsAi: !!d.needsAi, aiBusy: ai?.status === 'queued' || ai?.status === 'reading' },
      };
    }),
    ...PORT.filter((i) => (PF.get(i.id)?.length ?? 0) > 0).map((i): Row => ({
      key: 'p' + i.id, at: i.createdAt, src: i.docKind ? 'capture' : 'portal', firmId: i.firmId, from: i.fromName, files: PF.get(i.id) ?? [],
      kind: incomingFromCapture(i.docKind), how: i.docKind ? DETECT_HOW.client : '', what: [i.subject, i.note].filter(Boolean).join(' – ').slice(0, 160),
      status: i.done ? 'done' : 'unread', result: i.done && i.route ? `→ ${INBOX_ROUTES[i.route as keyof typeof INBOX_ROUTES] ?? i.route}` : null,
      link: routeRefLink(i.routeRef, i.route), portal: { id: i.id },
    })),
    ...SCAN.map(({ d, f }): Row => {
      const live = d.drafts.filter((x) => !x.savedId && !x.skipped);
      const held = live.filter((x) => x.status === 'past').length;
      const status: IncomingStatus = d.status === 'queued' || d.status === 'reading' ? 'unread'
        : d.status === 'saved' || (d.status === 'done' && d.drafts.length > 0 && !live.length) ? (d.drafts.every((x) => x.skipped) ? 'skipped' : 'done') : 'read';
      return {
        key: 's' + d.id, at: d.createdAt, src: 'scan', firmId: d.firmId, files: [f], kind: d.kind === 'sale' ? 'out' : 'in', how: '', what: d.drafts.length > 1 ? `${d.drafts.length} фактури во датотеката` : '',
        status, result: d.status === 'error' ? d.error : d.status === 'done' && live.length ? `${live.length} за преглед / зачувување${held ? ` · ⏸ ${held} минат период – за проверка` : ''}` : null,
        link: d.batchId ? { href: `/masovno?b=${d.batchId}`, label: '🧾 Масовно' } : { href: d.kind === 'sale' ? '/skan?k=sale' : '/skan', label: '🧾 Преглед на скенирани' },
      };
    }),
    ...MPIN.map(({ m, f }): Row => ({
      key: 'm' + m.id, at: m.createdAt, src: 'mpin', firmId: m.firmId, files: [f], kind: 'mpin', how: '', what: '',
      status: m.status === 'queued' || m.status === 'reading' ? 'unread' : m.ackId || m.res ? 'done' : 'read', result: m.res ?? m.error,
      link: { href: '/mpinIn', label: '🧮 МПИН' },
    })),
  ];
  const R = rows
    .filter((r) => (!sp.src || r.src === sp.src) && (!sp.st || r.status === sp.st || (sp.st === 'open' && (r.status === 'unread' || r.status === 'read'))) && (!sp.kind || r.kind === sp.kind))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const cnt = (s: IncomingStatus) => rows.filter((r) => r.status === s).length;
  const writable = F.filter((f) => can(u.principal, 'write', f.id)).map((f) => ({ id: f.id, name: f.name }));
  const mayUpload = firm ? can(u.principal, 'write', firm.id) : scope.office;
  const heldN = await heldScanCount(db(), ids);
  const past = heldN && firm && ids.includes(firm.id) ? await pastReviewData(u, firm) : null;
  const busy = rows.some((r) => r.status === 'unread' && r.src !== 'portal' && r.src !== 'capture') || rows.some((r) => r.inc?.aiBusy);

  return (
    <>
      <Hd t="📥 Пристигнати документи" sub={`${cnt('unread')} непрочитани · ${cnt('read')} прочитани · ${cnt('done')} обработени${heldN ? ` · ⏸ ${heldN} минат период` : ''}`}>
        <form className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select name="firm" defaultValue={onlyOffice ? 'office' : ids.length === 1 && want !== 'all' ? ids[0] : 'all'} style={{ width: 'auto', maxWidth: 220 }}>
            <option value="all">Сите мои фирми{scope.office ? ' + канцеларија' : ''}</option>
            {scope.office && <option value="office">🏢 Само канцеларија (без фирма)</option>}
            {F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select name="src" defaultValue={sp.src ?? ''} style={{ width: 'auto' }}><option value="">од секаде</option>{Object.entries(INCOMING_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="kind" defaultValue={sp.kind ?? ''} style={{ width: 'auto' }}><option value="">сите видови</option>{Object.entries(INCOMING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="st" defaultValue={sp.st ?? 'open'} style={{ width: 'auto' }}>
            <option value="open">необработени</option><option value="">сите</option>{Object.entries(INCOMING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn sm">Прикажи</button>
        </form>
      </Hd>
      <AutoRefresh active={busy} />
      {heldN > 0 && !(firm && ids.includes(firm.id)) && <div className="callout warn">⏸ За проверка – минат период: <span className="pill warn">{heldN}</span> документи од минат ДДВ период чекаат одлука. Изберете ја фирмата за да ги видите.</div>}
      {past && <PastReview data={past} hideEmpty />}
      {mayUpload && <InUpload firmId={firm?.id ?? null} office={scope.office} />}
      <p className="note">Тука е сè што пристигнува: прикачено овде, од клиентите (портал, 📷 телефон), скенирано во <Link href="/skan">Скенирање</Link>, МПИН. Пораките од клиентите се и во <Link href="/klInbox">Пристигнато од клиенти</Link>.</p>
      {R.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Пристигнато</th><th>Од каде</th><th>Фирма</th><th>Документ</th><th>Вид</th><th>Статус</th><th>Каде отиде / што понатаму</th></tr></thead>
          <tbody>
            {R.map((r) => {
              const w = r.firmId ? can(u.principal, 'write', r.firmId) : scope.office;
              const off = r.portal ? !!r.firmId && can(u.principal, 'office', r.firmId) : false;
              return (
                <tr key={r.key} style={r.status === 'done' || r.status === 'skipped' ? { opacity: 0.7 } : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dmyHm(r.at)}</td>
                  <td>{INCOMING_SOURCES[r.src]}{r.from ? <><br /><small className="mini">{r.from}</small></> : null}</td>
                  <td>{fname(r.firmId)}</td>
                  <td><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{r.files.map((f) => <FilePreview key={f.id} id={f.id} name={f.name} mime={f.mime} label={<>👁 {f.name}</>} title={`Преглед: ${f.name}`} />)}</div>
                    {r.what && <small className="mini">{r.what}</small>}</td>
                  <td><b>{INCOMING_KINDS[r.kind] ?? r.kind}</b>{r.how && <><br /><small className="mini">({r.how})</small></>}</td>
                  <td><span className={`pill ${PILL[r.status]}`}>{INCOMING_STATUS[r.status]}</span></td>
                  <td style={{ minWidth: 280 }}>
                    {r.link && <Link className="btn sm ghost" href={r.link.href}>{r.link.label}</Link>} {r.result && <small className="mini">{r.result}</small>}
                    {r.inc && w && (
                      <InActions id={r.inc.id} kind={r.kind} firmId={r.firmId} status={r.status} proposed={r.inc.proposed} needsAi={r.inc.needsAi} aiBusy={r.inc.aiBusy}
                        firms={r.status === 'done' ? [] : writable} canAi={!!r.firmId && can(u.principal, 'office', r.firmId) && !u.principal.demo} />
                    )}
                    {r.portal && off && r.status !== 'done' && r.files.length > 0 && <PortalActions itemId={r.portal.id} kind={r.kind} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема документи за избраните услови.</div>}
    </>
  );
}
