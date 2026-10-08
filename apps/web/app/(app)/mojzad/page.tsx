/** Legacy `VIEWS.mojzad` 3918 — "my tasks" for field workers (teren) and anyone with assigned tasks. */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { TST, taskLate, type TaskStatus } from '@wise/core/office';
import { firms, OFFICE_FILE_ENTITY, officeTasks } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips, Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { attachTaskFiles, terenAction } from '../kanc/actions';

export default async function MojzadPage() {
  const { u } = await officePage('mojzad');
  const rows = await db().select({ t: officeTasks, f: { name: firms.name, edb: firms.edb, address: firms.address, city: firms.city, phone: firms.phone } })
    .from(officeTasks).leftJoin(firms, eq(firms.id, officeTasks.firmId))
    .where(or(eq(officeTasks.assigneeId, u.id), and(isNull(officeTasks.assigneeId), eq(officeTasks.status, 'new'))))
    .orderBy(sql`${officeTasks.due} asc nulls last`);
  const mine = rows.filter((r) => r.t.assigneeId === u.id);
  const open = mine.filter((r) => r.t.status !== 'done');
  const done = mine.filter((r) => r.t.status === 'done').sort((a, b) => +(b.t.doneAt ?? 0) - +(a.t.doneAt ?? 0)).slice(0, 10);
  const free = rows.filter((r) => !r.t.assigneeId);
  const F = await filesOf(OFFICE_FILE_ENTITY.task, mine.map((r) => r.t.id));
  const td = today();

  const card = ({ t, f }: (typeof rows)[number]) => (
    <div key={t.id} className="card" style={{ gap: 8, ...(taskLate(t, td) ? { borderColor: 'var(--bad)' } : {}) }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{t.title}{t.prio === 'high' ? ' 🔴' : ''}</b>
        <Pill c={TST[t.status as TaskStatus]?.[1]}>{TST[t.status as TaskStatus]?.[0] ?? t.status}</Pill>
      </div>
      <div className="mini">{t.inst} · {t.type}{t.due && <> · рок <b>{dmy(t.due)}</b></>}</div>
      {f?.name && <div><b>{f.name}</b><div className="mini" style={{ display: 'block' }}>ЕДБ {f.edb} · {[f.address, f.city].filter(Boolean).join(', ')}{f.phone ? ` · ${f.phone}` : ''}</div></div>}
      {t.description && <div style={{ whiteSpace: 'pre-line' }}>{t.description}</div>}
      <FileChips files={F.get(t.id)} />
      {t.status !== 'done' && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {['new', 'assigned'].includes(t.status) && <RowAction className="btn pri" action={terenAction.bind(null, t.id, 'progress', '')} label="▶ Прифати / започни" />}
            <RowAction className="btn pri" style={{ background: 'var(--good,#1a7f4b)', borderColor: 'var(--good,#1a7f4b)' }} action={terenAction.bind(null, t.id, 'done', '')} label="✓ Заврши" />
            <RowAction className="btn" action={terenAction.bind(null, t.id, 'problem', '')} label="⚠ Проблем" />
          </div>
          <ActionForm action={attachTaskFiles} className="">
            <input type="hidden" name="id" value={t.id} />
            <UploadField firmId={null} capture accept="image/*,application/pdf" label="📷 Скенирај / прикачи" />
            <label className="f">Примено (опис)<input name="received" placeholder="на пр. Решение бр. …" /></label>
            <button className="btn sm">Зачувај прикачени</button>
          </ActionForm>
        </>
      )}
    </div>
  );

  return (
    <>
      <Hd t="Мои задачи" sub={u.name} />
      {open.length ? <div style={{ display: 'grid', gap: 12 }}>{open.map(card)}</div> : <div className="card empty">Немате отворени задачи. 👍</div>}
      {free.length > 0 && (
        <>
          <h2 style={{ margin: '18px 0 6px' }}>Слободни задачи (недоделени)</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {free.map(({ t, f }) => (
              <div key={t.id} className="card row" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span><b>{t.title}</b> · {t.inst} · {f?.name ?? ''}{t.due ? ` · рок ${dmy(t.due)}` : ''}</span>
                <RowAction className="btn sm pri" action={terenAction.bind(null, t.id, 'take', '')} label="Преземи" />
              </div>
            ))}
          </div>
        </>
      )}
      {done.length > 0 && <details style={{ marginTop: 16 }}><summary>Завршени (последни {done.length})</summary><div style={{ display: 'grid', gap: 10, marginTop: 8 }}>{done.map(card)}</div></details>}
    </>
  );
}
