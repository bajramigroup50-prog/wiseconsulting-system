/**
 * Legacy `VIEWS.lawrep` 16649 (+ v541 button to `ujpZakoni` 16800) — ⚖️ Прелиминарен даночен преглед: the firm's books
 * checked per law article (ЗДДВ, ЗДД, ЗПДД, ЗДП), the findings table, the estimated exposure and the rule list.
 * `?all=1` is the all-firms run that legacy showed as the autopilot tab „⚖️ Даночен преглед“ (`lrAllHTML` 16657).
 */
import Link from 'next/link';
import { LR_IC, LR_LAWS, LR_RULES, LR_RULES_PENDING, lrByLaw, type LrResult } from '@wise/core/law';
import { lawReview, lawReviewFirms } from '@wise/db';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { allowedFirms, officePage, today } from '@/lib/office';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { lawrepPdf } from './actions';
import { PickFirm } from './pick-firm';

export default async function LawrepPage({ searchParams }: { searchParams: Promise<{ pdf?: string; all?: string; run?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('lawrep', { perm: 'office' });
  const year = await currentYear();
  if (sp.all === '1') return <AllFirms u={u} year={year} run={sp.run === '1'} />;
  if (!firm) return <><NoFirm t="⚖️ Даночен преглед" /><p><Link className="btn" href="/lawrep?all=1">⚖️ Преглед за сите фирми</Link></p></>;
  const X = await lawReview(db(), firm, year, today());
  return (
    <>
      <Hd t="⚖️ Прелиминарен даночен преглед" sub={`${firm.name} · ${year} · според ЗДДВ, ЗДД, ЗПДД и ЗДП`}>
        <RowAction className="btn" action={lawrepPdf} label="🖨 PDF извештај" />
        <Link className="btn" href="/ujpZakoni">📚 Закони на УЈП</Link>
        <Link className="btn" href="/insp">🛡 Инспекција</Link>
        <Link className="btn" href="/lawrep?all=1">Сите фирми</Link>
      </Hd>
      {sp.pdf && <div className="callout">PDF се подготвува… <a href={`/api/files/${sp.pdf}`} target="_blank" rel="noopener">Отвори PDF</a> (ако не се отвори, обидете се повторно за неколку секунди).</div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
        {([['⛔ Прекршувања', String(X.bad), 'bad'], ['⚠ За проверка', String(X.warn), 'warn'], ['💰 Можна изложеност (данок + камата)', fmt(X.exp) + ' ден.', X.exp > 0 ? 'bad' : 'good']] as const).map(([t, n, cl]) => (
          <div key={t} className="card" style={{ flex: 1, minWidth: 200, margin: 0 }}>
            <div className="muted" style={{ fontSize: 12.5 }}>{t}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: `var(--${cl})` }}>{n}</div>
          </div>
        ))}
      </div>
      <div className="callout" style={{ fontSize: 12.5 }}>Програмот ги поврзува книжењата со правилата од законите (конта, влезни фактури со ДДВ, заеми, основни средства, ДДВ-04) и ја проценува последицата: дополнителен данок, камата 0,03% дневно (ЗДП) и глоба каде што е утврдена. Ова е <b>прелиминарна</b> контрола – износите се проценка; конечно мислење дава сметководителот.</div>
      <div className="card"><LrTable X={X} /></div>
      <details className="card">
        <summary><b>📚 Правила од законите што ги проверува програмот ({LR_RULES.length})</b></summary>
        <table className="dense" style={{ marginTop: 8 }}>
          <thead><tr><th>Закон</th><th>Член</th><th>Правило</th></tr></thead>
          <tbody>{LR_RULES.map((r) => <tr key={r.id}><td><a href={LR_LAWS[r.law][1]} target="_blank" rel="noopener">{LR_LAWS[r.law][0]}</a></td><td>{r.art}</td><td>{r.t}</td></tr>)}</tbody>
        </table>
        <p className="note">Текстовите на законите се на УЈП (пречистени текстови). Кога ќе се смени закон, „⚖️ Законски промени“ (дневниот робот) известува, а правилото се ажурира во програмата.</p>
        <p className="note">Сè уште не се проверуваат (потребни се договорите за позајмици): {LR_RULES_PENDING.map((r) => r.t).join('; ')}.</p>
      </details>
    </>
  );
}

/** Legacy `lrTable` (screen mode). */
function LrTable({ X }: { X: LrResult }) {
  return lrByLaw(X).map((g) => (
    <div key={g.law}>
      <h2 style={{ margin: '14px 0 6px' }}>{g.name}</h2>
      <table className="dense" style={{ width: '100%' }}>
        <thead><tr><th></th><th>Правило (член)</th><th>Што најдовме</th><th>Можна последица / што да се направи</th></tr></thead>
        <tbody>{g.rows.map((x) => (
          <tr key={x.r.id}>
            <td>{LR_IC[x.s]}</td>
            <td><b>{x.r.t}</b><div className="muted" style={{ fontSize: 11 }}>{LR_LAWS[g.law][0].replace(/\s*\(.*\)/, '')}, {x.r.art}</div></td>
            <td style={{ fontSize: 12.5 }}>{x.txt}</td>
            <td style={{ fontSize: 12.5 }}>{x.amt ? <><b style={{ color: 'var(--bad)' }}>≈ {fmt(x.amt)} ден.</b><br /></> : null}{x.how && <>{x.how}<br /></>}{x.fix && <i>{x.fix}</i>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  ));
}

/** Legacy `lrAllHTML` / `lrAllRun`: every allowed firm (except the office's own), sorted by exposure. */
async function AllFirms({ u, year, run }: { u: Parameters<typeof allowedFirms>[0]; year: number; run: boolean }) {
  const head = (
    <>
      <Hd t="⚖️ Прелиминарен даночен преглед – сите фирми" sub={String(year)}><Link className="btn" href="/lawrep">← Избрана фирма</Link></Hd>
      <div className="card"><div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div><b>⚖️ Прелиминарен даночен преглед – сите фирми ({year})</b><div className="muted" style={{ fontSize: 12.5 }}>ЗДДВ, ЗДД, ЗПДД, ЗДП – прекршувања и проценета изложеност по фирма.</div></div>
        <Link className="btn pri" href="/lawrep?all=1&run=1">▶ Провери ги сите</Link>
      </div></div>
    </>
  );
  if (!run) return head;
  const F = await lawReviewFirms(db(), (await allowedFirms(u)).map((f) => f.id));
  const td = today();
  const rows: { f: (typeof F)[number]; X: LrResult }[] = [];
  for (const f of F) {
    try { rows.push({ f, X: await lawReview(db(), f, year, td) }); } catch (e) { console.warn('lr', f.name, e); }
  }
  rows.sort((a, b) => b.X.exp - a.X.exp || b.X.bad - a.X.bad);
  return (
    <>
      {head}
      <div className="card tw"><table className="dense">
        <thead><tr><th>Фирма</th><th className="n">⛔</th><th className="n">⚠</th><th className="n">Изложеност</th><th>Најважно</th><th></th></tr></thead>
        <tbody>{rows.map(({ f, X }) => {
          const top = X.R.filter((x) => x.s === 'bad' || x.s === 'warn').sort((a, b) => (b.amt ?? 0) - (a.amt ?? 0)).slice(0, 2);
          return (
            <tr key={f.id}>
              <td><b>{(f.settings as { short?: string }).short || f.name}</b></td>
              <td className="n">{X.bad || ''}</td><td className="n">{X.warn || ''}</td>
              <td className="n">{X.exp ? <b style={{ color: 'var(--bad)' }}>{fmt(X.exp)}</b> : '—'}</td>
              <td style={{ fontSize: 12 }}>{top.length ? top.map((x, i) => <div key={i}>{x.s === 'bad' ? '⛔ ' : '⚠ '}{x.r.t}{x.amt ? ` (${fmt(x.amt)})` : ''}</div>) : <span className="muted">во ред</span>}</td>
              <td><PickFirm id={f.id} /></td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </>
  );
}
