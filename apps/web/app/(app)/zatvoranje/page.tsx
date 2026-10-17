/**
 * Legacy `VIEWS.zatvoranje` (8713) — Месечно затворање (сите фирми): per firm, for the chosen month, which tasks are
 * done (statements, purchases, invoices without number gaps, cash balance, payroll, VAT return, month locked),
 * grouped by priority; „🔒 Заклучи“ locks the books to the month end. The facts are gathered with a few aggregated
 * queries for all firms (legacy loaded each firm's data in the browser).
 */
import Link from 'next/link';
import { can } from '@wise/core';
import { AUTO_META } from '@wise/core/office/automations';
import { ymAdd, zatMonthEnd, zatPrio, zatTasks, type ZatTask } from '@wise/core/firms/zatvoranje';
import { autoLastRun, CLOSE_KIND, listDrafts, zatFactsFor } from '@wise/db';
import { isDemoUser } from '@/lib/demo';
import { AutoStatus } from '@/components/auto-status';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { lockAllPrepared, lockMonth } from './actions';

const cell = (t: ZatTask) => (t.ok === null ? <span className="mini" style={{ color: 'var(--muted)' }}>—</span> : t.ok ? <span className="pill good">✓</span> : <span className="pill bad">✗</span>);

export default async function ZatvoranjePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { u } = await officePage('zatvoranje');
  const sp = await searchParams;
  const td = today();
  const ym = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : ymAdd(td.slice(0, 7), -1);
  const me = zatMonthEnd(ym);
  const F = await allowedFirms(u);
  const ids = F.map((f) => f.id);
  const [facts, drafts, lastRun] = await Promise.all([
    zatFactsFor(db(), F, ym),
    listDrafts(db(), { kind: CLOSE_KIND, period: ym, firmIds: ids }),
    autoLastRun(db(), 'close').catch(() => null),
  ]);
  const prepared = new Set(drafts.map((d) => d.firmId));
  const rows = F.map((f) => {
    const fx = facts.get(f.id)!;
    const T = zatTasks(fx, ym);
    const [p, pl] = zatPrio(fx, ym);
    return { f, T, p, pl, bad: T.filter((t) => t.ok === false).length };
  }).sort((a, b) => a.p - b.p || b.bad - a.bad);
  const groups = [...new Set(rows.map((r) => r.pl))];
  // P35 bulk lock: owner / administrator only, the firms the nightly check prepared that are still not locked
  const readyRows = rows.filter((r) => prepared.has(r.f.id) && !r.T.find((t) => t.k === 'lock')?.ok && can(u.principal, 'fix', r.f.id));
  const bulk = u.role === 'admin' && !isDemoUser(u) ? readyRows.length : 0;
  const tot = rows.reduce((a, r) => { const A = r.T.filter((t) => t.ok !== null); a.n += A.length; a.ok += A.filter((t) => t.ok).length; return a; }, { n: 0, ok: 0 });
  const months = Array.from({ length: 15 }, (_, i) => ymAdd(td.slice(0, 7), -i));
  return (
    <>
      <Hd t="Месечно затворање – сите фирми" sub={`${ym.slice(5)}/${ym.slice(0, 4)} · завршено ${tot.ok}/${tot.n} задачи`}>
        {/* P35: the nightly check marks the months ready to lock (it never locks); the status line as on the other scheduled screens */}
        <AutoStatus label="Подготвено автоматски" at={lastRun?.at} when={AUTO_META.close.when} />
        {bulk > 0 && <RowAction className="btn pri" action={lockAllPrepared.bind(null, ym)} label={`🔒 Заклучи ги сите подготвени (${bulk})`}
          confirm={`Да се заклучат ${bulk} фирми до ${dmy(me)}?\n\nСекоја фирма повторно се проверува пред заклучување. По заклучувањето не може да се внесуваат/менуваат документи за тој период.\n\n• ${readyRows.map((r) => r.f.name).join('\n• ')}`} />}
        <form className="row" style={{ gap: 6 }}>
          <select name="m" defaultValue={ym} style={{ width: 'auto' }}>{months.map((m) => <option key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</option>)}</select>
          <button className="btn">↻ Провери</button>
        </form>
      </Hd>
      <p className="note">Редослед: прво ДДВ обврзниците (месечни, па тромесечни – рок ДДВ-04: 25-ти во наредниот месец), потоа фирмите без ДДВ со вработени (плата и МПИН), па останатите. ✓ = завршено · ✗ = треба да се заврши · — = не важи за фирмата.</p>
      {groups.map((g) => (
        <div key={g}>
          <h3 style={{ margin: '14px 0 6px', fontSize: 15 }}>{g}</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Фирма</th><th className="n">Готово</th><th>Задачи</th><th style={{ width: 170 }}></th></tr></thead>
            <tbody>
              {rows.filter((r) => r.pl === g).map((r) => {
                const A = r.T.filter((t) => t.ok !== null), ok = A.filter((t) => t.ok).length, pct = A.length ? Math.round(ok / A.length * 100) : 100;
                const due = r.T.filter((t) => t.due && t.ok === false).map((t) => t.due!).sort()[0];
                const open = r.T.filter((t) => t.ok === false && t.k !== 'lock');
                const locked = r.T.find((t) => t.k === 'lock')?.ok;
                return (
                  <tr key={r.f.id}>
                    <td><b>{r.f.name}</b>{prepared.has(r.f.id) && !locked && <> <span className="pill good" title="Ноќната проверка: сите задачи се ✓ – месецот може да се заклучи">подготвено за заклучување</span></>}{due && <div className="mini" style={{ color: due < td ? 'var(--bad)' : 'var(--muted)' }}>рок: {dmy(due)}{due < td ? ' – ПОМИНАТ' : ''}</div>}</td>
                    <td className="n"><div style={{ minWidth: 90 }}><b>{ok}/{A.length}</b><div style={{ height: 6, background: 'var(--line)', borderRadius: 3, marginTop: 3 }}><div style={{ height: 6, width: pct + '%', background: pct === 100 ? '#1f8a4c' : pct >= 50 ? '#e08a00' : '#d11a2a', borderRadius: 3 }} /></div></div></td>
                    <td><div className="row" style={{ gap: '6px 12px', flexWrap: 'wrap' }}>
                      {r.T.map((t) => (
                        <span key={t.k} title={t.info}>{cell(t)} {t.n}<span className="mini" style={{ display: 'block', color: 'var(--muted)', maxWidth: 210 }}>{t.info}{t.due && t.ok === false ? ' · рок ' + dmy(t.due) : ''}</span></span>
                      ))}
                    </div></td>
                    <td style={{ textAlign: 'right' }}>
                      {locked ? <span className="pill good">🔒 заклучен</span>
                        : can(u.principal, 'fix', r.f.id) && <RowAction className="btn sm pri" action={lockMonth.bind(null, r.f.id, ym)} label={`🔒 Заклучи ${ym.slice(5)}/${ym.slice(0, 4)}`}
                          confirm={`Да се заклучи ${r.f.name} до ${dmy(me)}?${open.length ? '\n\nНЕЗАВРШЕНИ задачи:\n• ' + open.map((t) => t.n + ': ' + t.info).join('\n• ') + '\n\nПо заклучувањето не може да се внесуваат/менуваат документи за тој период.' : ''}`} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      ))}
      {!rows.length && <div className="card empty">Нема фирми.</div>}
      <p className="note">„🔒 Заклучи“ го заклучува периодот до крајот на месецот: потоа ништо не може да се внесе, смени или избрише за тој период (освен ако повторно се отклучи во <Link href="/firmi">Фирми</Link>). Задачите се отвораат во фирмата: изберете ја со „⇄ Промени фирма“.</p>
    </>
  );
}
