'use client';
/**
 * „🏦 Конта за изводи – за сите фирми“ — the browser side: the preview (totals at the top, a row per firm, firms and
 * the three steps can be unticked), the backup confirmation, the start, the progress while the worker runs and the
 * result per firm (+ Excel).
 */
import { useEffect, useMemo, useState, useTransition } from 'react';
import type { BankKontaAllRun, BulkStep, FirmBulkPlan } from '@wise/db';
import { bankSitePreviewAction, bankSiteStartAction, bankSiteStatusAction } from './actions';

type Plan = FirmBulkPlan & { error?: string };
const STEPS: readonly [BulkStep, string][] = [
  ['konto', '1. Конто на банкарските сметки по банката („Примени и прекнижи“)'],
  ['transit', '2. Префрли ги постоечките ставки 1009 → 10091 (пренос меѓу сопствени сметки)'],
  ['layout', '3. Прекнижи ги изводите збирно'],
];
const STATUS: Record<'done' | 'skipped' | 'error', string> = { done: '✅ направено', skipped: '— прескокнато', error: '❌ грешка' };
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('mk-MK') : '');

const lockedOf = (p: Plan, steps: readonly BulkStep[]) => new Set(steps.flatMap((s) => p.locked[s])).size;
const hasWork = (p: Plan, steps: readonly BulkStep[]) =>
  (steps.includes('konto') && p.accounts.length > 0) || (steps.includes('transit') && p.transit.lines > 0) || (steps.includes('layout') && p.layout.statements > 0);

export function BankSiteClient({ year, run: run0, backup }: { year: number; run: BankKontaAllRun | null; backup: { at: string; file: string | null } | null }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [steps, setSteps] = useState<BulkStep[]>(['konto', 'transit', 'layout']);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [backupOk, setBackupOk] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [run, setRun] = useState<BankKontaAllRun | null>(run0);
  const [pending, start] = useTransition();
  const busy = !!run && (run.status === 'queued' || run.status === 'running');

  // progress while the worker runs
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const r = await bankSiteStatusAction();
      if (r.run !== undefined) setRun(r.run);
    }, 2000);
    return () => clearInterval(t);
  }, [busy]);

  const preview = () => start(async () => {
    setMsg(null);
    const r = await bankSitePreviewAction(year);
    if (r.error) { setMsg({ error: r.error }); return; }
    setPlans(r.plans ?? []);
    setOff(new Set());
  });

  const shown = useMemo(() => (plans ?? []).filter((p) => all || p.error || hasWork(p, steps) || lockedOf(p, steps) > 0), [plans, steps, all]);
  const picked = useMemo(() => (plans ?? []).filter((p) => !p.error && hasWork(p, steps) && !off.has(p.firmId)), [plans, steps, off]);
  const tot = useMemo(() => ({
    firms: picked.length,
    accounts: picked.reduce((s, p) => s + (steps.includes('konto') ? p.accounts.length : 0), 0),
    transit: picked.reduce((s, p) => s + (steps.includes('transit') ? p.transit.lines : 0), 0),
    layout: picked.reduce((s, p) => s + (steps.includes('layout') ? p.layout.statements : 0), 0),
    locked: picked.reduce((s, p) => s + lockedOf(p, steps), 0),
  }), [picked, steps]);

  const apply = () => {
    if (!picked.length) return;
    if (!confirm(`Да се применат избраните чекори за ${picked.length} фирми (${year})? Секоја фирма се применува посебно; изводите во заклучен период остануваат.`)) return;
    start(async () => {
      const r = await bankSiteStartAction({ year, firmIds: picked.map((p) => p.firmId), steps, backupOk });
      setMsg(r);
      if (r.ok) { setPlans(null); const s = await bankSiteStatusAction(); if (s.run !== undefined) setRun(s.run); }
    });
  };

  const toggleStep = (s: BulkStep) => setSteps((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));
  const toggleFirm = (id: string) => setOff((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <form method="get" action="/bankSite" className="card row noprint" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label>Година <input name="y" type="number" min={2000} max={2100} defaultValue={year} style={{ width: 90 }} /></label>
        <button className="btn" type="submit">Смени</button>
        <span className="note">Чекорите 2 и 3 ги земаат изводите од избраната година; чекорот 1 ги прекнижува сите изводи на сметката (само отворени периоди).</span>
      </form>

      {run && (
        <div className="card" id="bsRun">
          <h2 style={{ marginTop: 0 }}>{busy ? '⏳ Примената тече…' : run.status === 'error' ? '❌ Примената запре' : '✅ Последна примена'}</h2>
          <p>
            {run.year} · {run.done} / {run.total} фирми{run.current && busy ? ` · сега: ${run.current}` : ''} · започната {dt(run.at)}{run.finishedAt ? ` · завршена ${dt(run.finishedAt)}` : ''}
            {run.error ? <><br /><b className="err">{run.error}</b></> : null}
          </p>
          {busy && <progress max={run.total || 1} value={run.done} style={{ width: '100%' }} />}
          {run.results.length > 0 && (
            <>
              <p className="row" style={{ gap: 12 }}>
                <span>✅ {run.results.filter((r) => r.status === 'done').length} направено</span>
                <span>— {run.results.filter((r) => r.status === 'skipped').length} прескокнато</span>
                <span>❌ {run.results.filter((r) => r.status === 'error').length} грешка</span>
                {!busy && <a className="btn sm" href="/bankSite/xlsx">⬇ Excel</a>}
              </p>
              <div className="tw" style={{ maxHeight: 360 }}><table className="dense">
                <thead><tr><th>Фирма</th><th>Статус</th><th>Сметки (конто)</th><th className="n">1009 → 10091</th><th className="n">Збирно</th><th className="n">Заклучени</th><th>Причина</th></tr></thead>
                <tbody>{run.results.map((r) => (
                  <tr key={r.firmId}>
                    <td>{r.name || '—'}</td><td>{STATUS[r.status]}</td>
                    <td>{r.accounts.map((m) => `${m.name}: ${m.from} → ${m.to}`).join('; ')}</td>
                    <td className="n">{r.transitLines || ''}</td><td className="n">{r.layoutStatements || ''}</td><td className="n">{r.locked || ''}</td>
                    <td>{r.reason ?? ''}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>1. Преглед – ништо не се менува</h2>
        <p className="note">Демо фирмите не се земаат. Сметка со рачно поставено конто и сметка без сигурен предлог по банката остануваат. Изводите во заклучен период / со заклучен налог се прескокнуваат.</p>
        <button className="btn pri" type="button" onClick={preview} disabled={pending || busy}>{pending && !plans ? 'Се пресметува…' : '🔎 Прегледај ги промените за сите фирми'}</button>
        {msg?.error && <p className="err">{msg.error}</p>}
        {msg?.ok && <p className="ok">{msg.ok}</p>}
      </div>

      {plans && (
        <div className="card">
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <b>Фирми: {tot.firms}</b><span>Сметки со ново конто: <b>{tot.accounts}</b></span><span>Ставки 1009 → 10091: <b>{tot.transit}</b></span>
            <span>Изводи за збирно прекнижување: <b>{tot.layout}</b></span><span>Прескокнати (заклучено): <b>{tot.locked}</b></span>
          </div>
          <div style={{ margin: '8px 0' }}>
            {STEPS.map(([s, l]) => (
              <label key={s} style={{ display: 'block' }}><input type="checkbox" checked={steps.includes(s)} onChange={() => toggleStep(s)} /> {l}</label>
            ))}
            <label style={{ display: 'block' }}><input type="checkbox" checked={all} onChange={() => setAll(!all)} /> прикажи ги и фирмите без промени</label>
          </div>
          <div className="tw" style={{ maxHeight: 520 }}><table className="dense">
            <thead><tr><th></th><th>Фирма</th><th>Сметки: старо → ново конто</th><th className="n">1009 → 10091</th><th className="n">Збирно</th><th className="n">Заклучени</th></tr></thead>
            <tbody>{shown.map((p) => {
              const work = !p.error && hasWork(p, steps);
              const lk = lockedOf(p, steps);
              return (
                <tr key={p.firmId} style={work ? undefined : { opacity: 0.6 }}>
                  <td><input type="checkbox" aria-label={p.name} disabled={!work} checked={work && !off.has(p.firmId)} onChange={() => toggleFirm(p.firmId)} /></td>
                  <td>{p.name}{p.active ? '' : ' (неактивна)'}{p.error ? <div className="err">{p.error}</div> : null}</td>
                  <td>
                    {steps.includes('konto') && p.accounts.map((m) => (
                      <div key={m.id}>{m.name}{m.account ? ` (${m.account})` : ''}: {m.from} {m.fromName} → <b>{m.to}</b> {m.toName}{m.statements ? ` · ${m.statements} изводи` : ''}</div>
                    ))}
                    {(p.manual > 0 || p.noMatch > 0) && <small className="note">{p.manual ? `${p.manual} рачно (не се менува)` : ''}{p.manual && p.noMatch ? ' · ' : ''}{p.noMatch ? `${p.noMatch} без сигурен предлог` : ''}</small>}
                  </td>
                  <td className="n">{steps.includes('transit') && p.transit.lines ? `${p.transit.lines} (${p.transit.statements} изв.)` : ''}</td>
                  <td className="n">{steps.includes('layout') ? (p.layout.off ? <small className="note">{p.layout.off}</small> : p.layout.statements || '') : ''}</td>
                  <td className="n" title={p.lockedWhy.join('\n')}>{lk || ''}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {!shown.length && <p className="empty">Нема промени за избраните чекори.</p>}

          <h3>2. Примена</h3>
          <div className="callout warn">
            <b>Направете резервна копија пред примена.</b> Програмата не може сама да ја пушти серверската копија;
            {backup ? ` последната ноќна копија е од ${dt(backup.at)}${backup.file ? ` (${backup.file})` : ''}.` : ' ноќната копија сè уште не е запишана.'}
            <label style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={backupOk} onChange={() => setBackupOk(!backupOk)} /> Потврдувам дека е направена резервна копија</label>
          </div>
          <p className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn pri" type="button" onClick={apply} disabled={pending || busy || !backupOk || !picked.length || !steps.length}>🏦 Примени за сите фирми ({picked.length})</button>
            <span className="note">Секоја фирма во своја трансакција: грешка во една фирма не ги враќа другите. Ако се смени збир (бруто биланс / салдо на извод) освен намерното префрлање, фирмата се враќа и се пријавува грешка. Повторно пуштање не менува ништо.</span>
          </p>
        </div>
      )}
    </>
  );
}
