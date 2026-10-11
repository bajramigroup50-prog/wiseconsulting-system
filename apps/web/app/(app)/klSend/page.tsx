/** Legacy `VIEWS.klSend` 9066 — client portal: send a document to the office or enter a document for approval. */
import { and, desc, eq } from 'drizzle-orm';
import { CLIENT_ENTRY_KINDS } from '@wise/core/office';
import { clientEntries, inboxItems, OFFICE_FILE_ENTITY } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf, officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips, Pill } from '@/components/file-chips';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { UploadField } from '@/components/upload-field';
import { fmt } from '@/lib/fmt';
import { sendToOffice, submitEntry } from './actions';

const ST: Record<string, [string, string]> = { pending: ['чека одобрување', 'warn'], approved: ['одобрено', 'good'], rejected: ['одбиено', 'bad'] };

export default async function KlSendPage() {
  const { u, firm } = await officePage('klSend', { perm: 'write' });
  if (!firm) return <NoFirm t="📤 Испрати документ" />;
  const [sent, entries] = await Promise.all([
    db().select().from(inboxItems).where(and(eq(inboxItems.firmId, firm.id), eq(inboxItems.fromOffice, false), eq(inboxItems.fromUserId, u.id))).orderBy(desc(inboxItems.createdAt)).limit(20),
    db().select().from(clientEntries).where(and(eq(clientEntries.firmId, firm.id), eq(clientEntries.submittedBy, u.id))).orderBy(desc(clientEntries.submittedAt)).limit(30),
  ]);
  const F = await filesOf(OFFICE_FILE_ENTITY.inbox, sent.map((s) => s.id));
  return (
    <>
      <Hd t="📤 Испрати документ" sub={firm.name} />
      <ActionForm action={sendToOffice}>
        <h2>Фотографирај или прикачи – оди во канцеларијата</h2>
        <div className="form">
          <label className="f">Наслов<input name="subject" placeholder="на пр. Фактури за септември" /></label>
          <label className="f wide">Порака / опис<textarea name="note" rows={2} placeholder="на пр. Фактура од Макпетрол за гориво, извод од 15.10…" /></label>
          <UploadField firmId={firm.id} capture accept="image/*,application/pdf,.xml,.xlsx,.xls,.csv,.sta,.300" camLabel="📷 Фотографирај" label="📎 Прикачи (фактура, извод, договор…)" />
        </div>
        <div className="row"><button className="btn pri">Испрати</button></div>
      </ActionForm>

      <ActionForm action={submitEntry}>
        <h2>Внеси документ (чека одобрување од канцеларијата)</h2>
        <p className="note" style={{ margin: 0 }}>Внесеното <b>не се книжи</b> додека канцеларијата не го провери и одобри.</p>
        <div className="form">
          <label className="f">Вид<select name="kind" defaultValue="purchase">
            {(['purchase', 'invoice', 'sale'] as const).map((k) => <option key={k} value={k}>{CLIENT_ENTRY_KINDS[k]}</option>)}
          </select></label>
          <label className="f">Број<input name="number" /></label>
          <label className="f">Датум<input name="date" type="date" required /></label>
          <label className="f">Валута<input name="due" type="date" /></label>
          <label className="f">Комитент<input name="partnerName" /></label>
          <label className="f">ЕДБ на комитентот<input name="partnerEdb" /></label>
          <label className="f">Вкупно со ДДВ<input name="total" inputMode="decimal" required /></label>
          <label className="f">од тоа ДДВ<input name="vat" inputMode="decimal" /></label>
          <label className="f wide">Белешка<input name="note" /></label>
          <UploadField firmId={firm.id} capture accept="image/*,application/pdf" camLabel="📷 Слика од документот" label="📎 Прикачи" />
        </div>
        <div className="row"><button className="btn pri">Внеси</button></div>
      </ActionForm>

      {entries.length > 0 && (
        <div className="card"><h2 style={{ fontSize: 15 }}>Мои внесови</h2>
          <table className="dense"><thead><tr><th>Внесено</th><th>Вид</th><th>Број</th><th>Датум</th><th className="n">Износ</th><th>Статус</th></tr></thead><tbody>
            {entries.map((e) => {
              const d = e.data as { number?: string; date?: string; total?: number; category?: string };
              return <tr key={e.id}><td>{dmyHm(e.submittedAt)}</td><td>{CLIENT_ENTRY_KINDS[e.kind as keyof typeof CLIENT_ENTRY_KINDS] ?? e.kind}</td><td>{d.number ?? d.category}</td><td>{dmy(d.date)}</td>
                <td className="n">{d.total != null ? fmt(d.total) : ''}</td><td><Pill c={ST[e.status]?.[1]}>{ST[e.status]?.[0] ?? e.status}</Pill>{e.decisionNote && <span className="mini"> {e.decisionNote}</span>}</td></tr>;
            })}
          </tbody></table></div>
      )}
      {sent.length > 0 && (
        <div className="card"><h2 style={{ fontSize: 15 }}>Испратени пораки</h2>
          <table className="dense"><tbody>
            {sent.map((s) => <tr key={s.id}><td>{dmyHm(s.createdAt)}</td><td>{s.subject ?? ''} {s.note}</td><td><FileChips files={F.get(s.id)} /></td><td>{s.done ? <Pill c="good">примено</Pill> : <Pill c="info">испратено</Pill>}</td></tr>)}
          </tbody></table></div>
      )}
    </>
  );
}
