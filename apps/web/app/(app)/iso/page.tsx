/**
 * 🏅 ISO – Квалитет: the office working by ISO 9001 (quality), ISO 27001 (information security) and ISO 10001 / 10002
 * (customer code of conduct, complaints). Overview of the registers, each register's list with its form, the starting
 * policies / procedures, the evidence the system already keeps, and the management review (/print/iso).
 */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { ISO_KINDS, ISO_STATUS, isoKind, isoNo, isoOverview, riskScore, type IsoKind, type IsoRow, type IsoStatus } from '@wise/core/office/iso';
import { isoEvidence, isoRecords, users } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { Hd, dmy } from '@/components/hd';
import { ActionForm, Submit } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { isoDelete, isoSave, isoStarter, isoStatus } from './actions';

type SP = { k?: string; id?: string; new?: string };
const PILL: Record<IsoStatus, string> = { open: 'warn', progress: 'info', done: 'good' };

export default async function IsoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u } = await officePage('iso', { perm: 'office' });
  const td = today(), year = Number(td.slice(0, 4));
  const [R0, U, F] = await Promise.all([
    db().select().from(isoRecords).orderBy(desc(isoRecords.year), desc(isoRecords.no)),
    db().select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(users.name),
    allowedFirms(u),
  ]);
  const R: (IsoRow & { firmId: string | null; ownerId: string | null })[] = R0.map((r) => ({
    id: r.id, kind: r.kind as IsoKind, no: r.no, year: r.year, title: r.title, status: r.status as IsoStatus, due: r.due, created: r.createdAt.toISOString(),
    closed: r.closedAt?.toISOString() ?? null, data: r.data ?? {}, firmId: r.firmId, ownerId: r.ownerId,
  }));
  const OV = isoOverview(R, td);
  const tab = sp.k === 'ev' ? 'ev' : isoKind(sp.k ?? '')?.k ?? '';
  const def = tab && tab !== 'ev' ? isoKind(tab)! : null;
  const edit = sp.id ? R.find((r) => r.id === sp.id) : undefined;
  const showForm = !!def && (sp.new != null || !!edit);
  const uName = (id: string | null) => U.find((x) => x.id === id)?.name ?? '';
  const fName = (id: string | null) => F.find((x) => x.id === id)?.name ?? '';
  const ev = tab === 'ev' ? await db().transaction((tx) => isoEvidence(tx, new Date(Date.now() - 90 * 864e5))) : null;
  const noPolicies = !R.some((r) => r.kind === 'policy');

  return (
    <>
      <Hd t="🏅 ISO – Квалитет" sub="ISO 9001 квалитет · ISO 27001 безбедност на информациите · ISO 10001 / 10002 клиенти и поплаки">
        <a className="btn" href={`/print/iso?y=${year}`} target="_blank" rel="noreferrer">🖨 Преглед од раководството {year}</a>
      </Hd>
      {noPolicies && (
        <div className="callout info">📘 Почнете со <b>основните документи</b>: политика на квалитет, политика за безбедност на информациите, кодекс кон клиентите (ISO 10001), постапка за поплаки (10002), корективни мерки, пристап и резервни копии – готов текст со името на канцеларијата, вие само ги прегледувате и одобрувате.{' '}
          <RowAction action={isoStarter} label="📘 Креирај ги основните документи" className="btn pri sm" showOk /></div>
      )}
      <div className="tiles kpi k4">
        {ISO_KINDS.map((d) => {
          const o = OV.find((x) => x.k === d.k)!;
          return (
            <Link key={d.k} href={`/iso?k=${d.k}`} className="tile kt" style={{ textDecoration: 'none', color: 'inherit', outline: tab === d.k ? '2px solid var(--accent)' : undefined }}>
              <div className="kh"><span>{d.ic} {d.n}</span></div>
              <b className="num">{o.total}</b>
              <i>{o.open ? <>{o.open} отворени{o.late ? <> · <strong style={{ color: 'var(--bad)' }}>{o.late} по рокот</strong></> : ''}</> : o.total ? '✓ сите затворени' : 'празно'} · <span className="mini">{d.clause}</span></i>
            </Link>
          );
        })}
      </div>
      <div className="row" style={{ gap: 6, margin: '8px 0' }}>
        <Link className={`btn ${tab === 'ev' ? 'pri' : ''}`} href="/iso?k=ev">🧾 Докази од системот (27001)</Link>
      </div>

      {def && (
        <div className="card">
          <div className="hd"><h2 style={{ margin: 0 }}>{def.ic} {def.n} <span className="mini">· {def.clause}</span></h2>
            {!showForm && <Link className="btn pri" href={`/iso?k=${def.k}&new`}>＋ Нов запис</Link>}</div>
          <p className="note" style={{ marginTop: 4 }}>{def.hint}</p>

          {showForm && (
            <ActionForm action={isoSave} reset={false} className="card" style={{ background: 'var(--accent-soft)' }}>
              <input type="hidden" name="kind" value={def.k} />
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <div className="row" style={{ gap: '8px 14px', flexWrap: 'wrap', alignItems: 'end' }}>
                <label className="f" style={{ flex: '2 1 320px' }}>Наслов<input name="title" required defaultValue={edit?.title ?? ''} /></label>
                {(def.k === 'complaint' || def.k === 'nc' || def.k === 'incident') && (
                  <label className="f" style={{ flex: '1 1 220px' }}>Клиент (фирма)<select name="firmId" defaultValue={edit?.firmId ?? ''}><option value="">—</option>{F.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                )}
                <label className="f">Одговорно лице<select name="ownerId" defaultValue={edit?.ownerId ?? u.id}><option value="">—</option>{U.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label className="f">Рок<input type="date" name="due" defaultValue={edit?.due ?? ''} /></label>
                <label className="f">Статус<select name="status" defaultValue={edit?.status ?? 'open'}>{(Object.keys(ISO_STATUS) as IsoStatus[]).map((s) => <option key={s} value={s}>{ISO_STATUS[s]}</option>)}</select></label>
              </div>
              <div className="row" style={{ gap: '8px 14px', flexWrap: 'wrap', marginTop: 8 }}>
                {def.fields.map((x) => {
                  const v = String(edit?.data[x.k] ?? '');
                  return (
                    <label key={x.k} className="f" style={{ flex: x.t === 'area' ? '1 1 100%' : '1 1 200px' }}>{x.n}
                      {x.t === 'area' ? <textarea name={'d_' + x.k} defaultValue={v} rows={x.k === 'text' ? 14 : 3} />
                        : x.t === 'sel' ? <select name={'d_' + x.k} defaultValue={v}>{(x.o ?? []).map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select>
                          : <input name={'d_' + x.k} type={x.t === 'date' ? 'date' : x.t === 'num' ? 'number' : 'text'} defaultValue={v} />}
                    </label>
                  );
                })}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}><Submit>Зачувај</Submit><Link className="btn" href={`/iso?k=${def.k}`}>Откажи</Link></div>
            </ActionForm>
          )}

          {(() => {
            const L = R.filter((r) => r.kind === def.k);
            if (!L.length) return <div className="empty">Нема записи. ＋ Нов запис.</div>;
            return (
              <div className="tw"><table className="dense">
                <thead><tr><th>Бр.</th><th>Наслов</th>{def.k === 'risk' && <th className="n">Ризик</th>}<th>Клиент</th><th>Одговорен</th><th>Рок</th><th>Статус</th><th /></tr></thead>
                <tbody>{L.map((r) => {
                  const rs = def.k === 'risk' ? riskScore(r.data) : null;
                  const late = r.status !== 'done' && r.due && r.due < td;
                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}><b>{isoNo(r.kind, r.no, r.year)}</b><div className="mini">{dmy(r.created.slice(0, 10))}</div></td>
                      <td><Link href={`/iso?k=${def.k}&id=${r.id}`}>{r.title}</Link>{r.kind === 'policy' && r.data.version ? <span className="mini"> · в. {String(r.data.version)}{r.data.approvedOn ? ' · одобрено ' + dmy(String(r.data.approvedOn)) : ' · неодобрено'}</span> : null}</td>
                      {def.k === 'risk' && <td className="n">{rs ? <span className={`pill ${rs.cls === 'high' ? 'bad' : rs.cls === 'mid' ? 'warn' : 'good'}`}>{rs.s}</span> : '—'}</td>}
                      <td>{fName(r.firmId)}</td><td>{uName(r.ownerId)}</td>
                      <td style={late ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{r.due ? dmy(r.due) : ''}</td>
                      <td><span className={`pill ${PILL[r.status]}`}>{ISO_STATUS[r.status]}</span>{r.closed && r.status === 'done' ? <div className="mini">{dmy(r.closed.slice(0, 10))}</div> : null}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link className="btn sm" href={`/iso?k=${def.k}&id=${r.id}`}>✎</Link>
                        {r.status !== 'done' ? <RowAction action={isoStatus.bind(null, r.id, 'done')} label="✓ Затвори" className="btn sm" />
                          : <RowAction action={isoStatus.bind(null, r.id, 'open')} label="↺" title="Отвори повторно" />}
                        <RowAction action={isoDelete.bind(null, r.id)} label="🗑" title="Избриши" confirm={`Да се избрише „${r.title}“?`} />
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            );
          })()}
        </div>
      )}

      {tab === 'ev' && ev && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>🧾 Докази од системот – последни 90 дена</h2>
          <p className="note">Програмата веќе ги води записите што ги бара ISO 27001: пристап по корисник и улога (A.5.15–5.18), дневник на секоја промена што не може да се брише (A.8.15), грешки на системот (A.8.16), дневна резервна копија пред секоја надградба (A.8.13).</p>
          <div className="tiles kpi k4">
            <div className="tile kt"><div className="kh"><span>Корисници</span></div><b className="num">{ev.users.filter((x) => x.active).length}</b><i>активни · {ev.users.filter((x) => !x.active).length} затворени</i></div>
            <div className="tile kt"><div className="kh"><span>Евидентирани промени</span></div><b className="num">{ev.changes.toLocaleString('mk-MK')}</b><i>дневник на промени (не се брише)</i></div>
            <div className="tile kt"><div className="kh"><span>Најавувања</span></div><b className="num">{ev.logins.toLocaleString('mk-MK')}</b><i>последни 90 дена</i></div>
            <div className="tile kt"><div className="kh"><span>Грешки на системот</span></div><b className="num">{ev.errors.open}</b><i>отворени · {ev.errors.fixed} решени</i></div>
          </div>
          <div className="cols" style={{ marginTop: 10 }}>
            <div><h3>Корисници и улоги (контрола на пристап)</h3><div className="tw"><table className="dense"><thead><tr><th>Име</th><th>Корисничко</th><th>Улога</th><th>Статус</th></tr></thead>
              <tbody>{ev.users.map((x) => <tr key={x.username}><td>{x.name}</td><td>{x.username}</td><td>{x.role}</td><td>{x.active ? <span className="pill good">активен</span> : <span className="pill">затворен</span>}</td></tr>)}</tbody></table></div></div>
            <div><h3>Најчести промени</h3><div className="tw"><table className="dense"><thead><tr><th>Акција</th><th className="n">Број</th></tr></thead>
              <tbody>{ev.topActions.map((x) => <tr key={x.a}><td>{x.a}</td><td className="n">{x.n}</td></tr>)}</tbody></table></div></div>
          </div>
        </div>
      )}

      {!tab && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Како се користи</h2>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li><b>📘 Политики и документи</b> – креирајте ги основните, дополнете ги и внесете „Одобрил / Одобрено на“.</li>
            <li><b>🏁 Цели</b> за годината (пр. 100% пријави во рок) и <b>🎯 Ризици</b> со мерки.</li>
            <li>Во текот на годината: секоја <b>📣 поплака</b>, <b>🛠 грешка / пропуштен рок</b>, <b>🛡 инцидент</b> и <b>🎓 обука</b> – запис со одговорно лице и рок.</li>
            <li>Еднаш годишно <b>🔍 внатрешна проверка</b>, потоа <b>🖨 Преглед од раководството</b> – извештајот се составува сам од записите.</li>
          </ol>
        </div>
      )}
    </>
  );
}
