/** Legacy `VIEWS.kdogovori` … **15514** — accounting-service contracts (numbered `СУ-001/2026`), Word from templates. */
import { and, desc, eq } from 'drizzle-orm';
import { serviceContracts, wordTemplates } from '@wise/db';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { fmt } from '@/lib/fmt';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { saveContract, setContractStatus } from './actions';

const ST: Record<string, [string, string]> = { draft: ['нацрт', 'info'], signed: ['потпишан', 'good'], ended: ['раскинат', ''] };

export default async function KdogovoriPage() {
  const { firm } = await officePage('kdogovori', { perm: 'office' });
  if (!firm) return <NoFirm t="✍ Договор за сметководствени услуги" />;
  const [L, T] = await Promise.all([
    db().select().from(serviceContracts).where(eq(serviceContracts.firmId, firm.id)).orderBy(desc(serviceContracts.date)),
    db().select().from(wordTemplates).where(and(eq(wordTemplates.kind, 'kd'), eq(wordTemplates.active, true))),
  ]);
  return (
    <>
      <Hd t="✍ Договор за сметководствени услуги" sub={firm.name} />
      <ActionForm action={saveContract}>
        <h2>Нов договор</h2>
        <div className="form">
          <label className="f">Датум<input name="date" type="date" defaultValue={today()} /></label>
          <label className="f">Место<input name="place" defaultValue="Скопје" /></label>
          <label className="f">Важи од<input name="start" type="date" /></label>
          <label className="f">Важи до<input name="end" type="date" /></label>
          <label className="f">Месечен надоместок (ден.)<input name="fee" inputMode="decimal" required /></label>
          <label className="f">По вработен (ден.)<input name="feeEmp" inputMode="decimal" /></label>
          <label className="f">Плаќање до (ден во месецот)<input name="payDay" /></label>
          <label className="f">Застапник на клиентот<input name="rep" /></label>
          <label className="f">Функција<input name="repRole" defaultValue="Управител" /></label>
          <label className="f wide">Услуги<textarea name="svc" rows={2} defaultValue="Водење деловни книги, пресметка на плати, ДДВ пријави, завршна сметка" /></label>
          <label className="f wide">Напомена<input name="note" /></label>
        </div>
        <div className="row"><button className="btn pri">Зачувај (нов број)</button></div>
      </ActionForm>
      {L.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Број</th><th>Датум</th><th>Важи</th><th className="n">Надоместок</th><th>Статус</th><th></th></tr></thead>
          <tbody>{L.map((c) => {
            const d = c.data as { svc?: string; place?: string; rep?: string; repRole?: string; note?: string };
            const q = new URLSearchParams({ ДОГОВОР_БРОЈ: c.number, ДАТУМ_ДОГОВОР: dmy(c.date), МЕСТО_ДОГОВОР: d.place ?? '', НАДОМЕСТ: fmt(c.fee), УСЛУГИ: d.svc ?? '', ПРЕТСТАВНИК: d.rep ?? '', ПРЕТСТАВНИК_ФУНКЦИЈА: d.repRole ?? '', НАПОМЕНА: d.note ?? '' });
            return (
              <tr key={c.id}>
                <td><b>{c.number}</b></td><td>{dmy(c.date)}</td><td>{dmy(c.start)} – {c.end ? dmy(c.end) : 'неопределено'}</td>
                <td className="n">{fmt(c.fee)}</td><td><Pill c={ST[c.status]?.[1]}>{ST[c.status]?.[0] ?? c.status}</Pill></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {T.map((t) => <a key={t.id} className="btn sm" href={`/api/office/tpl/${t.id}?${q}`}>⬇ {t.name}</a>)}
                  {c.status === 'draft' && <RowAction action={setContractStatus.bind(null, c.id, 'signed')} label="✓ Потпишан" />}
                  {c.status === 'signed' && <RowAction action={setContractStatus.bind(null, c.id, 'ended')} label="Раскини" confirm="Да се означи договорот како раскинат?" />}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : <div className="card empty">Нема договор.</div>}
      {!T.length && <p className="note">За Word верзија прикачете шаблон од вид „Договор за сметководствени услуги“ во <a href="/tpl">Шаблони</a>.</p>}
    </>
  );
}
