/**
 * Legacy `VIEWS.klDash` 11588 (+ `kdMonTbl` 14971) — Анализи › 📈 Табла – анализа на работењето: turnover (invoices +
 * cash register), purchases, class-4 costs, money, receivables and payables for a period, chart by day / month,
 * monthly table, weekday turnover and top items, costs, customers and suppliers (`@wise/core/kldash`).
 * Period is `?p=` (custom: `&f=&t=`) instead of `S.kdP`. The client report PDF / e-mail buttons are not ported.
 */
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { kdBuckets, kdData, KD_EXP, KD_PER, kdMonths, kdRange, kdRank } from '@wise/core/kldash';
import { priceAt } from '@wise/core/stock';
import { invoiceLines, invoices, loadLedgerLines, loadStockContext, partners, purchases, salesDaily } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { todayIso } from '@/lib/stock';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

const fi = (n: number) => Math.round(n).toLocaleString('mk-MK');
const MK_MON = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];

function Rank({ rows, empty }: { rows: ReturnType<typeof kdRank>; empty: string }) {
  if (!rows.length) return <p className="note" style={{ margin: 0 }}>Нема {empty} во периодот.</p>;
  const mx = Math.max(1, ...rows.map((x) => x.v));
  return (
    <table className="dense kd-rank"><tbody>{rows.map((x, i) => (
      <tr key={i}><td>{i + 1}</td><td>{x.n}{x.q ? <span className="mini"> {fi(x.q)} {x.u ?? ''}</span> : null}<div className="kd-meter"><i style={{ width: `${Math.round(x.v / mx * 100)}%` }} /></div></td><td className="n">{fi(x.v)}</td></tr>
    ))}</tbody></table>
  );
}

export default async function KlDashPage({ searchParams }: { searchParams: Promise<{ p?: string; f?: string; t?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('klDash');
  if (!firm) return <NoFirm t="Анализа на работењето" />;
  const today = todayIso();
  const P = KD_PER.some(([k]) => k === sp.p) ? sp.p! : 'ytd';
  const [from, to, pl] = kdRange(P, year, today, { from: sp.f, to: sp.t });
  const lFrom = from < `${year}-01-01` ? from : `${year}-01-01`;

  const [IV, PU, PA, SD, LL, SC] = await Promise.all([
    db().select().from(invoices).where(and(eq(invoices.firmId, firm.id), eq(invoices.status, 'posted'), inArray(invoices.kind, ['invoice', 'credit']))),
    db().select().from(purchases).where(and(eq(purchases.firmId, firm.id), eq(purchases.status, 'posted'))),
    db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)),
    db().select().from(salesDaily).where(and(eq(salesDaily.firmId, firm.id), eq(salesDaily.pending, false))),
    loadLedgerLines(db(), firm.id, lFrom, to),
    loadStockContext(db(), firm.id),
  ]);
  const ivIds = IV.filter((i) => i.date >= from && i.date <= to).map((i) => i.id);
  const LN = ivIds.length ? await db().select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ivIds)) : [];
  const pn = new Map(PA.map((p) => [p.id, p.name]));
  const ivDate = new Map(IV.map((i) => [i.id, i]));
  const items = new Map((SC.ctx.items ?? []).map((i) => [i.id, i]));
  const itemSales = [
    ...(SC.ctx.moves ?? []).filter((m) => !m.pend && m.type === 'sale' && m.qty < 0).flatMap((m) => {
      const it = items.get(m.item);
      if (!it) return [];
      const q = Math.abs(m.qty);
      return [{ date: m.date, key: it.id, name: it.name ?? '', unit: it.unit ?? '', qty: q, value: q * (priceAt(SC.ctx, it, m.wh || 'main', m.date) || Number(it.price ?? 0)) }];
    }),
    ...LN.filter((l) => !l.itemId).map((l) => {
      const inv = ivDate.get(l.invoiceId)!;
      return { date: inv.date, key: 'n:' + l.name, name: l.name || '—', unit: l.unit ?? '', qty: Number(l.qty), value: Number(l.qty) * Number(l.price) * (Number(inv.fx) || 1) };
    }),
  ];
  const R = kdData({
    invoices: IV.map((i) => ({ date: i.date, total: Math.abs(Number(i.total)) * (Number(i.fx) || 1) * (i.kind === 'credit' ? -1 : 1), partner: pn.get(i.partnerId ?? '') ?? '—' })),
    kasa: SD.flatMap((s) => (Array.isArray(s.days) && s.days.length ? s.days.map((d) => ({ date: d.date, total: Number(d.total) || 0 })) : [{ date: s.date, total: Number(s.total) }])),
    purchases: PU.map((p) => ({ date: p.date, total: Number(p.total), partner: pn.get(p.partnerId ?? '') ?? p.supplierName ?? '—' })),
    itemSales,
    ledger: LL.filter((l) => l.kind !== 'close'),
  }, from, to);
  const res = Math.round((R.sales - R.pur) * 100) / 100;
  const wd = Array<number>(7).fill(0);
  for (const [d, v] of Object.entries(R.days)) wd[(new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7]! += v.inv + v.kasa;
  const wn = ['Пон', 'Вто', 'Сре', 'Чет', 'Пет', 'Саб', 'Нед'];
  const wmx = Math.max(1, ...wd);
  const B = kdBuckets(R, from, to);
  const W = Math.max(900, B.length * (B[0]?.byMonth ? 70 : 22)), H = 230, pad = 40;
  const mx = Math.max(1, ...B.map((b) => Math.max(b.i, b.o)));
  const bw = (W - pad - 10) / Math.max(1, B.length);
  const y = (v: number) => H - 24 - (v / mx) * (H - 44);
  const MM = kdMonths(R);
  const tot = MM.reduce((a, [, o]) => ({ s: a.s + o.s, p: a.p + o.p, e: a.e + o.e }), { s: 0, p: 0, e: 0 });

  return (
    <>
      <Hd t="Анализа на работењето" sub={`${firm.name} · ${pl}: ${dmy(from)} – ${dmy(to)}`} />
      <div className="card"><form className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {KD_PER.map(([k, n]) => <Link key={k} className={`btn sm ${P === k ? 'pri' : ''}`} href={`/klDash?p=${k}`}>{n}</Link>)}
        {P === 'c' && <><input type="hidden" name="p" value="c" /><input name="f" type="date" defaultValue={from} style={{ width: 'auto' }} /><input name="t" type="date" defaultValue={to} style={{ width: 'auto' }} /><button className="btn sm">Прикажи</button></>}
      </form></div>
      <div className="kd-kpi">
        <div className="tile"><span>Вкупен промет</span><b>{fi(R.sales)}</b><i>фактури {fi(R.inv)} · каса {fi(R.kasa)}</i></div>
        <div className="tile"><span>Набавки</span><b>{fi(R.pur)}</b><i>{R.nPur} влезни фактури</i></div>
        <div className="tile"><span>Промет − набавки</span><b style={{ color: res >= 0 ? 'var(--good)' : 'var(--bad)' }}>{fi(res)}</b><i>грубо, без залиха и плати</i></div>
        <div className="tile"><span>Трошоци (класа 4)</span><b>{fi(R.expT)}</b><i>материјали, услуги, плати…</i></div>
        <div className="tile"><span>Пари (банка + каса)</span><b>{fi(R.cash)}</b><i>на {dmy(to)}</i></div>
        <div className="tile"><span>Побарувања / обврски</span><b>{fi(R.rec)}</b><i>обврски кон добавувачи {fi(R.pay)}</i></div>
      </div>
      <div className="card"><div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Приходи и набавки</h2></div>
        <div className="tw" style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: Math.min(W, B.length * 14 + 60), maxHeight: 300 }} preserveAspectRatio="none" role="img" aria-label="Приходи и набавки">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => { const v = mx * t; return <g key={t}><line x1={pad} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" /><text x={pad - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : Math.round(v)}</text></g>; })}
          {B.map((b, i) => { const x = pad + i * bw; const w = Math.max(2, bw / 2 - 2); return (
            <g key={b.k}><title>{`${b.byMonth ? b.k : dmy(b.k)} · Приходи ${fi(b.i)} · Набавки ${fi(b.o)}`}</title>
              <rect x={x + 1} y={y(b.i)} width={w} height={Math.max(0, H - 24 - y(b.i))} rx="3" fill="var(--t1,#1a7f64)" />
              <rect x={x + w + 2} y={y(b.o)} width={w} height={Math.max(0, H - 24 - y(b.o))} rx="3" fill="var(--t2,#c46a2a)" />
              {(b.byMonth || B.length <= 31 || i % 2 === 0) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{b.byMonth ? MK_MON[+b.k.slice(5, 7) - 1]!.slice(0, 3) : b.k.slice(8, 10)}</text>}</g>); })}
        </svg></div>
        <div className="row" style={{ gap: 14, marginTop: 4 }}>
          <span className="mini"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--t1,#1a7f64)' }} /> Приходи (фактури + каса)</span>
          <span className="mini"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--t2,#c46a2a)' }} /> Набавки (влезни фактури)</span>
        </div>
      </div>
      {MM.length >= 2 && (
        <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Преглед по месеци</h2>
          <table className="dense"><thead><tr><th>Месец</th><th className="n">Приходи</th><th className="n">Набавки</th><th className="n">Трошоци (кл. 4)</th><th className="n">Приходи − набавки</th></tr></thead>
            <tbody>{MM.map(([k, o]) => <tr key={k}><td>{MK_MON[+k.slice(5) - 1]} {k.slice(0, 4)}</td><td className="n">{fi(o.s)}</td><td className="n">{fi(o.p)}</td><td className="n">{fi(o.e)}</td><td className="n" style={{ color: o.s - o.p >= 0 ? 'var(--good,#067647)' : 'var(--bad,#b42318)' }}>{fi(o.s - o.p)}</td></tr>)}</tbody>
            <tfoot><tr><th>Вкупно</th><th className="n">{fi(tot.s)}</th><th className="n">{fi(tot.p)}</th><th className="n">{fi(tot.e)}</th><th className="n">{fi(tot.s - tot.p)}</th></tr></tfoot></table>
        </div>
      )}
      <div className="kd-grid">
        {R.kasa > 0 && (
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Промет по ден во неделата</h2>
            {wn.map((n, i) => <div key={n} className="row" style={{ gap: 8, alignItems: 'center', margin: '3px 0' }}><span className="mini" style={{ width: 32 }}>{n}</span><div className="kd-meter" style={{ flex: 1, height: 14, margin: 0 }}><i style={{ width: `${Math.round(wd[i]! / wmx * 100)}%` }} /></div><span className="mini num" style={{ width: 110, textAlign: 'right' }}>{fi(wd[i]!)}</span></div>)}
            <p className="mini" style={{ margin: '6px 0 0' }}>Кои денови носат најмногу промет (корисно за ресторан, продавница, смени).</p></div>
        )}
        {Object.keys(R.items).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Најпродавани артикли / услуги</h2><Rank rows={kdRank(R.items)} empty="продажби" /></div>}
        {Object.keys(R.exp).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Трошоци по вид (излези)</h2><Rank rows={kdRank(Object.fromEntries(Object.entries(R.exp).map(([g, v]) => [KD_EXP[g] ?? `Конто ${g}`, v])))} empty="трошоци" /></div>}
        {Object.keys(R.cust).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Најголеми купувачи</h2><Rank rows={kdRank(R.cust)} empty="фактури" /></div>}
        {Object.keys(R.sup).length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Најголеми добавувачи</h2><Rank rows={kdRank(R.sup)} empty="набавки" /></div>}
      </div>
    </>
  );
}
