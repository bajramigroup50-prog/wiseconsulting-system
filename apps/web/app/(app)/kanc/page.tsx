/** Legacy `VIEWS.kanc` 3886 — office task board (requests to institutions, field work). */
import Link from 'next/link';
import { asc, eq, sql } from 'drizzle-orm';
import { INST, TASK_STATUS, TST, TTYPE, taskLate, type TaskStatus } from '@wise/core/office';
import { firms, formationCases, OFFICE_FILE_ENTITY, officeTasks, users } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, filesOf, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips, Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { deleteTask, saveTask, setTaskStatus } from './actions';

type SP = { st?: string; who?: string; inst?: string; t?: string; nov?: string };

export default async function KancPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u } = await officePage('kanc', { perm: 'office' });
  const st = sp.st ?? 'open';
  const [all, people, F, NC] = await Promise.all([
    db().select({ t: officeTasks, firm: firms.name }).from(officeTasks).leftJoin(firms, eq(firms.id, officeTasks.firmId)).orderBy(sql`${officeTasks.due} asc nulls last`),
    // Only id / name / role — never password data (FIX #2).
    db().select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    allowedFirms(u),
    db().select({ id: formationCases.id, name: formationCases.name }).from(formationCases),
  ]);
  const visible = all.filter(({ t }) => !t.firmId || F.some((f) => f.id === t.firmId));
  const L = visible.filter(({ t }) => (st === 'open' ? t.status !== 'done' : st === 'all' ? true : t.status === st)
    && (!sp.who || t.assigneeId === sp.who) && (!sp.inst || t.inst === sp.inst));
  const uName = (id: string | null) => people.find((p) => p.id === id)?.name ?? '';
  const cnt = (s: string) => visible.filter(({ t }) => t.status === s).length;
  const td = today();
  const edit = sp.t ? visible.find(({ t }) => t.id === sp.t)?.t : undefined;
  const ef = edit ? await filesOf(OFFICE_FILE_ENTITY.task, [edit.id]) : new Map();
  const q = (o: Partial<SP>) => `/kanc?${new URLSearchParams(Object.entries({ st, who: sp.who, inst: sp.inst, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <Hd t="Канцеларија – задачи" sub="барања до институции и задачи за терен"><Link className="btn pri" href="/kanc?nov">+ Нова задача</Link></Hd>
      <div className="tiles">
        {TASK_STATUS.map((k) => (
          <Link key={k} className="tile" href={q({ st: k })} style={{ textAlign: 'left', ...(st === k ? { outline: '2px solid var(--accent)' } : {}) }}>
            <span>{TST[k][0]}</span><b>{cnt(k)}</b>
          </Link>
        ))}
      </div>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        <select name="st" defaultValue={st} style={{ width: 'auto' }}>
          <option value="open">Отворени (незавршени)</option><option value="all">Сите</option>
          {TASK_STATUS.map((k) => <option key={k} value={k}>{TST[k][0]}</option>)}
        </select>
        <select name="who" defaultValue={sp.who ?? ''} style={{ width: 'auto' }}>
          <option value="">Сите вработени</option>{people.filter((p) => p.role !== 'klient').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="inst" defaultValue={sp.inst ?? ''} style={{ width: 'auto' }}>
          <option value="">Сите институции</option>{INST.map((x) => <option key={x}>{x}</option>)}
        </select>
        <button className="btn">Филтрирај</button>
      </form>

      {(sp.nov !== undefined || edit) && (
        <ActionForm action={saveTask} reset={false}>
          <div className="hd"><h2>{edit ? edit.title : 'Нова задача'}</h2>
            <div className="row">{edit && <Pill c={TST[edit.status as TaskStatus]?.[1]}>{TST[edit.status as TaskStatus]?.[0] ?? edit.status}</Pill>}
              <button className="btn pri">Зачувај</button>
              {edit && <RowAction className="btn danger" action={deleteTask.bind(null, edit.id)} label="Избриши" confirm="Да се избрише задачата?" />}
              <Link className="btn" href="/kanc">Затвори</Link></div></div>
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div className="form">
            <label className="f wide">Наслов<input name="title" defaultValue={edit?.title ?? ''} required placeholder="на пр. Поднеси барање за потврда за платени даноци" /></label>
            <label className="f">Вид<select name="type" defaultValue={edit?.type ?? TTYPE[0]}>{TTYPE.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f">Институција<select name="inst" defaultValue={edit?.inst ?? INST[0]}>{INST.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f">Фирма<select name="firmId" defaultValue={edit?.firmId ?? ''}>
              <option value="">— без фирма —</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></label>
            <label className="f">Задолжен (терен)<select name="assigneeId" defaultValue={edit?.assigneeId ?? ''}>
              <option value="">— не е доделена —</option>
              {people.filter((p) => p.role !== 'klient' && p.role !== 'view').map((p) => <option key={p.id} value={p.id}>{p.name}{p.role === 'teren' ? ' · терен' : ''}</option>)}
            </select></label>
            <label className="f">Рок<input name="due" type="date" defaultValue={edit?.due ?? ''} /></label>
            <label className="f">Приоритет<select name="prio" defaultValue={edit?.prio ?? 'normal'}><option value="normal">Нормален</option><option value="high">Итно 🔴</option></select></label>
            <label className="f wide">Опис / упатство за теренот<textarea name="description" rows={3} defaultValue={edit?.description ?? ''} /></label>
            <UploadField firmId={null} label="📎 Документи за носење / примени документи" />
          </div>
          {edit && <>
            <h3 style={{ margin: '10px 0 4px', fontSize: 14 }}>Скенирани / примени документи</h3>
            {ef.get(edit.id) ? <FileChips files={ef.get(edit.id)} /> : <p className="note" style={{ margin: 0 }}>Сè уште нема прикачени документи.</p>}
            {edit.received && <p style={{ margin: '6px 0 0' }}><b>Примено:</b> {edit.received}</p>}
            <h3 style={{ margin: '10px 0 4px', fontSize: 14 }}>Промени статус</h3>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {TASK_STATUS.map((k) => <RowAction key={k} className={`btn sm ${edit.status === k ? 'pri' : ''}`} action={setTaskStatus.bind(null, edit.id, k, '')} label={TST[k][0]} />)}
            </div>
            {edit.hist.length > 0 && (
              <details style={{ marginTop: 10 }}><summary className="mini">Историја ({edit.hist.length})</summary>
                {edit.hist.slice().reverse().map((x, i) => <div key={i} className="mini">{x.at.slice(0, 16).replace('T', ' ')} · {x.by} · {TST[x.st as TaskStatus]?.[0] ?? x.st}{x.note ? ` – ${x.note}` : ''}</div>)}
              </details>
            )}
          </>}
        </ActionForm>
      )}

      {L.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Рок</th><th>Задача</th><th>Институција</th><th>Фирма</th><th>Задолжен</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {L.map(({ t, firm }) => (
              <tr key={t.id}>
                <td style={taskLate(t, td) ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{t.due ? dmy(t.due) : '—'}{t.prio === 'high' ? ' 🔴' : ''}</td>
                <td><b>{t.title}</b><div className="mini" style={{ display: 'block' }}>{t.type}</div></td>
                <td>{t.inst}</td>
                <td>{firm ?? (t.formationId ? `${NC.find((n) => n.id === t.formationId)?.name ?? ''} (во основање)` : '')}</td>
                <td>{uName(t.assigneeId) || <span className="note">—</span>}</td>
                <td><Pill c={TST[t.status as TaskStatus]?.[1]}>{TST[t.status as TaskStatus]?.[0] ?? t.status}</Pill></td>
                <td><Link className="btn sm" href={q({ t: t.id })}>Отвори</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема задачи за овој филтер.</div>}
      <p className="note">Теренските работници се најавуваат со своја лозинка (улога „Терен“ во Систем → Корисници) и гледаат само „Мои задачи“ – ги прифаќаат, ги завршуваат и прикачуваат скенирани/фотографирани документи.</p>
    </>
  );
}
