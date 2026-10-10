/**
 * Legacy `VIEWS.home` (3788 + patches 11558, 13600, 15846, 16354) — Контролна табла: hero with the result, period
 * filter, quick actions, KPI tiles with year-on-year change and sparklines, monthly revenue / expense chart, deadlines,
 * booking checks, money balance, receivables ageing, top customers / suppliers, expense structure, open items and the
 * latest documents; plus the recurring-invoices and autopilot callouts.
 * Gaps: legacy `ainb` incoming-messages chip and the law-robot banner (other areas).
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { ROLES, periodDue, periodOf } from '@wise/core';
import { AGE, DASH_PER, EXPG, MON, dashAgg, dashMonthly, dashRange, daysBetween, isDashPer, kfmt, payDeadline, pct } from '@wise/core/firms/dash';
import {
  autopilotFindings, autopilotRuns, bankLines, computeVatPeriod, employees, firms, invoices, partners, payrollRuns, purchases, recurringInvoices, salesDaily,
  users, vatDueEstimate,
} from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { acctMonths, cashKontos, stockSummary } from '@/lib/dash';
import { db } from '@/lib/db';
import { invoicesWithPayments, partnerNames, purchasesWithPayments } from '@/lib/firms-office';
import { fmt } from '@/lib/fmt';
import { allowedFirms, today } from '@/lib/office';
import { Hd, dmy } from '@/components/hd';
import { BarChart, HBars, LineChart, Spark } from '@/components/dash-charts';

const ICO: Record<string, string> = {
  inv: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5', scan: 'M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M4 12h16',
  bank: 'M3 10l9-6 9 6 M5 10v8 M10 10v8 M14 10v8 M19 10v8 M3 20h18', cash: 'M3 7h18v11H3z M12 12.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M6 10v5 M18 10v5',
  pay: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21c1-4 4-6 8-6s7 2 8 6', box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  tax: 'M5 19L19 5 M7.5 7.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16.5 16.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', bal: 'M12 4v16 M5 8h14 M5 8l-3 7h6z M19 8l-3 7h6z M8 20h8',
  up: 'M3 17l6-6 4 4 8-8 M15 7h6v6', down: 'M3 7l6 6 4-4 8 8 M15 17h6v-6', res: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 7l12-4v4 M16.5 14h.01',
  users: 'M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M2 21c.8-3.6 3.6-6 7-6s6.2 2.4 7 6 M16 3.5a4 4 0 0 1 0 7.5 M18 15c2 .8 3.4 3 4 6',
  truck: 'M2 6h12v10H2z M14 10h4l4 4v2h-8 M6.5 18.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M17.5 18.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  move: 'M3 12h14 M13 8l4 4-4 4 M21 5v14', doc: 'M6 3h9l4 4v14H6z M14 3v5h5', year: 'M4 5h16v15H4z M4 9h16 M9 3v4 M15 3v4', fisk: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6', inbox: 'M3 13l3-8h12l3 8v6H3z M3 13h5l1 2h6l1-2h5',
};
const Ico = ({ k, sz = 22 }: { k: string; sz?: number }) => (
  <svg viewBox="0 0 24 24" width={sz} height={sz} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICO[k] ?? ICO.res} /></svg>
);
const Q: [string, string, string, string, string][] = [
  ['izlez', 'inv', 'Нова фактура', 'излезна', 't1'], ['skan', 'scan', 'Скенирај влезна', 'PDF / слика', 't2'], ['banka', 'bank', 'Увези извод', 'банка', 't3'],
  ['prenosi', 'move', 'Пренос', 'во продавница', 't4'], ['kasa', 'cash', 'Каса', 'дневен промет', 't5'], ['plati', 'pay', 'Плати', 'МПИН', 't6'],
  ['ddv', 'tax', 'ДДВ-04', 'пријава', 't7'], ['bilanc', 'bal', 'Бруто биланс', 'извештај', 't8'], ['zsProc', 'year', 'Завршна сметка', 'по фази', 't8'],
  ['fiskPer', 'fisk', 'Фискални извештаи', 'рачна каса', 't5'], ['dosie', 'doc', 'Документи', 'досие на фирмата', 't3'], ['klInbox', 'inbox', 'Од клиенти', 'пристигнато', 't2'],
  ['ppNal', 'wallet', 'Платни налози', 'ПП30 · ПП50 · ПП10', 't6'],
];
const WD = ['недела', 'понеделник', 'вторник', 'среда', 'четврток', 'петок', 'сабота'];
const MN = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];

function DPill({ d, inv, py }: { d: number | null; inv?: boolean; py: number }) {
  if (d == null) return <small className="dl mut">нема податоци за {py}</small>;
  return <small className={`dl ${(inv ? -d : d) >= 0 ? 'up' : 'dn'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('mk-MK')}% <em>во однос на {py}</em></small>;
}
function Tile({ lab, val, sub, sp, col, ic, tn }: { lab: string; val: string; sub: React.ReactNode; sp?: React.ReactNode; col?: string | null; ic: string; tn: string }) {
  return (
    <div className={`tile kt ${tn}`}>
      <div className="kh"><i className={`ib sm ${tn}`}><Ico k={ic} sz={18} /></i><span>{lab}</span></div>
      <b className="num" style={col ? { color: col } : undefined}>{val}</b><i>{sub}</i>{sp}
    </div>
  );
}

async function safe<T>(p: Promise<T>, d: T): Promise<T> { try { return await p; } catch { return d; } }

export default async function Home({ searchParams }: { searchParams: Promise<{ per?: string }> }) {
  const u = await requireUser();
  if (u.role === 'klient') redirect('/klHome');
  if (u.role === 'teren') redirect('/mojzad');
  const [f, year] = await Promise.all([currentFirm(u), currentYear()]);
  const td = today();
  if (!f) {
    const [[fc], [uc]] = await Promise.all([db().select({ n: sql<number>`count(*)::int` }).from(firms), db().select({ n: sql<number>`count(*)::int` }).from(users)]);
    return (
      <>
        <Hd t="Контролна табла" sub={`нема избрана фирма · ${year}`} />
        <div className="callout">Изберете фирма со <b>⇄ Промени фирма</b> горе, или отворете <Link href="/firmi">Фирми</Link>.</div>
        <div className="tiles">
          <div className="tile"><span className="k">Фирми</span><b className="v num">{fc?.n ?? 0}</b></div>
          <div className="tile"><span className="k">Корисници</span><b className="v num">{uc?.n ?? 0}</b></div>
          <div className="tile"><span className="k">Вашата улога</span><b className="v">{ROLES[u.role].n}</b></div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Link className="btn" href="/zatvoranje">✅ Месечно затворање</Link><Link className="btn" href="/izvestuvanja">🔔 Известувања за сите фирми</Link><Link className="btn" href="/autop">🤖 Автопилот</Link></div>
      </>
    );
  }
  const sp = await searchParams;
  const P = isDashPer(sp.per) ? sp.per : 'year';
  const rg = dashRange(year, P, td);
  const per = f.vatPeriod === 'month' ? 'month' : 'quarter';
  const cur = periodOf(td, per);
  const [L, LP, ck, inv, pur, est, D] = await Promise.all([
    acctMonths(f.id, year), acctMonths(f.id, year - 1), cashKontos(f.id),
    invoicesWithPayments(f.id, { until: rg.to }), purchasesWithPayments(f.id, { until: rg.to }),
    f.vatRegistered ? safe(vatDueEstimate(db(), f.id, td), null) : Promise.resolve(null),
    f.vatRegistered ? safe(computeVatPeriod(db(), f, cur).then((c) => c.fields['31'] ?? 0), 0) : Promise.resolve(0),
  ]);
  const A = dashAgg(L, rg.m0, rg.m1), AP = dashAgg(LP, rg.m0, rg.m1);
  const M = dashMonthly(L, ck), MP = dashMonthly(LP, ck);
  const cmI = td.startsWith(String(year)) ? +td.slice(5, 7) - 1 : 11;
  const lastM = Math.min(cmI, 11);
  const cashNow = M.CB[11]!, cashLY = MP.CB[lastM]!;
  const od = (x: { due: string | null; date: string }) => daysBetween(td, x.due || x.date);
  const open = (x: { total: number; paid: number }) => (x.total - x.paid) / 100;
  const late = inv.filter((x) => od(x) < 0);
  const recv = inv.reduce((s, x) => s + open(x), 0), pay = pur.reduce((s, x) => s + open(x), 0);
  const lateSum = late.reduce((s, x) => s + open(x), 0);
  const due7 = pur.filter((x) => { const n = od(x); return n >= 0 && n <= 7; }).reduce((s, x) => s + open(x), 0);
  const payLate = pur.filter((x) => od(x) < 0).reduce((s, x) => s + open(x), 0);
  const AGEROWS = AGE.map(([n, fn, c]) => { const X = inv.filter((x) => fn(od(x))); return { n, v: X.reduce((s, x) => s + open(x), 0), x: X.length + ' фактури', c }; });

  const inRange = sql`between ${rg.from} and ${rg.to}`;
  const pm = (() => { let y = +td.slice(0, 4), m = +td.slice(5, 7) - 1; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; })();
  const lim = new Date(Date.UTC(+td.slice(0, 4), +td.slice(5, 7) - 1, +td.slice(8, 10) + 30)).toISOString().slice(0, 10);
  const [TC, TS, unb, dups, empAct, payPm, exp, recent, stockS] = await Promise.all([
    db().select({ p: invoices.partnerId, v: sql<string>`sum(case when ${invoices.kind} = 'credit' then -1 else 1 end * ${invoices.base} * ${invoices.fx})` }).from(invoices)
      .where(and(eq(invoices.firmId, f.id), inArray(invoices.kind, ['invoice', 'credit']), ne(invoices.status, 'draft'), sql`${invoices.date} ${inRange}`)).groupBy(invoices.partnerId),
    db().select({ p: purchases.partnerId, v: sql<string>`sum(${purchases.base} * ${purchases.fx})` }).from(purchases)
      .where(and(eq(purchases.firmId, f.id), ne(purchases.status, 'draft'), sql`${purchases.date} ${inRange}`)).groupBy(purchases.partnerId),
    db().select({ n: sql<number>`count(*)::int` }).from(bankLines).where(and(eq(bankLines.firmId, f.id), isNull(bankLines.refId), isNull(bankLines.refs), isNull(bankLines.konto), sql`${bankLines.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`)),
    db().select({ n: sql<number>`count(*)::int` }).from(sql`(select 1 from ${purchases} where ${purchases.firmId} = ${f.id} and ${purchases.status} <> 'draft' and ${purchases.number} <> '' group by ${purchases.partnerId}, lower(replace(${purchases.number}, ' ', '')) having count(*) > 1) d`),
    db().select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.firmId, f.id), eq(employees.active, true))),
    db().select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, f.id), eq(payrollRuns.month, pm))).limit(1),
    db().select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.firmId, f.id), eq(employees.active, true), lte(employees.end, lim))),
    Promise.all([
      db().select({ id: invoices.id, d: invoices.date, n: invoices.number, p: invoices.partnerId, v: sql<string>`${invoices.total} * ${invoices.fx}` }).from(invoices)
        .where(and(eq(invoices.firmId, f.id), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'), sql`${invoices.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`)).orderBy(desc(invoices.date)).limit(8),
      db().select({ id: purchases.id, d: purchases.date, n: purchases.number, p: purchases.partnerId, v: sql<string>`${purchases.total} * ${purchases.fx}` }).from(purchases)
        .where(and(eq(purchases.firmId, f.id), ne(purchases.status, 'draft'), sql`${purchases.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`)).orderBy(desc(purchases.date)).limit(8),
      db().select({ id: salesDaily.id, d: salesDaily.date, v: salesDaily.total }).from(salesDaily)
        .where(and(eq(salesDaily.firmId, f.id), sql`${salesDaily.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`)).orderBy(desc(salesDaily.date)).limit(8),
    ]),
    safe(stockSummary(f.id), { wh: 0, st: 0, neg: 0, low: 0 }),
  ]);
  const PN = await partnerNames(f.id, [...TC.map((x) => x.p), ...TS.map((x) => x.p), ...inv.map((x) => x.partnerId), ...pur.map((x) => x.partnerId), ...recent[0].map((x) => x.p), ...recent[1].map((x) => x.p)]);
  const pn = (id: string | null) => (id ? PN.get(id)?.name ?? '' : '');
  const top = (L2: { p: string | null; v: string }[]) => L2.map((x) => ({ n: pn(x.p) || '—', v: Math.round(Number(x.v) * 100) / 100 })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 6);
  const topC = top(TC), topS = top(TS);
  const expRows = Object.entries(A.eg).map(([k, v]) => ({ n: EXPG[k] ?? 'Група ' + k, v: Math.round(v * 100) / 100 })).filter((r) => r.v > 0.5).sort((a, b) => b.v - a.v);
  const bal = Math.round(L.reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;
  const payMiss = (empAct[0]?.n ?? 0) > 0 && !payPm.length;
  const PD = payDeadline(td);
  const dl = [
    ...(est ? [{ t: `ДДВ-04 за ${est.period}`, d: est.due, v: est.amount, s: est.amount > 0 ? 'за плаќање' : 'за поврат', go: 'ddv' }] : []),
    ...((empAct[0]?.n ?? 0) > 0 ? [{ t: `Плата и МПИН за ${PD.month.split('-').reverse().join('.')}`, d: PD.due, go: 'plati' }] : []),
    { t: `Годишна сметка и ДБ за ${year}`, d: `${year + 1}-03-15`, go: 'zsProc' },
  ].sort((a, b) => (a.d < b.d ? -1 : 1));
  const chk: [number, string, string][] = ([
    [unb[0]?.n ?? 0, 'Непрокнижени ставки од извод', 'banka'], [late.length, `Задоцнети наплати (${fmt(lateSum)})`, 'opomeni'], [dups[0]?.n ?? 0, 'Дупликати влезни фактури', 'vlez'],
    [stockS.neg, 'Артикли со негативна залиха', 'g_lager'], [stockS.low, 'Залиха под минимум', 'g_lager'], [payMiss ? 1 : 0, `Плата за ${pm.split('-').reverse().join('-')} не е прокнижена`, 'plati'],
    [exp[0]?.n ?? 0, 'Договори што истекуваат за 30 дена', 'dogovori'], [Math.abs(bal) > 0.05 ? 1 : 0, `Налозите не се во рамнотежа (разлика ${fmt(bal)})`, 'nalozi'],
  ] as [number, string, string][]).filter((x) => x[0]);
  const rec = [
    ...recent[0].map((x) => ({ d: x.d, t: 'Излезна', n: x.n, p: pn(x.p), v: Number(x.v), href: '/izlez' })),
    ...recent[1].map((x) => ({ d: x.d, t: 'Влезна', n: x.n, p: pn(x.p), v: Number(x.v), href: '/vlez' })),
    ...recent[2].map((x) => ({ d: x.d, t: 'Каса', n: '', p: 'Дневен извештај', v: Number(x.v), href: '/kasa' })),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 8);

  // Office-wide callouts (legacy 13600 recurring invoices due, 16354 autopilot tile).
  const AF = await allowedFirms(u);
  const afIds = AF.map((x) => x.id);
  const [recDue, apRun, apBad] = await Promise.all([
    afIds.length ? db().select({ f: recurringInvoices.firmId, next: sql<string>`min(${recurringInvoices.next})`, n: sql<number>`count(*)::int` }).from(recurringInvoices)
      .where(and(inArray(recurringInvoices.firmId, afIds), eq(recurringInvoices.active, true), lte(recurringInvoices.next, td))).groupBy(recurringInvoices.firmId) : [],
    db().select().from(autopilotRuns).orderBy(desc(autopilotRuns.startedAt)).limit(1),
    afIds.length ? db().select({ f: autopilotFindings.firmId, lvl: autopilotFindings.lvl }).from(autopilotFindings)
      .where(and(inArray(autopilotFindings.firmId, afIds), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt), ne(autopilotFindings.lvl, 'info'))) : [],
  ]);
  const AFn = new Map(AF.map((x) => [x.id, x.name]));
  const badF = new Set(apBad.filter((x) => x.lvl === 'bad').map((x) => x.f)).size;

  const _d = new Date(td + 'T12:00:00Z');
  const dstr = `${WD[_d.getUTCDay()]}, ${_d.getUTCDate()} ${MN[_d.getUTCMonth()]} ${_d.getUTCFullYear()}`;
  const mg = A.rev ? Math.round(A.res / A.rev * 1000) / 10 : null;
  const hl: [number, number] = [rg.m0, rg.m1];
  const Dcur = Math.round(D * 100) / 100;
  return (
    <>
      {recDue.length > 0 && (
        <div className="callout warn">🔁 <b>Месечни фактури за издавање</b> во {recDue.length} фирми: {recDue.map((r) => <span key={r.f} className="pill" style={{ marginRight: 4 }}>{AFn.get(r.f)} · {dmy(r.next)}</span>)}<br />
          <small>Изберете ја фирмата → <Link href="/periodicni">Периодични фактури</Link> – ако е вклучено „автоматски“, фактурите се издаваат и праќаат сами.</small></div>
      )}
      {apRun[0] && (
        <Link href="/autop" className="callout" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
          <b>🤖 Автопилот</b><span className="pill good">✓ {Math.max(0, AF.length - new Set(apBad.map((x) => x.f)).size)} подготвени</span>
          {badF > 0 && <span className="pill bad">⛔ {badF} со проблеми</span>}
          <span className="muted" style={{ fontSize: 12 }}>проверено {apRun[0].startedAt.toLocaleTimeString('mk-MK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Skopje' })} – отвори →</span>
        </Link>
      )}
      <section className="dash-hero">
        <div>
          <p className="eyebrow">{dstr}</p>
          <h1>{f.name}</h1>
          <p className="note"><span className="hchip">ЕДБ {f.edb || '—'}</span><span className="hchip">Деловна {year}</span><span className="hchip">{f.vatRegistered ? 'ДДВ обврзник · ' + (per === 'month' ? 'месечно' : 'тромесечно') : 'Не е ДДВ обврзник'}</span></p>
        </div>
        <div className="hero-kpi"><span>Резултат · {rg.lab}</span><b className={`num ${A.res < 0 ? 'neg' : ''}`}>{fmt(A.res)}</b><i>{mg == null ? '' : 'маржа ' + mg.toLocaleString('mk-MK') + '% · '}данок на добивка 10% ≈ {fmt(Math.max(0, A.res * 0.1))}</i></div>
      </section>
      <div className="dfilter" role="group" aria-label="Период">
        <span className="mini">Период:</span>
        {DASH_PER.map(([k, t]) => <Link key={k} className={`chip ${P === k ? 'on' : ''}`} href={k === 'year' ? '/' : `/?per=${k}`} aria-pressed={P === k}>{t}</Link>)}
        <span className="mini" style={{ marginLeft: 'auto' }}>Споредба со ист период {year - 1}</span>
      </div>
      <div className="quick q2">
        {Q.map(([v, ic, t, s, tn]) => (
          <Link key={v} href={`/${v}`}><i className={`ib ${tn}`}><Ico k={ic} sz={24} /></i><span><b>{t}</b><small>{s}</small></span></Link>
        ))}
      </div>
      <div className="tiles kpi k4">
        <Tile lab="Приходи" val={fmt(A.rev)} sub={<DPill d={pct(A.rev, AP.rev)} py={year - 1} />} sp={<Spark vals={M.R} hl={hl} col="var(--c1)" />} ic="up" tn="t1" />
        <Tile lab="Расходи" val={fmt(A.exp)} sub={<DPill d={pct(A.exp, AP.exp)} inv py={year - 1} />} sp={<Spark vals={M.E} hl={hl} col="var(--c2)" />} ic="down" tn="t2" />
        <Tile lab="Резултат" val={fmt(A.res)} sub={<DPill d={pct(A.res, AP.res)} py={year - 1} />} sp={<Spark vals={M.R.map((v, i) => v - M.E[i]!)} hl={hl} col="var(--accent)" />} col={A.res >= 0 ? 'var(--good)' : 'var(--bad)'} ic="res" tn="t8" />
        <Tile lab="Пари (банки + благајна)" val={fmt(cashNow)} sub={<DPill d={pct(cashNow, cashLY)} py={year - 1} />} sp={<Spark vals={M.CB.slice(0, lastM + 1).concat(Array(11 - lastM).fill(0))} col="var(--c1)" />} ic="wallet" tn="t3" />
        <Tile lab="Побарувања од купувачи" val={fmt(recv)} sub={<>{inv.length} отворени{late.length ? <> · <strong style={{ color: 'var(--bad)' }}>{late.length} задоцнети ({kfmt(lateSum)})</strong></> : ' · сите во рок'}</>} ic="users" tn="t6" />
        <Tile lab="Обврски кон добавувачи" val={fmt(pay)} sub={<>{pur.length} отворени · за 7 дена: <strong>{kfmt(due7)}</strong>{payLate ? <> · <strong style={{ color: 'var(--bad)' }}>задоцнети {kfmt(payLate)}</strong></> : null}</>} ic="truck" tn="t5" />
        {f.vatRegistered && <Tile lab={'ДДВ ' + cur} val={fmt(Dcur)} sub={(Dcur > 0 ? 'за плаќање' : 'за поврат') + ' · тековен период'} col={Dcur > 0 ? 'var(--bad)' : 'var(--good)'} ic="tax" tn="t7" />}
        <Tile lab="Залиха (набавна вредност)" val={fmt(stockS.wh + stockS.st)} sub={`магацин ${kfmt(stockS.wh)} · продавници ${kfmt(stockS.st)}`} ic="box" tn="t4" />
      </div>
      <div className="dash-grid">
        <div className="card dash-chart">
          <div className="hd"><h2>Приходи и расходи по месеци · {year}</h2>
            <div className="legend"><span><i style={{ background: 'var(--c1)' }} />Приходи <b className="num">{fmt(M.R.reduce((a, b) => a + b, 0))}</b></span><span><i style={{ background: 'var(--c2)' }} />Расходи <b className="num">{fmt(M.E.reduce((a, b) => a + b, 0))}</b></span><span><i style={{ background: 'var(--accent-soft)' }} />избран период</span></div>
          </div>
          <BarChart R={M.R} E={M.E} m0={rg.m0} m1={rg.m1} year={year} />
          <details className="note"><summary>Табела</summary><div className="tw"><table>
            <thead><tr><th>Месец</th><th className="n">Приходи</th><th className="n">Расходи</th><th className="n">Резултат</th><th className="n">Пари крај на месец</th></tr></thead>
            <tbody>{MON.map((mn, i) => <tr key={i}><td>{mn}</td><td className="n">{fmt(M.R[i])}</td><td className="n">{fmt(M.E[i])}</td><td className="n">{fmt(M.R[i]! - M.E[i]!)}</td><td className="n">{i <= lastM ? fmt(M.CB[i]) : ''}</td></tr>)}</tbody>
          </table></div></details>
        </div>
        <div className="card">
          <div className="hd"><h2>Рокови</h2></div>
          <ul className="todo">{dl.map((x) => {
            const n = daysBetween(td, x.d), cls = n < 0 ? 'bad' : n <= 7 ? 'warn' : '';
            return <li key={x.t}><Link className="lnk" href={`/${x.go}`}><span><b>{x.t}</b>{'v' in x && x.v != null ? <em className="num">{fmt(x.v)} · {x.s}</em> : <em>рок {dmy(x.d)}</em>}</span><span className={`pill ${cls}`}>{n < 0 ? 'истечен' : n === 0 ? 'денес' : 'за ' + n + ' ден.'}</span></Link></li>;
          })}</ul>
          <div className="hd" style={{ marginTop: 14 }}><h2>Контрола на книжењето</h2><span className={`pill ${chk.length ? 'warn' : 'good'}`}>{chk.length ? chk.length + ' за проверка' : '✓ во ред'}</span></div>
          <ul className="todo">{chk.length ? chk.map(([n, t, go]) => <li key={t}><Link className="lnk" href={`/${go}`}><span><b>{t}</b></span><span className="pill warn">{n}</span></Link></li>)
            : <li className="ok">✓ Изводите се средени, нема задоцнети наплати, дупликати или негативна залиха; налозите се во рамнотежа.</li>}</ul>
        </div>
      </div>
      <div className="dash-grid g2">
        <div className="card dash-chart"><div className="hd"><h2>Пари на сметка и благајна · крај на месец</h2><span className="note">банки + благајна</span></div>
          {M.CB.some((v) => Math.abs(v) > 0.5) ? <LineChart V={M.CB} lastM={lastM} year={year} /> : <div className="empty">Нема прокнижени изводи и благајна за {year}. Увезете извод во Финанс. → Изводи.</div>}</div>
        <div className="card"><div className="hd"><h2>Старосна структура на побарувањата</h2><span className="num">{fmt(recv)}</span></div>
          {recv ? <HBars rows={AGEROWS} unit="Неплатено" /> : <div className="empty">Нема отворени побарувања.</div>}
          <p className="note" style={{ margin: '8px 0 0' }}>Според рокот на плаќање (или датумот на фактурата ако нема рок).</p></div>
      </div>
      <div className="cols3">
        <div className="card"><div className="hd"><h2>Најголеми купувачи</h2><span className="note">{rg.lab}</span></div><HBars rows={topC} col="var(--c1)" unit="Промет без ДДВ" /></div>
        <div className="card"><div className="hd"><h2>Најголеми добавувачи</h2><span className="note">{rg.lab}</span></div><HBars rows={topS} col="var(--c2)" unit="Набавки без ДДВ" /></div>
        <div className="card"><div className="hd"><h2>Структура на расходите</h2><span className="note">{rg.lab}</span></div><HBars rows={expRows} col="var(--c2)" unit="Расход" /></div>
      </div>
      <div className="cols">
        <div className="card"><div className="hd"><h2>Отворени побарувања</h2><Link className="btn sm" href="/opomeni">Опомени →</Link></div>
          {inv.length ? <div className="tw"><table><thead><tr><th>Фактура</th><th>Купувач</th><th>Рок</th><th className="n">Неплатено</th></tr></thead><tbody>
            {[...inv].sort((a, b) => od(a) - od(b)).slice(0, 6).map((x) => <tr key={x.id}><td>{x.number}</td><td>{pn(x.partnerId)}</td><td>{dmy(x.due || x.date)}{od(x) < 0 && <> <span className="pill bad">{-od(x)} ден.</span></>}</td><td className="n">{fmt(open(x))}</td></tr>)}
          </tbody></table></div> : <div className="empty">Сите фактури се наплатени.</div>}</div>
        <div className="card"><div className="hd"><h2>Обврски кон добавувачи</h2><Link className="btn sm" href="/ppNal">Платни налози →</Link></div>
          {pur.length ? <div className="tw"><table><thead><tr><th>Фактура</th><th>Добавувач</th><th>Рок</th><th className="n">Неплатено</th></tr></thead><tbody>
            {[...pur].sort((a, b) => od(a) - od(b)).slice(0, 6).map((x) => <tr key={x.id}><td>{x.number}</td><td>{pn(x.partnerId)}</td><td>{dmy(x.due || x.date)}{od(x) < 0 && <> <span className="pill bad">{-od(x)} ден.</span></>}</td><td className="n">{fmt(open(x))}</td></tr>)}
          </tbody></table></div> : <div className="empty">Нема отворени обврски.</div>}</div>
      </div>
      <div className="card"><div className="hd"><h2>Последни документи</h2></div>
        {rec.length ? <div className="tw"><table><thead><tr><th>Датум</th><th>Вид</th><th>Број</th><th>Партнер</th><th className="n">Износ</th><th></th></tr></thead><tbody>
          {rec.map((x, i) => <tr key={i}><td>{dmy(x.d)}</td><td><span className="pill">{x.t}</span></td><td>{x.n}</td><td>{x.p}</td><td className="n">{fmt(x.v)}</td><td><Link className="btn sm" href={x.href}>Отвори</Link></td></tr>)}
        </tbody></table></div> : <div className="empty">Сè уште нема документи.</div>}
      </div>
      {/* `periodDue` kept for the VAT deadline when no estimate is available */}
      {!est && f.vatRegistered && <p className="note">ДДВ-04 за {cur}: рок {dmy(periodDue(cur))}.</p>}
    </>
  );
}
