/**
 * The six tabs of „Анализи и извештаи“ (legacy `VIEWS.analizi` 5297), shared by the screen and the print view
 * `/print/analizi` (legacy `anPdf`: one tab, or every tab in one report).
 */
import {
  abc, aggBy, anDays, anRange, byMonth, byWeekday, cashForecast, cls, customerRisk, dashAgg, heatGrid, kfmt, MON,
  ratios, salesLines, supplierRows, WEEKDAYS, WEEKDAYS_LONG, type Status,
} from '@wise/core/analysis';
import { stock } from '@wise/core/stock';
import type { Firm } from '@wise/db';
import { loadAnalysis, loadFinance } from '@/lib/analysis';
import { dmy, fmt, fq } from '@/lib/fmt';
import { DownloadCsv } from '@/components/download-csv';

const r2 = (x: number) => Math.round(x * 100) / 100;
const ST: Record<string, string> = { good: 'добро', bad: 'ризик', warn: 'внимание' };

function Kpi({ lab, val, sub, st, tip }: { lab: string; val: React.ReactNode; sub?: React.ReactNode; st?: Status; tip?: string }) {
  return (
    <div className={`tile kt ${st === 'good' ? 't1' : st === 'bad' ? 't7' : st === 'warn' ? 't2' : 't3'}`} title={tip}>
      <div className="kh"><span>{lab}</span>{st && <em className={`pill ${st}`}>{ST[st]}</em>}</div>
      <b className="num">{val}</b><i>{sub}</i>
    </div>
  );
}

function HBars({ rows, unit }: { rows: { n: string; v: number; x?: string }[]; unit: string }) {
  if (!rows.length) return <div className="empty">Нема податоци за периодот.</div>;
  const mx = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <ul className="hbars">{rows.map((r) => (
      <li key={r.n} title={`${r.n} · ${unit}: ${fmt(r.v)}${r.x ? ' · ' + r.x : ''}`}>
        <span className="hb-n">{r.n}</span>
        <span className="hb-t"><i style={{ width: `${Math.max(1.5, Math.abs(r.v) / mx * 100)}%`, background: 'var(--c1)' }} /></span>
        <b className="num">{kfmt(r.v)}</b>
      </li>
    ))}</ul>
  );
}

type Col<T> = [string, (r: T) => React.ReactNode, boolean?, ((r: T) => string | number)?];
function AnTable<T>({ cols, rows, csv }: { cols: Col<T>[]; rows: T[]; csv?: string }) {
  return (
    <>
      {csv && <div className="row" style={{ justifyContent: 'flex-end' }}><DownloadCsv name={`Analiza_${csv}.csv`} label="Excel" rows={[cols.map((c) => c[0]), ...rows.map((r) => cols.map((c) => (c[3] ? c[3](r) : String(c[1](r) ?? ''))))]} /></div>}
      <div className="tw"><table>
        <thead><tr>{cols.map((c) => <th key={c[0]} className={c[2] ? 'n' : ''}>{c[0]}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c[0]} className={c[2] ? 'n' : ''}>{c[1](r)}</td>)}</tr>)
          : <tr><td colSpan={cols.length} className="empty">Нема податоци за периодот.</td></tr>}</tbody>
      </table></div>
    </>
  );
}


export async function AnBody({ firm, year, tab, per, today }: { firm: Firm; year: number; tab: string; per: string; today: string }) {
  const r = anRange(per, year, today);
  const days = anDays(r, today);
  let body: React.ReactNode = null;

  if (tab === 'sales' || tab === 'prod' || tab === 'part' || tab === 'time') {
    const D = await loadAnalysis(firm);
    const L = salesLines(D.invoices, D.pos, D.costOf, r.from, r.to);
    const locName = (k: string) => D.stock.locName(k);
    if (tab === 'sales') {
      const net = r2(L.reduce((a, l) => a + l.net, 0)), cost = r2(L.reduce((a, l) => a + l.cost, 0));
      const inv = D.invoices.filter((i) => !i.credit && i.date >= r.from && i.date <= r.to);
      const base = (i: (typeof inv)[number]) => i.lines.reduce((a, l) => a + l.qty * l.price * (1 - l.disc / 100) * i.fx, 0);
      const avg = inv.length ? r2(inv.reduce((a, i) => a + base(i), 0) / inv.length) : 0;
      const byW = aggBy(L, (l) => l.wh, (_l, k) => locName(k));
      const byC = aggBy(L, (l) => l.partner, (_l, k) => D.partnerName(k));
      const bm = byMonth(L);
      body = <>
        <div className="tiles kpi k4">
          <Kpi lab="Продажба без ДДВ" val={fmt(net)} sub={`просечно дневно ${fmt(r2(net / days))}`} />
          <Kpi lab="Бруто разлика (маржа)" val={fmt(r2(net - cost))} sub={net ? `маржа ${Math.round((net - cost) / net * 1000) / 10}%` : '—'} st={cls(net ? (net - cost) / net * 100 : null, 20, 8)} tip="Продажба − набавна вредност на продаденото. Цел: над 20%" />
          <Kpi lab="Фактури" val={inv.length} sub={`просечна фактура ${fmt(avg)}`} />
          <Kpi lab="Купувачи" val={byC.length} sub="активни во периодот" />
        </div>
        <div className="cols">
          <div className="card"><div className="hd"><h2>Продажба по објект</h2></div><HBars unit="Продажба без ДДВ" rows={byW.map((x) => ({ n: x.n, v: x.net, x: `маржа ${x.mgp ?? '—'}%` }))} /></div>
          <div className="card"><div className="hd"><h2>Продажба по месец</h2></div><HBars unit="Продажба без ДДВ" rows={MON.map((n, i) => ({ n, v: bm[i]! })).filter((x) => x.v)} /></div>
        </div>
        <div className="card"><div className="hd"><h2>Топ купувачи</h2></div>
          <AnTable csv="kupuvaci" rows={byC.slice(0, 30)} cols={[['Купувач', (x) => x.n], ['Ставки', (x) => x.cnt, true], ['Продажба', (x) => fmt(x.net), true, (x) => x.net], ['Набавна', (x) => fmt(x.cost), true, (x) => x.cost], ['Разлика', (x) => fmt(x.mg), true, (x) => x.mg], ['Маржа %', (x) => (x.mgp == null ? '—' : `${x.mgp}%`), true], ['Последна', (x) => dmy(x.last)]]} /></div>
      </>;
    } else if (tab === 'prod') {
      const P = abc(aggBy(L.filter((l) => l.item), (l) => l.item, (l, k) => D.stock.items.get(k)?.name ?? l.name));
      const ctx = D.stock.ctx;
      const rows = D.tracked.map((it) => {
        const s = stock(ctx, it.id);
        const p = P.find((x) => x.k === it.id);
        const dq = p ? p.qty / days : 0;
        const last = p?.last || D.lastSale.get(it.id) || '';
        const idle = last ? Math.round((Date.parse(today) - Date.parse(last)) / 864e5) : null;
        return { it, s, p, cov: dq > 0 ? Math.round(s.qty / dq) : null, last, idle };
      });
      const slow = rows.filter((x) => x.s.qty > 0 && (x.idle == null || x.idle > 60)).sort((a, b) => b.s.value - a.s.value);
      const deadV = r2(slow.reduce((a, x) => a + x.s.value, 0));
      const out = rows.filter((x) => x.cov != null && x.cov < 7 && x.s.qty >= 0).sort((a, b) => a.cov! - b.cov!);
      const sq = (id: string) => stock(ctx, id).qty;
      body = <>
        <div className="tiles kpi k4">
          <Kpi lab="Артикли А (80% од продажбата)" val={P.filter((x) => x.cls === 'A').length} sub={`од вкупно ${P.length} продавани`} />
          <Kpi lab="Бавни / мртви залихи" val={fmt(deadV)} sub={`${slow.length} артикли без продажба 60+ дена`} st={deadV > 0 ? 'warn' : 'good'} tip="Пари заробени во стока што не се продава. Совет: попуст, акција, враќање на добавувач" />
          <Kpi lab="Ќе снема за < 7 дена" val={out.length} sub="според просечната продажба" st={out.length ? 'bad' : 'good'} />
          <Kpi lab="Вредност на залиха" val={fmt(r2(rows.reduce((a, x) => a + x.s.value, 0)))} sub="по набавна вредност" />
        </div>
        <div className="card"><div className="hd"><h2>ABC анализа на производи</h2></div>
          <p className="note">А = мал број производи што носат 80% од продажбата (секогаш на залиха, најдобро место), B = следните 15%, C = остатокот (кандидати за намалување на асортиманот).</p>
          <AnTable csv="abc" rows={P.slice(0, 60)} cols={[
            ['ABC', (x) => <span className={`pill ${x.cls === 'A' ? 'good' : x.cls === 'B' ? 'info' : ''}`}>{x.cls}</span>, false, (x) => x.cls],
            ['Производ', (x) => x.n], ['Количина', (x) => fq(x.qty), true, (x) => x.qty], ['Продажба', (x) => fmt(x.net), true, (x) => x.net],
            ['Удел', (x) => `${x.share}%`, true], ['Разлика', (x) => fmt(x.mg), true, (x) => x.mg], ['Маржа %', (x) => (x.mgp == null ? '—' : `${x.mgp}%`), true],
            ['Залиха', (x) => fq(sq(x.k)), true, (x) => sq(x.k)],
            ['Покриеност', (x) => { const dq = x.qty / days; return dq > 0 ? `${Math.round(sq(x.k) / dq)} дена` : '—'; }, true],
          ]} /></div>
        <div className="cols">
          <div className="card"><div className="hd"><h2>Бавни и мртви залихи</h2></div>
            <AnTable rows={slow.slice(0, 15)} cols={[['Производ', (x) => x.it.name ?? ''], ['Залиха', (x) => fq(x.s.qty), true], ['Вредност', (x) => fmt(x.s.value), true], ['Последна продажба', (x) => (x.last ? `${dmy(x.last)} (${x.idle} д.)` : 'никогаш')]]} /></div>
          <div className="card"><div className="hd"><h2>Треба да се нарача</h2></div>
            <AnTable rows={out.slice(0, 15)} cols={[['Производ', (x) => x.it.name ?? ''], ['Залиха', (x) => fq(x.s.qty), true], ['Дневна продажба', (x) => fq(Math.round(x.p!.qty / days * 100) / 100), true], ['Покриеност', (x) => <span className="pill bad">{x.cov} дена</span>, true]]} /></div>
        </div>
      </>;
    } else if (tab === 'part') {
      const cust = customerRisk(D.invDocs, L, D.partnerName, today);
      const sup = supplierRows(D.purDocs, D.partnerName, r, today);
      const top1 = cust[0];
      const conc = cust.length && top1 ? Math.round(top1.rev / Math.max(1, cust.reduce((a, x) => a + x.rev, 0)) * 1000) / 10 : 0;
      body = <>
        <div className="tiles kpi k4">
          <Kpi lab="Концентрација на купувачи" val={`${conc}%`} sub={`најголемиот купувач (${top1?.n ?? '—'})`} st={cls(conc, 30, 50, true)} tip="Ако еден купувач носи над 50% од прометот, бизнисот е ранлив. Цел: под 30%" />
          <Kpi lab="Ризични купувачи" val={cust.filter((x) => x.risk === 'bad').length} sub="доцнење над 90 дена или голем дел задоцнет" st={cust.some((x) => x.risk === 'bad') ? 'bad' : 'good'} />
          <Kpi lab="Задоцнети побарувања" val={fmt(r2(cust.reduce((a, x) => a + x.lateV, 0)))} sub={`${cust.filter((x) => x.lateV).length} купувачи`} />
          <Kpi lab="Плаќања кон добавувачи – 7 дена" val={fmt(r2(sup.reduce((a, x) => a + x.due7, 0)))} sub="планирајте ги парите" />
        </div>
        <div className="card"><div className="hd"><h2>Купувачи – промет, долг и ризик</h2></div>
          <AnTable csv="kupuvaci_rizik" rows={cust} cols={[
            ['Ризик', (x) => <span className={`pill ${x.risk}`}>{x.risk === 'good' ? 'низок' : x.risk === 'warn' ? 'среден' : 'висок'}</span>, false, (x) => x.risk],
            ['Купувач', (x) => x.n], ['Промет (период)', (x) => fmt(x.rev), true, (x) => x.rev], ['Отворено', (x) => fmt(x.open), true, (x) => x.open],
            ['Задоцнето', (x) => (x.lateV ? <b style={{ color: 'var(--bad)' }}>{fmt(x.lateV)}</b> : '—'), true, (x) => x.lateV],
            ['Макс. доцнење', (x) => (x.maxLate ? `${x.maxLate} д.` : '—'), true, (x) => x.maxLate],
          ]} /></div>
        <div className="card"><div className="hd"><h2>Добавувачи</h2></div>
          <AnTable csv="dobavuvaci" rows={sup} cols={[['Добавувач', (x) => x.n], ['Набавки (период)', (x) => fmt(x.inP), true, (x) => x.inP], ['Отворено', (x) => fmt(x.open), true, (x) => x.open], ['Доспева за 7 дена', (x) => (x.due7 ? fmt(x.due7) : '—'), true, (x) => x.due7]]} /></div>
      </>;
    } else {
      const LC = salesLines(D.invoices, D.pos, D.costOf, `${year}-01-01`, `${year}-12-31`);
      const LY = salesLines(D.invoices, D.pos, D.costOf, `${year - 1}-01-01`, `${year - 1}-12-31`);
      const a = byMonth(LC), b = byMonth(LY), wd = byWeekday(LC), G = heatGrid(LC);
      const best = wd.indexOf(Math.max(...wd));
      const x = a.reduce((p, c) => p + c, 0), y = b.slice(0, +today.slice(5, 7)).reduce((p, c) => p + c, 0);
      const mx = Math.max(1, ...G.flat());
      const col = (v: number) => (v <= 0 ? 'var(--soft)' : `color-mix(in srgb,var(--c1) ${Math.round(12 + v / mx * 88)}%,var(--panel))`);
      const Wd = 1100, H = 260, Lf = 50, T = 14, B = 26, ph = H - T - B, cw = (Wd - Lf - 8) / 12, bw = Math.min(16, (cw - 10) / 2);
      const mxb = Math.max(1, ...a, ...b);
      const yv = (v: number) => T + ph - v / mxb * ph;
      body = <>
        <div className="tiles kpi k4">
          <Kpi lab="Најдобар ден" val={WEEKDAYS_LONG[best]} sub={`најголема продажба во ${year}`} />
          <Kpi lab="Најдобар месец" val={MON[a.indexOf(Math.max(...a))]} sub={fmt(r2(Math.max(...a)))} />
          <Kpi lab={`Раст во однос на ${year - 1}`} val={y ? `${Math.round((x - y) / y * 1000) / 10}%` : '—'} sub="ист период" />
          <Kpi lab="Сезонски врв" val={`${Math.round(Math.max(...a) / (x || 1) * 1000) / 10}%`} sub="од годишната продажба во еден месец" />
        </div>
        <div className="card"><div className="hd"><h2>Продажба по ден во седмицата и месец · {year}</h2></div>
          <div className="heat"><div />{MON.map((m) => <div className="hm" key={m}>{m}</div>)}
            {G.map((row, i) => [<div className="hw" key={`w${i}`}>{WEEKDAYS[i]}</div>, ...row.map((v, j) => <div className="hc" key={`${i}-${j}`} style={{ background: col(v) }} title={`${WEEKDAYS[i]} · ${MON[j]} · ${fmt(v)}`} />)])}
          </div>
        </div>
        <div className="card dash-chart"><div className="hd"><h2>Споредба по месеци: {year} и {year - 1}</h2>
          <div className="legend"><span><i style={{ background: 'var(--c1)' }} />{year}</span><span><i style={{ background: 'var(--muted)' }} />{year - 1}</span></div></div>
          <svg viewBox={`0 0 ${Wd} ${H}`} role="img" aria-label="Споредба по месеци">
            {[0, 0.25, 0.5, 0.75, 1].map((p) => <g key={p}><line x1={Lf} x2={Wd - 4} y1={yv(mxb * p)} y2={yv(mxb * p)} stroke="var(--line)" /><text x={Lf - 6} y={yv(mxb * p) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{kfmt(mxb * p)}</text></g>)}
            {MON.map((m, i) => { const x0 = Lf + i * cw + (cw - 2 * bw - 2) / 2; return (
              <g key={m}><title>{`${m} · ${year}: ${fmt(a[i]!)} · ${year - 1}: ${fmt(b[i]!)}`}</title>
                {b[i]! > 0 && <rect x={x0} y={yv(b[i]!)} width={bw} height={T + ph - yv(b[i]!)} rx="3" fill="var(--muted)" opacity=".45" />}
                {a[i]! > 0 && <rect x={x0 + bw + 2} y={yv(a[i]!)} width={bw} height={T + ph - yv(a[i]!)} rx="3" fill="var(--c1)" />}
                <text x={Lf + i * cw + cw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{m}</text></g>); })}
          </svg>
        </div>
      </>;
    }
  } else {
    const F = await loadFinance(firm, year, today);
    if (tab === 'cash') {
      const D = await loadAnalysis(firm);
      const C = cashForecast({ today, start: F.start, invoices: D.invDocs, purchases: D.purDocs, vat: F.vat ? { amount: F.vat.amount, due: F.vat.due } : null, payroll: F.payroll, fmt });
      const min = C.wk.reduce((m, w) => (w.bal < m.bal ? { bal: w.bal, from: w.from } : m), { bal: C.start, from: today });
      const V = [C.start, ...C.wk.map((w) => w.bal)];
      const W = 1100, H = 260, L0 = 56, T = 16, B = 30, ph = H - T - B;
      const lo = Math.min(0, ...V), hi = Math.max(1, ...V);
      const cw = (W - L0 - 12) / (V.length - 1), xx = (i: number) => L0 + i * cw, yy = (v: number) => T + ph - (v - lo) / ((hi - lo) || 1) * ph;
      body = <>
        <div className="tiles kpi k4">
          <Kpi lab="Пари денес" val={fmt(C.start)} sub="банки + благајна" />
          <Kpi lab="Очекувани приливи (90 д.)" val={fmt(r2(C.wk.reduce((a, w) => a + w.inn, 0)))} sub="по рок на фактурите" />
          <Kpi lab="Очекувани одливи (90 д.)" val={fmt(r2(C.wk.reduce((a, w) => a + w.out, 0)))} sub="добавувачи, ДДВ, плати" />
          <Kpi lab="Најниска состојба" val={fmt(min.bal)} sub={`околу ${dmy(min.from)}`} st={min.bal < 0 ? 'bad' : min.bal < C.start * 0.2 ? 'warn' : 'good'} tip="Ако е под нула, ќе недостигаат пари – наплатете или одложете плаќања" />
        </div>
        <div className="card dash-chart"><div className="hd"><h2>Прогноза на пари · следни 13 недели</h2><span className="note">задоцнети побарувања {fmt(C.lateIn)} не се вклучени (несигурни)</span></div>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Прогноза на пари 90 дена">
            <line x1={L0} x2={W - 8} y1={yy(0)} y2={yy(0)} stroke="var(--muted)" />
            <text x={L0 - 6} y={yy(hi) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{kfmt(hi)}</text>
            <text x={L0 - 6} y={yy(lo) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{kfmt(lo)}</text>
            <path d={V.map((v, i) => `${i ? 'L' : 'M'}${xx(i).toFixed(1)},${yy(v).toFixed(1)}`).join('')} fill="none" stroke="var(--c1)" strokeWidth="2" />
            {V.map((v, i) => <g key={i}><title>{`${i ? 'Недела од ' + dmy(C.wk[i - 1]!.from) : 'Денес'}: ${fmt(v)}`}</title>
              <circle cx={xx(i)} cy={yy(v)} r={v < 0 ? 5 : 3.5} fill={v < 0 ? 'var(--bad)' : 'var(--c1)'} stroke="var(--panel)" strokeWidth="2" />
              {i % 2 === 0 && <text x={xx(i)} y={H - 10} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{i ? dmy(C.wk[i - 1]!.from).slice(0, 5) : 'денес'}</text>}</g>)}
          </svg>
        </div>
        <div className="card"><AnTable csv="prognoza" rows={C.wk} cols={[['Недела од', (w) => dmy(w.from)], ['Приливи', (w) => fmt(w.inn), true, (w) => w.inn], ['Одливи', (w) => fmt(w.out), true, (w) => w.out], ['Вклучено', (w) => w.items.join(', ')], ['Состојба', (w) => <b style={{ color: w.bal < 0 ? 'var(--bad)' : 'inherit' }}>{fmt(w.bal)}</b>, true, (w) => w.bal]]} /></div>
      </>;
    } else {
      const rg = { from: `${year}-01-01`, to: today.startsWith(String(year)) ? today : `${year}-12-31` };
      const D = await loadAnalysis(firm);
      const pur = D.purDocs.filter((p) => p.date >= rg.from && p.date <= rg.to).reduce((a, p) => a + p.total, 0);
      const R = ratios({ balance: F.balance, agg: dashAgg(F.lines, rg.from, rg.to), purchases: pur, days: anDays(rg, today) });
      const card = (n: string, v: React.ReactNode, st: Status, exp: string, norm?: string) => (
        <div className="card kpic" key={n}><div className="hd"><h3 style={{ margin: 0 }}>{n}</h3>{st && <span className={`pill ${st}`}>{ST[st]}</span>}</div>
          <b className="num big">{v}</b><p className="note" style={{ margin: '6px 0 0' }}>{exp}</p>{norm && <p className="mini" style={{ margin: '4px 0 0' }}>Норма: {norm}</p>}</div>
      );
      body = <>
        <p className="note">Показатели од книговодството за {year} (до денес). Кратко објаснување под секој – за вас и за разговор со банка или сопственик.</p>
        <div className="kgrid">
          {card('Тековна ликвидност', R.cur ?? '—', cls(R.cur, 1.5, 1), 'Колку пати краткорочниот имот (пари, побарувања, залиха) ги покрива краткорочните обврски.', 'над 1,5')}
          {card('Брза ликвидност', R.quick ?? '—', cls(R.quick, 1, 0.7), 'Исто, но без залихата – дали можете да ги платите обврските без да продадете стока.', 'над 1,0')}
          {card('Парична ликвидност', R.cashR ?? '—', cls(R.cashR, 0.3, 0.1), 'Колкав дел од обврските може да се плати веднаш со парите на сметка.', '0,2 – 0,5')}
          {card('Денови на наплата (DSO)', R.dso != null ? `${R.dso} дена` : '—', cls(R.dso, 45, 90, true), 'Просечно по колку дена купувачите плаќаат. Помалку = подобро.', 'до 45 дена')}
          {card('Денови на плаќање (DPO)', R.dpo != null ? `${R.dpo} дена` : '—', '', 'По колку дена вие ги плаќате добавувачите.', 'близу до договорениот рок')}
          {card('Денови на залиха (DIO)', R.dio != null ? `${R.dio} дена` : '—', cls(R.dio, 60, 120, true), 'Колку дена стоката стои во магацин пред да се продаде.', 'зависи од дејноста; помалку = подобро')}
          {card('Готовински циклус (CCC)', R.ccc != null ? `${R.ccc} дена` : '—', cls(R.ccc, 30, 90, true), 'DSO + DIO − DPO: колку дена парите ви се „заробени“ од плаќање на добавувач до наплата од купувач.', 'колку помалку толку подобро')}
          {card('Бруто маржа', R.gm != null ? `${R.gm}%` : '—', cls(R.gm, 20, 8), 'Колку останува од продажбата по набавната вредност на продадената стока.', 'трговија 15–30%')}
          {card('Нето маржа', R.nm != null ? `${R.nm}%` : '—', cls(R.nm, 8, 0), 'Добивка пред данок во однос на приходите.', 'над 5–10%')}
          {card('Точка на рентабилност', R.be != null ? fmt(R.be) : '—', R.be != null ? (R.rev >= R.be ? 'good' : 'bad') : '', `Приход потребен за да се покријат фиксните трошоци (плати, амортизација, закупи): фиксни ${fmt(R.fixed)} / маргина на покритие ${R.cmr}%.${R.beM != null ? ` Месечно ≈ ${fmt(R.beM)}.` : ''}`, 'приходите да се над оваа граница')}
        </div>
      </>;
    }
  }

  return body;
}
