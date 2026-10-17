/**
 * UX Phase 3 (P31): the state of the background re-post of the firm — the „Прекнижи“ suggestion after a change of the
 * schemes / bank kontos / chart (the owner's switch is off), the running job, and the notice „Прекнижени N налози ·
 * види разлики“ with the before / after per konto. Server component; the buttons need `settings`.
 */
import { can } from '@wise/core';
import { autoRepostText, REPOST_REASON_LBL } from '@wise/core/repost';
import { repostState } from '@wise/db';
import type { SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { RowAction } from '@/components/row-action';
import { dismissRepostAction, requestRepostAction } from '@/app/(app)/_repost/actions';

export async function AutoRepostCallout({ u, firmId }: { u: SessionUser; firmId: string }) {
  const s = await repostState(db(), firmId);
  const ok = can(u.principal, 'settings', firmId);
  const run = s.run;
  const busy = run && (run.status === 'queued' || run.status === 'running') && Date.now() - Date.parse(run.at) < 30 * 60_000;
  const out: React.ReactNode[] = [];
  if (busy) out.push(<div key="busy" className="callout">⏳ Прекнижувањето на {run!.year} тече во позадина ({REPOST_REASON_LBL[run!.reason]}) – само отворени периоди.</div>);
  else if (s.due) {
    out.push(
      <div key="due" className="callout warn row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>⚠ {REPOST_REASON_LBL[s.due.reason]} ({dmy(s.due.at)}): книжените документи од {s.due.year} се со старите конта. Прекнижувањето ги менува само отворените периоди и дава извештај „разлики“.</span>
        {ok && <span className="row" style={{ gap: 6 }}>
          <RowAction className="btn pri" action={requestRepostAction} label="Прекнижи" showOk confirm={`Да се прекнижат документите и изводите од ${s.due.year} во отворените периоди (во позадина)? Заклучените периоди не се менуваат.`} />
          <RowAction className="btn sm ghost" action={dismissRepostAction.bind(null, true)} label="✕" title="Не сега" />
        </span>}
      </div>,
    );
  }
  if (run && !busy && !run.seen && run.status === 'error') {
    out.push(<div key="err" className="callout bad row" style={{ justifyContent: 'space-between' }}><span>Прекнижувањето не успеа: {run.error}</span>{ok && <RowAction action={dismissRepostAction.bind(null, false)} label="✕" />}</div>);
  }
  if (run && !busy && !run.seen && run.status === 'done' && run.result) {
    const r = run.result;
    out.push(
      <div key="done" className="callout good">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span>✓ {autoRepostText(r.docs, r.statements, r.locked, r.diffs.length)} <small>({REPOST_REASON_LBL[run.reason]}, {run.auto ? 'автоматски' : 'потврдено'}, {dmy(run.finishedAt ?? run.at)})</small></span>
          {ok && <RowAction action={dismissRepostAction.bind(null, false)} label="✕" title="Затвори" />}
        </div>
        {r.diffs.length > 0 && (
          <details><summary style={{ cursor: 'pointer' }}>види разлики ({r.diffs.length} конта)</summary>
            <div className="tw"><table className="dense">
              <thead><tr><th>Конто</th><th className="n">Должи пред</th><th className="n">Должи после</th><th className="n">Побарува пред</th><th className="n">Побарува после</th></tr></thead>
              <tbody>{r.diffs.map((d) => (
                <tr key={d.konto}><td><b>{d.konto}</b></td><td className="n">{fmt(d.d0)}</td><td className="n">{fmt(d.d1)}</td><td className="n">{fmt(d.c0)}</td><td className="n">{fmt(d.c1)}</td></tr>
              ))}</tbody>
            </table></div>
          </details>
        )}
        {r.errors.length > 0 && <small>Не можеа да се прекнижат: {r.errors.join('; ')}</small>}
      </div>,
    );
  }
  return out.length ? <>{out}</> : null;
}
