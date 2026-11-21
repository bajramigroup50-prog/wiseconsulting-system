/**
 * „💧 Паричен тек – прогноза“ (Анализи; client portal section `cash`, read-only): 30 / 60 / 90 days per day from today's
 * bank balances — open sales invoices by due date (with the customer's average delay), open purchase invoices,
 * salaries + contributions on the usual pay day, VAT on its due date, loan instalments, recurring payments from the
 * statements, and the firm's own one-off items (`@wise/core/cashflow`, data `lib/cashflow.ts`). The first day below
 * zero / below the minimum is highlighted; warnings; „⬇ Excel“ (`./xlsx`) and „⬇ PDF“ of the print area.
 */
import Link from 'next/link';
import { CF_KIND, type CfDay, type CfKind } from '@wise/core/cashflow';
import { kfmt } from '@wise/core/analysis';
import { cfOptsFrom, cfSettings, loadCashflow } from '@/lib/cashflow';
import { dmy, fmt } from '@/lib/fmt';
import { todayIso } from '@/lib/stock';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PdfButton } from '@/components/pdf-button';
import { RowAction } from '@/components/row-action';
import { addManualAction, delManualAction, saveMinAction } from './actions';
import { cfPage } from './guard';

type SP = { h?: string; min?: string; late?: string; delay?: string; cash?: string; v?: string };

const qs = (sp: SP, over: Partial<SP>) => {
  const o = { ...sp, ...over };
  const p = Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return p ? '?' + p : '';
};

function Tile({ lab, val, sub, st }: { lab: string; val: React.ReactNode; sub?: React.ReactNode; st?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`tile kt ${st === 'good' ? 't1' : st === 'bad' ? 't7' : st === 'warn' ? 't2' : 't3'}`}>
      <div className="kh"><span>{lab}</span></div>
      <b className="num">{val}</b><i>{sub}</i>
    </div>
  );
}

function Chart({ days, start, min, firstNeg, firstMin }: { days: CfDay[]; start: number; min: number; firstNeg: string | null; firstMin: string | null }) {
  const W = 1100, H = 300, L0 = 64, T = 16, B = 30, ph = H - T - B;
  const V = days.map((d) => d.bal);
  const lo = Math.min(0, min, ...V, ...days.map((d) => -d.out)), hi = Math.max(1, start, min, ...V, ...days.map((d) => d.inn));
  const cw = (W - L0 - 12) / Math.max(1, days.length - 1);
  const xx = (i: number) => L0 + i * cw, yy = (v: number) => T + ph - (v - lo) / ((hi - lo) || 1) * ph;
  const bw = Math.max(1.5, Math.min(10, cw / 2.6));
  const step = days.length > 62 ? 14 : 7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Паричен тек по ден">
      <line x1={L0} x2={W - 8} y1={yy(0)} y2={yy(0)} stroke="var(--muted)" />
      {min > 0 && <><line x1={L0} x2={W - 8} y1={yy(min)} y2={yy(min)} stroke="var(--warn, #d8a400)" strokeDasharray="5 4" />
        <text x={W - 10} y={yy(min) - 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">минимум {kfmt(min)}</text></>}
      <text x={L0 - 6} y={yy(hi) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{kfmt(hi)}</text>
      <text x={L0 - 6} y={yy(0) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">0</text>
      {lo < 0 && <text x={L0 - 6} y={yy(lo) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{kfmt(lo)}</text>}
      {days.map((d, i) => (
        <g key={'b' + i}><title>{`${dmy(d.date)} · приливи ${fmt(d.inn)} · одливи ${fmt(d.out)} · состојба ${fmt(d.bal)}`}</title>
          {d.inn > 0 && <rect x={xx(i) - bw} y={yy(d.inn)} width={bw} height={yy(0) - yy(d.inn)} rx="1" fill="var(--good)" opacity=".5" />}
          {d.out > 0 && <rect x={xx(i)} y={yy(0)} width={bw} height={yy(-d.out) - yy(0)} rx="1" fill="var(--bad)" opacity=".5" />}
        </g>
      ))}
      <path d={V.map((v, i) => `${i ? 'L' : 'M'}${xx(i).toFixed(1)},${yy(v).toFixed(1)}`).join('')} fill="none" stroke="var(--c1)" strokeWidth="2.5" />
      {days.map((d, i) => {
        const mark = d.date === firstNeg || d.date === firstMin;
        return (
          <g key={'p' + i}>
            {mark && <circle cx={xx(i)} cy={yy(d.bal)} r={6} fill={d.date === firstNeg ? 'var(--bad)' : '#d8a400'} stroke="var(--panel)" strokeWidth="2"><title>{`${dmy(d.date)}: ${fmt(d.bal)}`}</title></circle>}
            {i % step === 0 && <text x={xx(i)} y={H - 10} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{i ? dmy(d.date).slice(0, 5) : 'денес'}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export default async function ParicenTekPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, ro, u } = await cfPage();
  if (!firm) return <NoFirm t="💧 Паричен тек – прогноза" />;
  const today = todayIso();
  const o = cfOptsFrom(sp, cfSettings(firm));
  const C = await loadCashflow(firm, today, o);
  const P = C.plan;
  const view = sp.v === 'w' ? 'w' : 'd';
  const endBal = P.days.at(-1)!.bal;
  const negD = P.firstNeg?.date ?? null, minD = P.firstMin?.date ?? null;
  const portal = u.role === 'klient';
  const kinds = (Object.keys(CF_KIND) as CfKind[]).filter((k) => P.totals[k]);

  return (
    <>
      <Hd t="💧 Паричен тек – прогноза" sub={`${firm.name} · ${o.horizon} дена од ${dmy(today)}`} exp={false}>
        <a className="btn" href={'/paricenTek/xlsx' + qs(sp, {})} title="Секој ден, неделите и ставките во Excel">⬇ Excel</a>
        <PdfButton selector="#cfArea" title={`Paricen_tek_${o.horizon}_dena`} landscape />
        {!portal && <Link className="btn ghost" href="/analizi?t=cash" title="13-неделниот паричен тек и финансиското здравје">Анализи · 13 недели</Link>}
      </Hd>

      <form className="dfilter noprint" method="get" action="/paricenTek" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="mini">Период:</span>
        {[30, 60, 90].map((h) => <Link key={h} className={`chip ${o.horizon === h ? 'on' : ''}`} href={'/paricenTek' + qs(sp, { h: String(h) })}>{h} дена</Link>)}
        <input type="hidden" name="h" value={o.horizon} />
        <input type="hidden" name="v" value={view} />
        <label className="mini">Минимум на сметка{' '}
          <input name="min" inputMode="numeric" defaultValue={C.min ? String(C.min) : ''} placeholder="0" style={{ width: 110, textAlign: 'right' }} /></label>
        <label className="mini">Задоцнети побарувања{' '}
          <select name="late" defaultValue={o.lateIn == null ? 'no' : String(o.lateIn)}>
            <option value="0">денес</option><option value="7">за 7 дена</option><option value="14">за 14 дена</option><option value="30">за 30 дена</option><option value="no">не сметај</option>
          </select></label>
        <label className="mini chk"><input type="hidden" name="delay" value="0" /><input type="checkbox" name="delay" value="1" defaultChecked={o.useDelay} /> просечно доцнење на купувачот</label>
        <label className="mini chk"><input type="hidden" name="cash" value="0" /><input type="checkbox" name="cash" value="1" defaultChecked={o.cash} /> со благајна (1020)</label>
        <button className="btn sm">Пресметај</button>
      </form>

      <div id="cfArea">
        <div className="tiles kpi k4">
          <Tile lab="Пари денес" val={fmt(P.start)} sub={`${C.banks.length} сметки${o.cash && C.cash ? ` + благајна ${fmt(C.cash)}` : ''}`} />
          <Tile lab={`Приливи · ${o.horizon} дена`} val={fmt(P.inn)} sub="купувачи по рок, рачни" st="good" />
          <Tile lab={`Одливи · ${o.horizon} дена`} val={fmt(P.out)} sub="добавувачи, плати, ДДВ, рати" />
          <Tile lab="Најниска состојба" val={fmt(P.low.bal)} sub={negD ? `под нула од ${dmy(negD)}` : minD ? `под минимумот од ${dmy(minD)}` : `на ${dmy(P.low.date)} · на крај ${fmt(endBal)}`}
            st={negD ? 'bad' : minD ? 'warn' : 'good'} />
        </div>

        {P.warnings.length > 0 && (
          <div className={`callout ${negD ? 'bad' : minD ? 'warn' : ''}`} role={negD ? 'alert' : 'status'}>
            <b>Предупредувања</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{P.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <div className="card dash-chart"><div className="hd"><h2>Состојба по ден · {o.horizon} дена</h2>
          <div className="legend"><span><i style={{ background: 'var(--good)' }} />приливи</span><span><i style={{ background: 'var(--bad)' }} />одливи</span><span><i style={{ background: 'var(--c1)' }} />состојба</span></div></div>
          <Chart days={P.days} start={P.start} min={C.min} firstNeg={negD} firstMin={minD} />
        </div>

        <div className="card">
          <div className="hd"><h2>{view === 'w' ? 'По недели' : 'По денови (само денови со промена)'}</h2>
            <span className="row noprint" style={{ gap: 6 }}>
              <Link className={`chip ${view === 'd' ? 'on' : ''}`} href={'/paricenTek' + qs(sp, { v: 'd' })}>по ден</Link>
              <Link className={`chip ${view === 'w' ? 'on' : ''}`} href={'/paricenTek' + qs(sp, { v: 'w' })}>по недела</Link>
            </span></div>
          <div className="tw"><table>
            {view === 'w' ? (
              <>
                <thead><tr><th>Недела</th><th className="n">Приливи</th><th className="n">Одливи</th><th className="n">Нето</th><th className="n">Состојба на крај</th></tr></thead>
                <tbody>{P.weeks.map((w) => (
                  <tr key={w.from} style={w.bal < 0 ? { background: 'color-mix(in srgb, var(--bad) 10%, transparent)' } : undefined}>
                    <td>{dmy(w.from)} – {dmy(w.to)}</td><td className="n">{fmt(w.inn)}</td><td className="n">{fmt(w.out)}</td>
                    <td className="n" style={{ color: w.inn - w.out < 0 ? 'var(--bad)' : undefined }}>{fmt(w.inn - w.out)}</td>
                    <td className="n"><b style={{ color: w.bal < 0 ? 'var(--bad)' : w.bal < C.min ? '#b07d00' : undefined }}>{fmt(w.bal)}</b></td></tr>))}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th>Датум</th><th>Ставки</th><th className="n">Приливи</th><th className="n">Одливи</th><th className="n">Состојба</th></tr></thead>
                <tbody>
                  <tr><td>{dmy(today)}</td><td className="mini">почетна состојба (банки{o.cash ? ' + благајна' : ''})</td><td /><td /><td className="n"><b>{fmt(P.start)}</b></td></tr>
                  {P.days.filter((d) => d.items.length).map((d) => (
                    <tr key={d.date} style={d.date === negD ? { background: 'color-mix(in srgb, var(--bad) 14%, transparent)' } : d.date === minD ? { background: 'color-mix(in srgb, #d8a400 16%, transparent)' } : undefined}>
                      <td>{dmy(d.date)}{d.date === negD && <> <span className="pill bad">под нула</span></>}{d.date === minD && d.date !== negD && <> <span className="pill warn">под минимум</span></>}</td>
                      <td className="mini">{d.items.slice(0, 6).map((i, k) => <div key={k}>{CF_KIND[i.kind]}: {i.label}{i.ref ? ` · ${i.ref}` : ''} <b className="num">{fmt(i.amount)}</b></div>)}
                        {d.items.length > 6 && <div>… уште {d.items.length - 6}</div>}</td>
                      <td className="n">{d.inn ? fmt(d.inn) : ''}</td><td className="n">{d.out ? fmt(d.out) : ''}</td>
                      <td className="n"><b style={{ color: d.bal < 0 ? 'var(--bad)' : d.bal < C.min ? '#b07d00' : undefined }}>{fmt(d.bal)}</b></td>
                    </tr>))}
                  {!P.days.some((d) => d.items.length) && <tr><td colSpan={5} className="empty">Нема очекувани приливи или одливи во периодот.</td></tr>}
                </tbody>
              </>
            )}
          </table></div>
        </div>

        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div className="card"><div className="hd"><h2>Збир по вид</h2></div>
            <div className="tw"><table><tbody>
              {kinds.map((k) => <tr key={k}><td>{CF_KIND[k]}</td><td className="n" style={{ color: P.totals[k] < 0 ? 'var(--bad)' : 'var(--good)' }}>{fmt(P.totals[k])}</td></tr>)}
              {!kinds.length && <tr><td className="empty">—</td></tr>}
            </tbody></table></div>
          </div>
          <div className="card"><div className="hd"><h2>Почетна состојба</h2></div>
            <div className="tw"><table><tbody>
              {C.banks.map((b) => <tr key={b.konto}><td>{b.name} <span className="mini">({b.konto}{b.last ? ` · извод ${dmy(b.last)}` : ''})</span></td><td className="n">{fmt(b.bal)}</td></tr>)}
              <tr><td>Благајна <span className="mini">(1020{o.cash ? '' : ' – не е вклучена'})</span></td><td className="n">{fmt(C.cash)}</td></tr>
            </tbody></table></div>
          </div>
          <div className="card"><div className="hd"><h2>Претпоставки</h2></div>
            <ul className="mini" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Плати: {C.payroll ? <>нето {fmt(C.payroll.net)} + придонеси и ПДД {fmt(C.payroll.contrib)} на {C.payroll.day}-ти во месецот (последна пресметка {C.payroll.month})</> : 'нема книжена пресметка на плата'}.</li>
              <li>ДДВ: {C.vatKind ? `${C.vatKind === 'month' ? 'месечно' : 'тримесечно'}, на 25-ти по периодот; следните периоди се проценка со износот од последниот` : 'фирмата не е ДДВ обврзник'}.</li>
              <li>Задоцнети побарувања: {o.lateIn == null ? 'не се сметаат' : o.lateIn ? `очекувани за ${o.lateIn} дена` : 'очекувани денес'}; задоцнетите обврски се сметаат за плаќање денес.</li>
              {C.recurring.length > 0 && <li>Редовни плаќања и рати: {C.recurring.map((r) => `${r.label} ${fmt(r.amount)} (${r.day}-ти)`).join('; ')}.</li>}
              {o.useDelay && C.delays.length > 0 && <li>Просечно доцнење: {C.delays.slice(0, 8).map((d) => `${d.name} ${d.days} дена`).join('; ')}.</li>}
            </ul>
          </div>
        </div>
      </div>

      <div className="card noprint">
        <div className="hd"><h2>Рачни ставки</h2><span className="note">еднократни приливи / одливи што ги нема во книгите (позајмица, продажба на опрема, аванс …)</span></div>
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Опис</th><th className="n">Износ</th>{!ro && <th />}</tr></thead>
          <tbody>
            {C.manual.map((m) => (
              <tr key={m.id ?? m.date + m.label}><td>{dmy(m.date)}</td><td>{m.label}</td><td className="n" style={{ color: m.amount < 0 ? 'var(--bad)' : 'var(--good)' }}>{fmt(m.amount)}</td>
                {!ro && <td>{m.id && <RowAction action={delManualAction.bind(null, m.id)} label="✕" title="Избриши" confirm={`Да се избрише „${m.label}“?`} />}</td>}</tr>))}
            {!C.manual.length && <tr><td colSpan={4} className="empty">Нема рачни ставки.</td></tr>}
          </tbody>
        </table></div>
        {!ro && (
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <ActionForm action={addManualAction} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="mini">Датум<br /><input type="date" name="date" required min={today} defaultValue={today} /></label>
              <label className="mini">Вид<br /><select name="dir" defaultValue="out"><option value="out">одлив</option><option value="in">прилив</option></select></label>
              <label className="mini">Износ<br /><input name="amount" inputMode="decimal" required style={{ width: 120, textAlign: 'right' }} /></label>
              <label className="mini">Опис<br /><input name="label" maxLength={120} style={{ width: 240 }} /></label>
              <Submit className="btn sm pri">+ Додади</Submit>
            </ActionForm>
            <ActionForm action={saveMinAction} className="row" reset={false} style={{ gap: 8, alignItems: 'flex-end' }}>
              <label className="mini">Минимум на сметка (се памти за фирмата)<br /><input name="min" inputMode="numeric" defaultValue={String(cfSettings(firm).min ?? '')} style={{ width: 120, textAlign: 'right' }} /></label>
              <Submit className="btn sm">Зачувај минимум</Submit>
            </ActionForm>
          </div>
        )}
        {ro && portal && <p className="note">Прогнозата ја подготвува канцеларијата од вашите книжења – за промени јавете се на вашиот сметководител.</p>}
      </div>
    </>
  );
}
