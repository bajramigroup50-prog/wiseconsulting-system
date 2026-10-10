/**
 * Legacy `VIEWS.klDash` (11588 + 14975 month table / report) — Табла – анализа на работењето: turnover (invoices +
 * cash register), purchases, class-4 expenses, money, receivables and payables for a period; chart by day / month with
 * drill-down, turnover by weekday, top items / expenses / customers / suppliers, month table; the report for the client
 * (print / e-mail).
 * Gaps: the industry cards of `kdActivity` (tables, vehicles, construction sites, rooms) and the client-portal
 * section (legacy `KL_SEC` „dash“) — this screen is office-only here.
 */
import Link from 'next/link';
import { KD_EXP, KD_PER, isKdPer, kdRange } from '@wise/core/firms/dash';
import { currentYear } from '@/lib/context';
import { officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { mailReport } from './actions';
import { kdData, kdMon } from './data';
import { KdChart, KdMonTable, KdRank, fi } from './parts';

const WN = ['Нед', 'Пон', 'Вто', 'Сре', 'Чет', 'Пет', 'Саб'];

export default async function KlDashPage({ searchParams }: { searchParams: Promise<{ p?: string; f?: string; t?: string; sel?: string }> }) {
  const { firm } = await officePage('klDash');
  if (!firm) return <NoFirm t="Анализа на работењето" />;
  const sp = await searchParams;
  const year = await currentYear();
  const P = isKdPer(sp.p) ? sp.p : 'ytd';
  const [from, to, pl] = kdRange(year, P, today(), sp.f, sp.t);
  const R = await kdData(firm, year, from, to);
  const res = R.sales - R.pur;
  const wd = [0, 0, 0, 0, 0, 0, 0];
  for (const [d, v] of Object.entries(R.days)) wd[new Date(d + 'T12:00:00Z').getUTCDay()]! += v.inv + v.kasa;
  const wmx = Math.max(1, ...wd);
  const selK = sp.sel && /^\d{4}-\d{2}(-\d{2})?$/.test(sp.sel) ? sp.sel : null;
  const sel = selK ? Object.entries(R.days).filter(([d]) => (selK.length === 7 ? d.startsWith(selK) : d === selK)) : null;
  const base = { p: P, ...(P === 'c' ? { f: from, t: to } : {}) };
  const href = (k: string | null) => '/klDash?' + new URLSearchParams({ ...base, ...(k ? { sel: k } : {}) }).toString();
  const qs = new URLSearchParams(base).toString();
  const S = (k: 'inv' | 'kasa' | 'pur' | 'exp') => sel!.reduce((a, [, v]) => a + v[k], 0);
  return (
    <>
      <Hd t="Анализа на работењето" sub={`${firm.name} · ${pl}: ${dmy(from)} – ${dmy(to)}`}>
        <Link className="btn" href={`/klDash/pecati?${qs}`} target="_blank">📄 Извештај за клиентот (PDF)</Link>
      </Hd>
      <div className="card">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {KD_PER.map(([k, n]) => <Link key={k} className={`btn sm ${P === k ? 'pri' : ''}`} href={`/klDash?p=${k}`}>{n}</Link>)}
          {P === 'c' && (
            <form className="row" style={{ gap: 6 }}>
              <input type="hidden" name="p" value="c" />
              <input name="f" type="date" defaultValue={from} style={{ width: 'auto' }} /><input name="t" type="date" defaultValue={to} style={{ width: 'auto' }} />
              <button className="btn sm">Прикажи</button>
            </form>
          )}
        </div>
      </div>
      <details className="card">
        <summary><b>✉ Испрати го извештајот на клиентот</b></summary>
        <ActionForm action={mailReport} className="" reset={false}>
          <input type="hidden" name="p" value={P} /><input type="hidden" name="f" value={from} /><input type="hidden" name="t" value={to} />
          <label className="f">Е-пошта на клиентот<input name="to" type="email" defaultValue={firm.email ?? ''} required /></label>
          <button className="btn pri">✉ Испрати</button>
        </ActionForm>
      </details>
      <div className="kd-kpi">
        <div className="tile"><span>Вкупен промет</span><b>{fi(R.sales)}</b><i>фактури {fi(R.inv)} · каса {fi(R.kasa)}</i></div>
        <div className="tile"><span>Набавки</span><b>{fi(R.pur)}</b><i>{R.nPur} влезни фактури</i></div>
        <div className="tile"><span>Промет − набавки</span><b style={{ color: res >= 0 ? 'var(--good)' : 'var(--bad)' }}>{fi(res)}</b><i>грубо, без залиха и плати</i></div>
        <div className="tile"><span>Трошоци (класа 4)</span><b>{fi(R.expT)}</b><i>материјали, услуги, плати…</i></div>
        <div className="tile"><span>Пари (банка + каса)</span><b>{fi(R.cash)}</b><i>на {dmy(to)}</i></div>
        <div className="tile"><span>Купувачи ни должат</span><b>{fi(R.rec)}</b><i>отворени побарувања</i></div>
        <div className="tile"><span>Ние должиме</span><b>{fi(R.pay)}</b><i>кон добавувачи</i></div>
      </div>
      <div className="card">
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Приходи и набавки</h2></div>
        <KdChart R={R} from={from} to={to} sel={selK} href={href} />
        {sel && (
          <div className="callout" style={{ marginTop: 8 }}>
            <b>{selK!.length === 7 ? selK : dmy(selK)}</b> · приходи {fi(S('inv') + S('kasa'))} (фактури {fi(S('inv'))}, каса {fi(S('kasa'))}) · набавки {fi(S('pur'))} · трошоци {fi(S('exp'))}{' '}
            <Link className="btn sm ghost" href={href(null)} scroll={false}>✕</Link>
          </div>
        )}
      </div>
      {kdMon(R).length >= 2 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Преглед по месеци</h2><KdMonTable R={R} /></div>}
      <div className="kd-grid">
        {R.kasa > 0 && (
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Промет по ден во неделата</h2>
            {[1, 2, 3, 4, 5, 6, 0].map((i) => (
              <div key={i} className="row" style={{ gap: 8, alignItems: 'center', margin: '3px 0' }}>
                <span className="mini" style={{ width: 32 }}>{WN[i]}</span>
                <div className="kd-meter" style={{ flex: 1, height: 14, margin: 0 }}><i style={{ width: `${Math.round(wd[i]! / wmx * 100)}%` }} /></div>
                <span className="mini num" style={{ width: 110, textAlign: 'right' }}>{fi(wd[i]!)}</span>
              </div>
            ))}
            <p className="mini" style={{ margin: '6px 0 0' }}>Кои денови носат најмногу промет (корисно за ресторан, продавница, смени).</p>
          </div>
        )}
        {Object.keys(R.items).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Најпродавани артикли / услуги</h2><KdRank obj={R.items} lab="продажби" /></div>}
        {Object.keys(R.exp).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Трошоци по вид (излези)</h2><KdRank obj={Object.fromEntries(Object.entries(R.exp).map(([g, v]) => [KD_EXP[g] ?? 'Конто ' + g, v]))} lab="трошоци" /></div>}
        {Object.keys(R.cust).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Најголеми купувачи</h2><KdRank obj={R.cust} lab="фактури" /></div>}
        {Object.keys(R.sup).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Најголеми добавувачи</h2><KdRank obj={R.sup} lab="набавки" /></div>}
      </div>
      <p className="note">Податоците се од книговодството на канцеларијата (прокнижени документи). Документите што клиентот ги испратил, а уште не се прокнижени, не се вклучени.</p>
    </>
  );
}
