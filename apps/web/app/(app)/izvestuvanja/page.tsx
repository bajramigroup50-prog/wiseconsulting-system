/**
 * Legacy `VIEWS.izvestuvanja` 8552 — notifications for all firms: „🔊 Прочитај“, „↻ Провери повторно“, reminder
 * settings (`alSettingsHTML`: popup, voice, daily e-mail), level buttons with counts, kind and firm filters, „прикажи
 * и потврдените“, the firm × kind matrix (`alMatrixHTML`), then one card per firm (worst first) with every item:
 * level, kind, text, „Отвори“ (opens the firm on the right screen) and „✓ Во ред“ / „↺“.
 * The checks run in the autopilot job (every 6 h, or „Провери повторно“) instead of in the browser.
 */
import Link from 'next/link';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { AL_CATS, AL_DESC } from '@wise/core/office';
import { autopilotFindings, autopilotRuns, respFirms, users } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, officePage } from '@/lib/office';
import { currentFirm } from '@/lib/context';
import { AlSettings, AlVoiceButton } from '@/components/al-settings';
import { FirmGo } from '@/components/firm-go';
import { Hd, dmyHm } from '@/components/hd';
import { AutoStatus } from '@/components/auto-status';
import { RowAction } from '@/components/row-action';
import { ackFinding, runNow, unackFinding } from '../autop/actions';
import { saveRespAction, sendToColleaguesAction } from './actions';
import { RespEditor } from './resp-editor';

const LV: Record<string, [string, string]> = { bad: ['bad', '🔴 Итно'], warn: ['warn', '🟠 Внимание'], info: ['info', '🔵 Инфо'] };
type SP = { lvl?: string; cat?: string; fid?: string; ack?: string; kol?: string };

export default async function IzvestuvanjaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u } = await officePage('izvestuvanja', { perm: 'office' });
  const cur = await currentFirm(u);
  const F = await allowedFirms(u);
  const ids = F.map((f) => f.id);
  const [all, [run]] = await Promise.all([
    ids.length ? db().select().from(autopilotFindings).where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt))) : Promise.resolve([]),
    db().select().from(autopilotRuns).orderBy(desc(autopilotRuns.startedAt)).limit(1),
  ]);
  // the firms each colleague follows: a colleague sees their own firms first, the administrator can pick any colleague
  const isAdmin = u.role === 'admin' && !u.principal.demo;
  const [resp, staff] = await Promise.all([
    respFirms(db()),
    isAdmin ? db().select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), eq(users.demo, false), ne(users.role, 'klient'), ne(users.role, 'teren'))) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const kol = sp.kol === 'all' ? '' : sp.kol || (!isAdmin && resp[u.id]?.length ? u.id : '');
  const kolSet = kol ? new Set(resp[kol] ?? []) : null;
  const colleagues = staff.filter((c) => c.id !== u.id).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  const showAck = sp.ack === '1';
  const nAck = all.filter((x) => x.ackAt).length;
  const ALL = all.filter((x) => !x.ackAt || showAck);
  const I = ALL.filter((x) => (!sp.cat || x.cat === sp.cat) && (!sp.lvl || x.lvl === sp.lvl) && (!sp.fid || x.firmId === sp.fid) && (!kolSet || kolSet.has(x.firmId)));
  const kinds = [...new Set(all.map((x) => x.cat))];
  const qs = (o: Partial<SP>) => '?' + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const w = (fid: string) => I.filter((x) => x.firmId === fid && x.lvl === 'bad').length * 100 + I.filter((x) => x.firmId === fid).length;
  const firms = F.filter((f) => I.some((x) => x.firmId === f.id)).sort((a, b) => w(b.id) - w(a.id));
  const ord = ['bad', 'warn', 'info'];
  const cats = AL_CATS.filter((c) => I.some((x) => x.cat === c));
  return (
    <>
      <Hd t="Известувања за сите фирми" sub={`${all.length} известувања · ${F.length} фирми${run ? ' · ' + dmyHm(run.finishedAt ?? run.startedAt) : ''}`}>
        <AlVoiceButton />
        {/* P42: the checks run in the autopilot every 6 hours — a status line; the small ↻ only for the owner / administrator */}
        <AutoStatus at={run ? run.finishedAt ?? run.startedAt : null} when="на секои 6 часа (автопилот)"
          refresh={u.role === 'admin' ? <RowAction className="btn sm ghost" action={runNow} label="↻" title="Провери повторно" /> : null} />
        <Link className="btn" href="/autop">🤖 Автопилот</Link>
        {isAdmin && <RowAction className="btn pri" action={sendToColleaguesAction} label="📨 Прати на колегите" title="Секој колега, кога ќе ја отвори програмата, добива известување со итните и неодложните известувања за своите фирми" showOk />}
      </Hd>
      {isAdmin && (
        <details className="card"><summary><b>👥 Распределба на фирми по колеги</b> <span className="mini">– кој колега кои фирми ги следи ({Object.values(resp).reduce((a, x) => a + x.length, 0)} распределени)</span></summary>
          <div style={{ marginTop: 10 }}>{colleagues.length
            ? <RespEditor action={saveRespAction} colleagues={colleagues} firms={F.map((f) => ({ id: f.id, name: f.name }))} resp={resp} />
            : <p className="mini">Нема колеги (корисници од канцеларијата).</p>}</div>
        </details>
      )}
      <AlSettings email={u.email ?? ''} />
      <form className="card">
        <div className="row" style={{ gap: '6px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {ord.map((l) => <Link key={l} className={`btn sm ${sp.lvl === l ? 'pri' : ''}`} href={qs({ lvl: l })}>{LV[l]![1]} ({ALL.filter((x) => x.lvl === l).length})</Link>)}
          <Link className={`btn sm ${!sp.lvl ? 'pri' : ''}`} href={qs({ lvl: '' })}>Сите</Link>
          {sp.lvl && <input type="hidden" name="lvl" value={sp.lvl} />}
          <select name="cat" defaultValue={sp.cat ?? ''} style={{ width: 'auto' }}><option value="">Сите видови</option>{kinds.map((c) => <option key={c}>{c}</option>)}</select>
          {(isAdmin ? colleagues.some((c) => resp[c.id]?.length) : !!resp[u.id]?.length) && (
            <select name="kol" defaultValue={sp.kol ?? (kol ? kol : '')} style={{ width: 'auto' }}>
              {isAdmin ? <option value="">Сите колеги</option> : <option value="all">Сите фирми</option>}
              {isAdmin ? colleagues.filter((c) => resp[c.id]?.length).map((c) => <option key={c.id} value={c.id}>👤 {c.name}</option>) : <option value={u.id}>👤 Мои фирми</option>}
            </select>
          )}
          <select name="fid" defaultValue={sp.fid ?? ''} style={{ width: 'auto' }}><option value="">Сите фирми</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          {nAck > 0 && <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="ack" value="1" defaultChecked={showAck} /> прикажи и потврдените ({nAck})</label>}
          <button className="btn sm">Прикажи</button>
        </div>
      </form>
      {firms.length > 0 && cats.length > 0 && (
        <div className="card"><div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th>{cats.map((c) => <th key={c} title={AL_DESC[c]}>{c}</th>)}</tr></thead>
          <tbody>{firms.map((f) => <tr key={f.id}><td>{f.name}</td>{cats.map((c) => {
            const x = I.filter((y) => y.firmId === f.id && y.cat === c);
            if (!x.length) return <td key={c} />;
            const lvl = ord.find((l) => x.some((y) => y.lvl === l))!;
            return <td key={c} title={x.map((y) => y.txt).join('\n')}><span className={`pill ${LV[lvl]![0]}`}>{x.length}</span></td>;
          })}</tr>)}</tbody>
        </table></div></div>
      )}
      {firms.length ? firms.map((f) => {
        const X = I.filter((x) => x.firmId === f.id).sort((a, b) => ord.indexOf(a.lvl) - ord.indexOf(b.lvl));
        return (
          <div key={f.id} className="card" style={{ padding: '10px 14px' }}>
            <div className="hd"><h2 style={{ fontSize: 15 }}>{f.name} <span className="mini">{f.vatRegistered ? 'ДДВ обврзник' : 'не е ДДВ обврзник'}</span></h2></div>
            <table className="dense" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup><col style={{ width: 120 }} /><col style={{ width: 130 }} /><col /><col style={{ width: 170 }} /></colgroup>
              <tbody>{X.map((a) => (
                <tr key={a.id}>
                  <td><span className={`pill ${LV[a.lvl]?.[0] ?? ''}`}>{LV[a.lvl]?.[1] ?? a.lvl}</span></td>
                  <td className="mini">{a.cat}</td>
                  <td>{a.txt}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <FirmGo fid={f.id} current={cur?.id} to={`/${a.go || ''}`} className="btn sm">Отвори</FirmGo>
                    {a.ackAt ? <RowAction action={unackFinding.bind(null, a.id)} label="↺" title="Врати како активно" />
                      : <RowAction action={ackFinding.bind(null, a.id)} label="✓ Во ред" title="Проверено – во ред, не прикажувај повеќе" />}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      }) : <div className="card empty">✓ Нема известувања – сè е во ред.</div>}
      <p className="note">Проверки: изводи што недостасуваат (прескокнат број или стар последен извод), плаќања кон добавувачи без влезна фактура, уплати без излезна фактура, праг од 2.000.000 ден. за ДДВ (и предупредување на 80%), некнижена ДДВ-04, непресметана плата, благајна во минус, негативна залиха, истечени/истекуваат документи (лиценци, тековна состојба…) и ненаплатени фактури над 90 дена.</p>
    </>
  );
}
