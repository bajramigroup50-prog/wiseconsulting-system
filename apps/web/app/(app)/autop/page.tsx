/** Legacy `VIEWS.autop` 16316 … **16663** — autopilot: checks of every firm, inspection-risk score, messages to clients. */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { can } from '@wise/core';
import { AL_DESC } from '@wise/core/office';
import { autopilotFindings, autopilotMessages, autopilotMetrics, autopilotRuns, getOfficeProfile } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, officePage } from '@/lib/office';
import { hrefFor } from '@/lib/nav';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { ackFinding, runNow, saveAutopilotSettings, sendMessage, skipMessage } from './actions';

const TYPES: [string, string][] = [['inv', '📄 Влезни фактури што недостасуваат'], ['out', '📤 Излезни фактури што недостасуваат'], ['cash', '💶 Благајна во минус / фискални'], ['izv', '🏦 Изводи што недостасуваат'], ['vat', '🧾 ДДВ и даноци – проценка и рок']];
const LV: Record<string, string> = { bad: 'bad', warn: 'warn', info: 'info' };

export default async function AutopPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === 'msg' ? 'msg' : sp.tab === 'risk' ? 'risk' : 'find';
  const { u } = await officePage('autop', { perm: 'office' });
  const F = await allowedFirms(u);
  const ids = F.map((f) => f.id);
  const fname = (id: string) => F.find((f) => f.id === id)?.name ?? '';
  const [[run], O] = await Promise.all([db().select().from(autopilotRuns).orderBy(desc(autopilotRuns.startedAt)).limit(1), getOfficeProfile(db())]);
  const [find, msgs, met] = ids.length ? await Promise.all([
    db().select().from(autopilotFindings).where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt))),
    db().select().from(autopilotMessages).where(and(inArray(autopilotMessages.firmId, ids), eq(autopilotMessages.status, 'proposed'))).orderBy(desc(autopilotMessages.createdAt)),
    db().select().from(autopilotMetrics).where(inArray(autopilotMetrics.firmId, ids)),
  ]) : [[], [], []];
  const byFirm = new Map<string, typeof find>();
  for (const x of find) byFirm.set(x.firmId, [...(byFirm.get(x.firmId) ?? []), x]);
  const order = [...byFirm.keys()].sort((a, b) => (byFirm.get(b)!.filter((x) => x.lvl === 'bad').length - byFirm.get(a)!.filter((x) => x.lvl === 'bad').length) || fname(a).localeCompare(fname(b), 'mk'));
  const settings = can(u.principal, 'settings');
  const tabs: [string, string][] = [['find', `Наоди (${find.length})`], ['msg', `Пораки до клиенти (${msgs.length})`], ['risk', 'Ризик од контрола']];

  return (
    <>
      <Hd t="🤖 Автопилот" sub={run ? `последна проверка ${dmyHm(run.finishedAt ?? run.startedAt)} · ${run.firms} фирми` : 'сè уште не е пуштен'}>
        <RowAction className="btn pri" action={runNow} label="▶ Провери ги сите фирми" />
      </Hd>
      <p className="note">Се пушта автоматски на секои 6 часа. Наодите исчезнуваат сами кога ќе се реши проблемот.</p>
      <div className="ftabs row" style={{ gap: 6, margin: '6px 0' }}>{tabs.map(([k, l]) => <a key={k} className={`btn sm ${tab === k ? 'pri' : ''}`} href={`/autop?tab=${k}`}>{l}</a>)}</div>

      {tab === 'find' && (order.length ? order.map((fid) => (
        <div key={fid} className="card">
          <h2 style={{ fontSize: 15 }}>{fname(fid)}</h2>
          <table className="dense"><tbody>
            {byFirm.get(fid)!.sort((a, b) => ['bad', 'warn', 'info'].indexOf(a.lvl) - ['bad', 'warn', 'info'].indexOf(b.lvl)).map((x) => (
              <tr key={x.id}>
                <td><Pill c={LV[x.lvl]}>{x.cat}</Pill></td>
                <td title={AL_DESC[x.cat]}>{x.txt}</td>
                <td className="mini">од {dmyHm(x.firstSeen)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{x.go && <a className="btn sm ghost" href={hrefFor(x.go)}>→</a>} <RowAction action={ackFinding.bind(null, x.id)} label="✓ Видено" /></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )) : <div className="card empty">Нема отворени наоди. 👍</div>)}

      {tab === 'msg' && (msgs.length ? msgs.map((m) => (
        <div key={m.key} className="card">
          <div className="hd"><h2 style={{ fontSize: 15 }}>{m.subject}</h2>
            <div className="row"><RowAction className="btn sm pri" action={sendMessage.bind(null, m.key)} label="✉ Испрати во порталот" /><RowAction action={skipMessage.bind(null, m.key)} label="Прескокни" /></div></div>
          <details><summary className="mini">{fname(m.firmId)} · {dmyHm(m.createdAt)}</summary><div style={{ whiteSpace: 'pre-line' }}>{m.body}</div></details>
        </div>
      )) : <div className="card empty">Нема нови пораки за праќање.</div>)}

      {tab === 'risk' && (
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th><th className="n">Ризик</th><th>Зошто</th></tr></thead>
          <tbody>{[...met].sort((a, b) => b.risk - a.risk).map((m) => (
            <tr key={m.firmId}><td>{fname(m.firmId)}</td><td className="n"><Pill c={m.risk >= 40 ? 'bad' : m.risk >= 20 ? 'warn' : 'good'}>{m.risk}</Pill></td><td className="mini">{m.riskWhy.join('; ')}</td></tr>
          ))}</tbody>
        </table></div>
      )}

      <ActionForm action={saveAutopilotSettings} reset={false}>
        <h2 style={{ fontSize: 15 }}>Автоматско праќање до клиентите</h2>
        {TYPES.map(([k, t]) => <label key={k} className="chk" style={{ display: 'block' }}><input type="checkbox" name={`auto_${k}`} defaultChecked={!!O.apAuto?.[k as 'inv']} disabled={!settings} /> {t}</label>)}
        <label className="chk" style={{ display: 'block' }}><input type="checkbox" name="apTasks" defaultChecked={!!O.apTasks} disabled={!settings} /> Креирај задача во Канцеларија за секој нов проблем</label>
        {settings ? <button className="btn sm">Зачувај</button> : <p className="note">Само администраторот / главниот сметководител ги менува поставките.</p>}
      </ActionForm>
    </>
  );
}
