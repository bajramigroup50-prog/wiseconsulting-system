/** Legacy `VIEWS.dosie` 8028 → 12788 → **12808** — firm dossier: documents by category, contacts, deadlines. */
import { and, asc, desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { DOS_CAT, DOS_FRESH, expiry, freshness } from '@wise/core/office';
import { clientEntries, dossierDocs, firmContacts, firmDeadlines, OFFICE_FILE_ENTITY } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips, Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { SendExtras } from '@/components/send-extras';
import { deleteContact, deleteDossierDoc, mailDossierDocs, saveContact, saveDeadline, saveDossierDoc, setDeadlineDone } from './actions';

type SP = { q?: string; cat?: string; nov?: string; edit?: string; mail?: string; id?: string | string[] };

export default async function DosiePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('dosie');
  if (!firm) return <NoFirm t="🗂 Досие на фирмата" />;
  const td = today();
  const [docs, contacts, deadlines, pend] = await Promise.all([
    db().select().from(dossierDocs).where(eq(dossierDocs.firmId, firm.id)).orderBy(asc(dossierDocs.category), desc(dossierDocs.date)),
    db().select().from(firmContacts).where(eq(firmContacts.firmId, firm.id)).orderBy(asc(firmContacts.name)),
    db().select().from(firmDeadlines).where(eq(firmDeadlines.firmId, firm.id)).orderBy(asc(firmDeadlines.done), asc(firmDeadlines.due)),
    db().select().from(clientEntries).where(and(eq(clientEntries.firmId, firm.id), eq(clientEntries.kind, 'dossier'), eq(clientEntries.status, 'pending'))),
  ]);
  const F = await filesOf(OFFICE_FILE_ENTITY.dossier, docs.map((d) => d.id));
  const write = can(u.principal, 'write', firm.id), office = can(u.principal, 'office', firm.id), del = can(u.principal, 'del', firm.id);
  const byCat = new Map<string, typeof docs>();
  for (const d of docs) byCat.set(d.category, [...(byCat.get(d.category) ?? []), d]);
  const missingFresh = DOS_FRESH.filter((c) => !byCat.has(c));
  // legacy: the newest of each kind is „најнова“, the others „постара верзија“; stale current-state extracts warn (3 / 6 months)
  const newest = new Map<string, string>();
  for (const [c, L] of byCat) { const top = [...L].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))[0]; if (top) newest.set(c, top.id); }
  const addM = (d: string, m: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
  const stale = DOS_FRESH.map((c) => docs.find((d) => d.id === newest.get(c))).filter((d): d is (typeof docs)[number] => !!d && td > addM(d.date ?? '1900-01-01', 3));
  const alerts = docs.filter((d) => { const e = expiry(d, td); return !!e && e.lvl !== 'good'; });
  const q = (sp.q ?? '').trim().toLowerCase(), cat = sp.cat ?? '';
  const shown = docs.filter((d) => (!cat || d.category === cat) && (!q || [d.category, d.title, d.number, d.note, ...(F.get(d.id) ?? []).map((x) => x.name)].join(' ').toLowerCase().includes(q)));
  const sel = new Set([sp.id ?? []].flat());
  const editing = sp.edit ? docs.find((d) => d.id === sp.edit) : undefined;
  const showForm = write && (sp.nov !== undefined || !!editing);

  return (
    <>
      <Hd t="Документи на фирмата" sub={`${firm.name} · ${docs.length} документи`}>
        {write && <>
          <a className="btn" href={`/dosie?nov=${encodeURIComponent('Тековна состојба (ЦРМ)')}`}>📷 Нова тековна состојба</a>
          <a className="btn" href={`/dosie?nov=${encodeURIComponent('Тековна состојба – вистински сопственик (ЦРМ)')}`}>📷 Нова – вистински сопственик</a>
          <a className="btn pri" href="/dosie?nov">+ Нов документ / скенирај</a>
        </>}
      </Hd>
      {stale.length > 0 && <div className="callout warn">{stale.map((d) => <span key={d.id}><b>{d.category}</b>: најновата е од {dmy(d.date)} – {td > addM(d.date ?? '1900-01-01', 6) ? 'постара од 6 месеци' : 'постара од 3 месеци'}. Кога ќе извадите нова, скенирајте ја – старите остануваат во архивата.<br /></span>)}</div>}
      {alerts.length > 0 && <div className="callout warn"><b>Рокови:</b> {alerts.map((d) => `${d.title || d.category} – ${(d.validTo ?? '') < td ? 'истечен на ' : 'истекува на '}${dmy(d.validTo)}`).join(' · ')}</div>}
      {missingFresh.length > 0 && <div className="callout warn">Нема: {missingFresh.join(', ')} – банките и институциите бараат тековна состојба не постара од 3 / 6 месеци.</div>}
      {pend.length > 0 && <div className="callout">⏳ {pend.length} документи испратени од клиентот чекаат одобрување во <a href="/klInbox">Пристигнато од клиенти</a>.</div>}

      {showForm && (
        <ActionForm action={saveDossierDoc} reset={!editing}>
          <h2>{editing ? '✎ Промени документ' : '+ Нов документ во досието'}</h2>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="form">
            <label className="f">Категорија<select name="category" required defaultValue={editing?.category ?? (DOS_CAT as readonly string[]).find((c) => c === sp.nov) ?? ''}>
              <option value="" disabled>— изберете —</option>
              {DOS_CAT.map((c) => <option key={c}>{c}</option>)}
            </select></label>
            <label className="f">Наслов<input name="title" placeholder="на пр. Тековна состојба" defaultValue={editing?.title ?? ''} /></label>
            <label className="f">Број<input name="number" defaultValue={editing?.number ?? ''} /></label>
            <label className="f">Датум<input name="date" type="date" defaultValue={editing?.date ?? td} /></label>
            <label className="f">Важи до<input name="validTo" type="date" defaultValue={editing?.validTo ?? ''} /></label>
            <label className="f wide">Белешка<input name="note" defaultValue={editing?.note ?? ''} /></label>
            <UploadField firmId={firm.id} capture accept="image/*,application/pdf" label={editing ? '📷 Додај страници' : '📷 Скенирај / прикачи страници'} />
          </div>
          <div className="row"><a className="btn" href="/dosie">Откажи</a><button className="btn pri">Зачувај</button></div>
        </ActionForm>
      )}

      <form className="card" method="get" action="/dosie">
        <div className="row" style={{ gap: '10px 16px', alignItems: 'end', flexWrap: 'wrap' }}>
          <input name="q" placeholder="Барај назив, број, датотека…" defaultValue={sp.q ?? ''} style={{ width: 260 }} />
          <label className="mini">Вид <select name="cat" defaultValue={cat} style={{ width: 'auto' }}><option value="">сите</option>{[...new Set([...DOS_CAT, ...docs.map((d) => d.category)])].map((c) => <option key={c}>{c}</option>)}</select></label>
          <button className="btn">Барај</button>
          <span style={{ flex: 1 }} />
          <span className="mini">Штиклирајте документи подолу:</span>
          <button className="btn pri" name="mail" value="1">✉ Испрати по е-пошта</button>
          <button className="btn" formAction="/dosie/wa" style={{ borderColor: '#25D366' }}>💬 WhatsApp / Viber</button>
          <button className="btn" formAction="/dosie/zip">⬇ Преземи</button>
        </div>
        {[...new Set([...DOS_CAT, ...shown.map((d) => d.category)])].filter((c) => shown.some((d) => d.category === c)).map((c) => (
          <div key={c}>
            <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>{c}</h3>
            <div className="tw"><table>
              <thead><tr><th style={{ width: 28 }}></th><th>Назив</th><th>Број</th><th>Издаден / старост</th><th>Архивирано</th><th>Важи до</th><th>Датотеки</th><th></th></tr></thead>
              <tbody>
                {shown.filter((d) => d.category === c).map((d) => {
                  const fr = freshness(d, td), ex = expiry(d, td), many = (byCat.get(c)?.length ?? 0) > 1, isNew = newest.get(c) === d.id;
                  return (
                    <tr key={d.id}>
                      <td><input type="checkbox" name="id" value={d.id} defaultChecked={sel.has(d.id)} /></td>
                      <td style={many && !isNew ? { opacity: 0.6 } : undefined}><b>{d.title || c}</b>{many && (isNew ? <> <span className="pill info">најнова</span></> : <> <span className="pill">постара верзија</span></>)}{d.note && <div className="mini" style={{ display: 'block' }}>{d.note}</div>}</td>
                      <td>{d.number}</td>
                      <td>{dmy(d.date)} {fr && <Pill c={fr.lvl} title={fr.title}>{fr.text}</Pill>}</td>
                      <td className="mini">{dmy(d.createdAt)}</td>
                      <td>{ex ? ex.lvl === 'bad' ? <Pill c="bad">истечен {dmy(d.validTo)}</Pill> : ex.lvl === 'warn' ? <Pill c="warn">истекува за {ex.days} дена</Pill> : dmy(d.validTo) : <span className="note">—</span>}</td>
                      <td><FileChips files={F.get(d.id)} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {F.get(d.id)?.[0] && <a className="btn sm" href={`/api/files/${F.get(d.id)![0]!.id}`} target="_blank" rel="noopener" title="Погледни го документот">👁</a>}
                        <a className="btn sm" href={`/dosie?mail=1&id=${d.id}`} title="Испрати по е-пошта">✉</a>
                        <a className="btn sm" href={`/dosie/wa?id=${d.id}`} title="WhatsApp / Viber">💬</a>
                        {write && <a className="btn sm" href={`/dosie?edit=${d.id}`} title="Промени">✎</a>}
                        {del && <RowAction action={deleteDossierDoc.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише „${d.title || c}“ од досието?`} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        ))}
        {docs.length > 0 && !shown.length && <p className="note">Нема документи за избраниот филтер.</p>}
      </form>
      {!docs.length && <div className="card empty">Нема документи. Притиснете „+ Нов документ / скенирај“ – на телефон се отвора камерата, на компјутер изберете PDF или слика.</div>}
      <p className="note">Документите се чуваат трајно во програмот за оваа фирма и се гледаат и во „Архива на документи“. За секој документ со рок (тековна состојба, лиценци, дозволи) внесете „Важи до“ – програмот ве предупредува 30 дена пред истекот.</p>

      {u.role !== 'klient' && (
        <div className="grid2" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
          <div className="card">
            <h2 style={{ fontSize: 15 }}>👤 Контакти</h2>
            {contacts.length ? (
              <table className="dense"><tbody>
                {contacts.map((c) => (
                  <tr key={c.id}><td><b>{c.name}</b> {c.role && <span className="mini">{c.role}</span>}</td><td>{c.email}</td><td>{c.phone}</td>
                    <td>{office && <RowAction action={deleteContact.bind(null, c.id)} label="✕" confirm={`Да се избрише ${c.name}?`} />}</td></tr>
                ))}
              </tbody></table>
            ) : <p className="note">Нема зачувани контакти.</p>}
            {office && (
              <ActionForm action={saveContact} className="">
                <div className="form">
                  <label className="f">Име<input name="name" required /></label>
                  <label className="f">Функција<input name="role" /></label>
                  <label className="f">Е-пошта<input name="email" type="email" /></label>
                  <label className="f">Телефон<input name="phone" /></label>
                </div>
                <button className="btn sm">+ Додај контакт</button>
              </ActionForm>
            )}
          </div>
          <div className="card">
            <h2 style={{ fontSize: 15 }}>⏰ Рокови</h2>
            {deadlines.length ? (
              <table className="dense"><tbody>
                {deadlines.map((d) => {
                  const late = !d.done && d.due < td;
                  return (
                    <tr key={d.id} style={d.done ? { opacity: 0.55 } : undefined}>
                      <td style={late ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(d.due)}</td><td>{d.title}</td>
                      <td>{office && <RowAction action={setDeadlineDone.bind(null, d.id, !d.done)} label={d.done ? '↺' : '✓ Завршено'} />}</td>
                    </tr>
                  );
                })}
              </tbody></table>
            ) : <p className="note">Нема рокови.</p>}
            {office && (
              <ActionForm action={saveDeadline} className="">
                <div className="form">
                  <label className="f">Опис<input name="title" required /></label>
                  <label className="f">Рок<input name="due" type="date" required /></label>
                  <label className="f">Потсетник (дена пред)<input name="remindDays" type="number" min={0} defaultValue={7} /></label>
                </div>
                <button className="btn sm">+ Додај рок</button>
              </ActionForm>
            )}
          </div>
        </div>
      )}
      {/* legacy `dosMail` / `dosShare`: send selected documents by e-mail (packages with a cover letter: /paket) */}
      {write && sp.mail && docs.some((d) => F.get(d.id)?.length) && (
        <ActionForm action={mailDossierDocs}>
          <h2 style={{ fontSize: 15 }}>✉ Испрати документи по е-пошта</h2>
          <div className="row" style={{ gap: '4px 14px', flexWrap: 'wrap' }}>
            {docs.filter((d) => F.get(d.id)?.length).map((d) => (
              <label key={d.id} className="chk"><input type="checkbox" name="docId" value={d.id} defaultChecked={sel.has(d.id)} /> {d.title || d.category}{d.date ? ` (${dmy(d.date)})` : ''}</label>
            ))}
          </div>
          <div className="form">
            <label className="f">До (е-пошта)<input name="to" type="email" required defaultValue={firm.email ?? ''} /></label>
            <label className="f">Наслов<input name="subject" placeholder={`Документи – ${firm.name}`} /></label>
            <label className="f wide">Порака<textarea name="note" rows={3} defaultValue={'Почитувани,\n\nВо прилог Ви ги доставуваме документите.'} /></label>
          </div>
          <div className="row"><button className="btn pri">✉ Испрати по е-пошта</button> <a className="btn ghost" href="/paket">📦 Пакет документи</a></div>
          <SendExtras selName="docId" zipHref="/dosie/zip" defaultBody={'Почитувани,\n\nВо прилог Ви ги доставуваме документите.'} files={Object.fromEntries(docs.map((d) => [d.id, (F.get(d.id) ?? []).map((x) => ({ id: x.id, name: x.name }))]))} />
        </ActionForm>
      )}
    </>
  );
}
