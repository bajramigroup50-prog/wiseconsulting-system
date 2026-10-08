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
import { deleteContact, deleteDossierDoc, saveContact, saveDeadline, saveDossierDoc, setDeadlineDone } from './actions';

export default async function DosiePage() {
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

  return (
    <>
      <Hd t="🗂 Досие на фирмата" sub={`${firm.name} · ${docs.length} документи`} />
      {missingFresh.length > 0 && <div className="callout warn">Нема: {missingFresh.join(', ')} – банките и институциите бараат тековна состојба не постара од 3 / 6 месеци.</div>}
      {pend.length > 0 && <div className="callout">⏳ {pend.length} документи испратени од клиентот чекаат одобрување во <a href="/klInbox">Пристигнато од клиенти</a>.</div>}

      {write && (
        <ActionForm action={saveDossierDoc}>
          <h2>+ Нов документ во досието</h2>
          <div className="form">
            <label className="f">Категорија<select name="category" required defaultValue="">
              <option value="" disabled>— изберете —</option>
              {DOS_CAT.map((c) => <option key={c}>{c}</option>)}
            </select></label>
            <label className="f">Наслов<input name="title" placeholder="на пр. Тековна состојба" /></label>
            <label className="f">Број<input name="number" /></label>
            <label className="f">Датум<input name="date" type="date" /></label>
            <label className="f">Важи до<input name="validTo" type="date" /></label>
            <label className="f wide">Белешка<input name="note" /></label>
            <UploadField firmId={firm.id} capture accept="image/*,application/pdf" label="📷 Скенирај / прикачи страници" />
          </div>
          <div className="row"><button className="btn pri">Зачувај</button></div>
        </ActionForm>
      )}

      {DOS_CAT.filter((c) => byCat.has(c)).map((c) => (
        <div className="card" key={c}>
          <h2 style={{ fontSize: 15 }}>{c}</h2>
          <div className="tw"><table className="dense">
            <thead><tr><th>Документ</th><th>Број</th><th>Датум</th><th>Важи до</th><th>Страници</th><th></th></tr></thead>
            <tbody>
              {byCat.get(c)!.map((d) => {
                const fr = freshness(d, td), ex = expiry(d, td);
                return (
                  <tr key={d.id}>
                    <td><b>{d.title || c}</b>{d.note && <div className="mini" style={{ display: 'block' }}>{d.note}</div>}</td>
                    <td>{d.number}</td>
                    <td>{dmy(d.date)} {fr && <Pill c={fr.lvl} title={fr.title}>{fr.text}</Pill>}</td>
                    <td>{ex ? ex.lvl === 'bad' ? <Pill c="bad">истечен {dmy(d.validTo)}</Pill> : ex.lvl === 'warn' ? <Pill c="warn">истекува за {ex.days} дена</Pill> : dmy(d.validTo) : <span className="note">—</span>}</td>
                    <td><FileChips files={F.get(d.id)} /></td>
                    <td>{del && <RowAction action={deleteDossierDoc.bind(null, d.id)} label="Избриши" confirm={`Да се избрише „${d.title || c}“ од досието?`} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      ))}
      {!docs.length && <div className="card empty">Досието е празно.</div>}

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
      {/* TODO(mail): legacy `dosMail` / `dosShare` (send selected documents by e-mail) → Phase 6 `mail.send`. Packages: see /paket. */}
    </>
  );
}
