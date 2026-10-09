/** Legacy `VIEWS.klInbox` 9072 → **14035** — what clients sent: pending entries to approve, documents/messages to route. */
import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CLIENT_ENTRY_KINDS, DOS_CAT, INBOX_ROUTES } from '@wise/core/office';
import { clientEntries, inboxItems, OFFICE_FILE_ENTITY, users } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, filesOf, officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { fmt } from '@/lib/fmt';
import { decideEntry, replyToClient, routeInbox } from './actions';
import { AutoRoute } from './auto-route';

export default async function KlInboxPage({ searchParams }: { searchParams: Promise<{ firm?: string; all?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('klInbox', { perm: 'office' });
  const F = await allowedFirms(u);
  const only = sp.firm === 'all' ? null : (sp.firm && F.some((f) => f.id === sp.firm) ? sp.firm : null);
  const ids = only ? [only] : F.map((f) => f.id);
  const fname = (id: string) => F.find((f) => f.id === id)?.name ?? '';
  if (!ids.length) return <><Hd t="📥 Пристигнато од клиенти" /><div className="card empty">Немате доделени фирми.</div></>;
  const [pend, inbox] = await Promise.all([
    db().select({ e: clientEntries, by: users.name }).from(clientEntries).leftJoin(users, eq(users.id, clientEntries.submittedBy))
      .where(and(inArray(clientEntries.firmId, ids), eq(clientEntries.status, 'pending'))).orderBy(desc(clientEntries.submittedAt)),
    db().select().from(inboxItems).where(and(inArray(inboxItems.firmId, ids), eq(inboxItems.fromOffice, false), sp.all ? undefined : eq(inboxItems.done, false)))
      .orderBy(desc(inboxItems.createdAt)).limit(200),
  ]);
  const [PF, IF] = await Promise.all([filesOf(OFFICE_FILE_ENTITY.clientEntry, pend.map((p) => p.e.id)), filesOf(OFFICE_FILE_ENTITY.inbox, inbox.map((i) => i.id))]);

  return (
    <>
      <Hd t="📥 Пристигнато од клиенти" sub={`${pend.length} за одобрување · ${inbox.filter((i) => !i.done).length} пораки`}>
        <form className="row" style={{ gap: 6 }}>
          <select name="firm" defaultValue={only ?? 'all'} style={{ width: 'auto' }}>
            <option value="all">Сите фирми</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <label className="chk"><input type="checkbox" name="all" value="1" defaultChecked={!!sp.all} /> и обработените</label>
          <button className="btn sm">Прикажи</button>
        </form>
      </Hd>

      <div className="card" style={{ borderLeft: '4px solid #e08a00' }}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>⏳ Внесено од клиентот – чека ваше одобрување ({pend.length})</h2>
        <p className="note" style={{ margin: '0 0 8px' }}>Овие документи <b>не се прокнижени</b>: не влегуваат во налози, ДДВ и залиха додека не ги одобрите.</p>
        {pend.length ? (
          <div className="tw"><table className="dense">
            <thead><tr><th>Внесено</th><th>Од</th><th>Фирма</th><th>Вид</th><th>Број</th><th>Датум</th><th>Комитент</th><th className="n">Износ</th><th>Прилог</th><th></th></tr></thead>
            <tbody>
              {pend.map(({ e, by }) => {
                const d = e.data as { number?: string; date?: string; partnerName?: string; total?: number; category?: string; title?: string };
                return (
                  <tr key={e.id}>
                    <td>{dmyHm(e.submittedAt)}</td><td>{by}</td><td>{fname(e.firmId)}</td>
                    <td>{CLIENT_ENTRY_KINDS[e.kind as keyof typeof CLIENT_ENTRY_KINDS] ?? e.kind}</td>
                    <td>{d.number ?? d.title ?? d.category}</td><td>{dmy(d.date)}</td><td>{d.partnerName}</td>
                    <td className="n">{d.total != null ? fmt(d.total) : ''}</td><td><FileChips files={PF.get(e.id)} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <RowAction className="btn sm pri" action={decideEntry.bind(null, e.id, 'approve', undefined)} label="✓ Одобри" />{' '}
                      <RowAction className="btn sm ghost" style={{ color: 'var(--bad)' }} action={decideEntry.bind(null, e.id, 'reject', undefined)} label="✕ Одбиј" confirm="Да се одбие внесот?" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <p className="note">Нема внесови што чекаат.</p>}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15 }}>✉ Документи и пораки</h2>
        {inbox.length ? inbox.map((i) => (
          <div key={i.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0', ...(i.done ? { opacity: 0.6 } : {}) }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <span><span className="mini">{dmyHm(i.createdAt)}</span> <b>{fname(i.firmId)}</b> · {i.fromName} {i.subject && <>· <b>{i.subject}</b></>}</span>
              {i.done && <span className="pill good">обработено{i.route ? ` → ${INBOX_ROUTES[i.route as keyof typeof INBOX_ROUTES] ?? i.route}` : ''}</span>}
            </div>
            {i.note && <div style={{ whiteSpace: 'pre-line' }}>{i.note}</div>}
            <FileChips files={IF.get(i.id)} />
            {!i.done && (
              <ActionForm action={routeInbox} className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                <input type="hidden" name="id" value={i.id} />
                <select name="route" defaultValue="" style={{ width: 'auto' }}>
                  <option value="">Само означи како обработено</option>
                  {Object.entries(INBOX_ROUTES).map(([k, v]) => <option key={k} value={k}>→ {v}</option>)}
                </select>
                <select name="category" defaultValue="Друго" style={{ width: 'auto' }} title="Категорија (за досие)">
                  {DOS_CAT.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button className="btn sm pri">✓ Обработи</button>
                {(IF.get(i.id)?.length ?? 0) > 0 && <AutoRoute itemId={i.id} />}
              </ActionForm>
            )}
          </div>
        )) : <p className="note">Нема нови документи од клиентите.</p>}
      </div>

      <ActionForm action={replyToClient}>
        <h2 style={{ fontSize: 15 }}>Порака до клиент (портал)</h2>
        <div className="form">
          <label className="f">Фирма<select name="firmId" defaultValue={firm?.id ?? ''} required>
            <option value="" disabled>— изберете —</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></label>
          <label className="f">Наслов<input name="subject" /></label>
          <label className="f wide">Порака<textarea name="note" rows={3} required /></label>
        </div>
        <div className="row"><button className="btn pri">Испрати</button> <Link className="btn ghost" href="/klPortal">Поставки на порталот</Link></div>
      </ActionForm>
    </>
  );
}
