/**
 * 🔒 The dashboard of a book-only colleague („Колегите гледаат само сметководство“): the firm, the bookkeeping
 * shortcuts, the booking checks and the latest documents — only links the route guard lets them open. No firm KPIs,
 * analyses, charts, deadlines, client messages, the chat robot or other users' tasks; the autopilot's „what is missing“
 * list of the firm is shown (read-only).
 */
import Link from 'next/link';
import { VnesAutopBox } from './vnes/autop-box';
import { and, desc, eq, isNull, lte, ne, sql, inArray } from 'drizzle-orm';
import { bankLines, employees, invoices, journals, payrollRuns, purchases, salesDaily, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { acctMonths, stockSummary } from '@/lib/dash';
import { partnerNames } from '@/lib/firms-office';
import { fmt } from '@/lib/fmt';
import { navFlat, navFor } from '@/lib/nav';
import { filterNavByModules } from '@/lib/nav-industry';
import { today } from '@/lib/office';
import { dmy } from '@/components/hd';
import type { Role } from '@wise/core';

/** Bookkeeping shortcuts (the ones the user may open are shown). */
export const BOOK_QUICK: readonly (readonly [string, string, string])[] = [
  ['izlez', '🧾 Нова фактура', 'излезна'], ['vlez', '📥 Влезна фактура', 'набавка'], ['skan', '📷 Скенирај влезна', 'PDF / слика'],
  ['banka', '🏦 Изводи', 'банка'], ['blagajna', '💵 Благајна', '1020'], ['nalozi', '📒 Налози', 'за книжење'], ['kartici', '📇 Картици', 'по комитент'],
  ['bilanc', '⚖ Бруто биланс', 'извештај'], ['plati', '👥 Плати', 'МПИН'], ['ddv', '🧮 ДДВ-04', 'пријава'], ['ddvKnigi', '📚 Книги за ДДВ', 'влезни / излезни'],
  ['kasa', '🛒 Каса', 'дневен промет'], ['ppNal', '💳 Платни налози', 'КТД · КТБ · ВГ (ПП30 · ПП50 · ПП10)'],
];

async function safe<T>(p: Promise<T>, d: T): Promise<T> { try { return await p; } catch { return d; } }

export async function BookHome({ role, f, year, see }: { role: Role; f: Firm; year: number; see: (view: string) => boolean }) {
  const td = today();
  const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
  const pm = (() => { let y = +td.slice(0, 4), m = +td.slice(5, 7) - 1; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; })();
  const lim = new Date(Date.UTC(+td.slice(0, 4), +td.slice(5, 7) - 1, +td.slice(8, 10) + 30)).toISOString().slice(0, 10);
  const [unb, dups, empAct, payPm, exp, bal, stockS, recent] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(bankLines).where(and(eq(bankLines.firmId, f.id), isNull(bankLines.refId), isNull(bankLines.refs), isNull(bankLines.konto), sql`${bankLines.date} between ${y0} and ${y1}`)),
    db().select({ n: sql<number>`count(*)::int` }).from(sql`(select 1 from ${purchases} where ${purchases.firmId} = ${f.id} and ${purchases.status} <> 'draft' and ${purchases.number} <> '' group by ${purchases.partnerId}, lower(replace(${purchases.number}, ' ', '')) having count(*) > 1) d`),
    db().select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.firmId, f.id), eq(employees.active, true))),
    db().select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, f.id), eq(payrollRuns.month, pm))).limit(1),
    db().select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.firmId, f.id), eq(employees.active, true), lte(employees.end, lim))),
    safe(acctMonths(f.id, year).then((L) => Math.round(L.reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100), 0),
    safe(stockSummary(f.id), { wh: 0, st: 0, neg: 0, low: 0 }),
    Promise.all([
      db().select({ id: invoices.id, d: invoices.date, n: invoices.number, p: invoices.partnerId, v: sql<string>`${invoices.total} * ${invoices.fx}` }).from(invoices)
        .where(and(eq(invoices.firmId, f.id), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'), sql`${invoices.date} between ${y0} and ${y1}`)).orderBy(desc(invoices.date)).limit(8),
      db().select({ id: purchases.id, d: purchases.date, n: purchases.number, p: purchases.partnerId, v: sql<string>`${purchases.total} * ${purchases.fx}` }).from(purchases)
        .where(and(eq(purchases.firmId, f.id), ne(purchases.status, 'draft'), sql`${purchases.date} between ${y0} and ${y1}`)).orderBy(desc(purchases.date)).limit(8),
      db().select({ id: salesDaily.id, d: salesDaily.date, v: salesDaily.total }).from(salesDaily)
        .where(and(eq(salesDaily.firmId, f.id), sql`${salesDaily.date} between ${y0} and ${y1}`)).orderBy(desc(salesDaily.date)).limit(8),
    ]),
  ]);
  // documents entered per month (workload, not finances): outgoing / incoming invoices of the year
  const mon = (t: typeof invoices.date | typeof purchases.date) => sql<string>`substring(${t}::text, 6, 2)`;
  const [mI, mP] = await Promise.all([
    safe(db().select({ m: mon(invoices.date), n: sql<number>`count(*)::int` }).from(invoices)
      .where(and(eq(invoices.firmId, f.id), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'), sql`${invoices.date} between ${y0} and ${y1}`)).groupBy(mon(invoices.date)), []),
    safe(db().select({ m: mon(purchases.date), n: sql<number>`count(*)::int` }).from(purchases)
      .where(and(eq(purchases.firmId, f.id), ne(purchases.status, 'draft'), sql`${purchases.date} between ${y0} and ${y1}`)).groupBy(mon(purchases.date)), []),
  ]);
  const byM = (R: { m: string; n: number }[]) => { const a = Array<number>(12).fill(0); for (const r of R) { const i = +r.m - 1; if (i >= 0 && i < 12) a[i] = r.n; } return a; };
  const MI = byM(mI), MP = byM(mP);
  const cm = td.startsWith(String(year)) ? +td.slice(5, 7) - 1 : 11;
  const chg = (a: number[]) => { const c = a[cm] ?? 0, pr = cm ? a[cm - 1] ?? 0 : 0; return pr ? Math.round((c - pr) / pr * 100) : null; };
  const MNS = ['Јан', 'Фев', 'Мар', 'Апр', 'Мај', 'Јун', 'Јул', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
  const mxM = Math.max(1, ...MI, ...MP);
  const PN = await partnerNames(f.id, [...recent[0].map((x) => x.p), ...recent[1].map((x) => x.p)]);
  const pn = (id: string | null) => (id ? PN.get(id)?.name ?? '' : '');
  const payMiss = (empAct[0]?.n ?? 0) > 0 && !payPm.length;
  const chk = ([
    [unb[0]?.n ?? 0, 'Непрокнижени ставки од извод', 'banka'], [dups[0]?.n ?? 0, 'Дупликати влезни фактури', 'vlez'],
    [stockS.neg, 'Артикли со негативна залиха', 'g_lager'], [stockS.low, 'Залиха под минимум', 'zaliha'],
    [payMiss ? 1 : 0, `Плата за ${pm.split('-').reverse().join('-')} не е прокнижена`, 'plati'],
    [exp[0]?.n ?? 0, 'Договори за вработување што истекуваат за 30 дена', 'dogovori'],
    [Math.abs(bal) > 0.05 ? 1 : 0, `Налозите не се во рамнотежа (разлика ${fmt(bal)})`, 'nalozi'],
  ] as [number, string, string][]).filter((x) => x[0] && see(x[2]));
  const rec = [
    ...(see('izlez') ? recent[0].map((x) => ({ d: x.d, t: 'Излезна', n: x.n, p: pn(x.p), v: Number(x.v), st: 'invoice', id: x.id, href: '/izlez' })) : []),
    ...(see('vlez') ? recent[1].map((x) => ({ d: x.d, t: 'Влезна', n: x.n, p: pn(x.p), v: Number(x.v), st: 'purchase', id: x.id, href: '/vlez' })) : []),
    ...(see('kasa') ? recent[2].map((x) => ({ d: x.d, t: 'Каса', n: '', p: 'Дневен извештај', v: Number(x.v), st: 'sales_daily', id: x.id, href: '/kasa' })) : []),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 8);
  const nal = rec.length && see('nalozi') ? await db().select({ st: journals.sourceType, id: journals.sourceId, no: journals.number }).from(journals)
    .where(and(eq(journals.firmId, f.id), inArray(journals.sourceId, rec.map((x) => x.id)))) : [];
  const nalOf = new Map(nal.map((x) => [`${x.st}|${x.id}`, x.no]));
  const vis = new Set(filterNavByModules(navFor(role), f, false).flatMap(([, it]) => navFlat(it).map(([id]) => id)));
  const QV = BOOK_QUICK.filter(([v]) => vis.has(v) && see(v));
  return (
    <div id="bookHome">
      <section className="bh-hero">
        <div className="bh-hi">{WD[new Date(td + 'T12:00:00Z').getUTCDay()]}, {dmy(td)}</div>
        <h1>{f.name}</h1>
        <p><span className="hchip">ЕДБ {f.edb || '—'}</span> <span className="hchip">Деловна {year}</span> <span className="hchip">{f.vatRegistered ? 'ДДВ обврзник' : 'Не е ДДВ обврзник'}</span></p>
      </section>
      <div className="bh-stats">
        {see('izlez') && <Stat href="/izlez" g="bh-g1" ic="🧾" t={`Излезни фактури · ${MNS[cm]}`} v={MI[cm] ?? 0} d={chg(MI)} s={`${MI.reduce((x, y) => x + y, 0)} во ${year}`} />}
        {see('vlez') && <Stat href="/vlez" g="bh-g2" ic="📥" t={`Влезни фактури · ${MNS[cm]}`} v={MP[cm] ?? 0} d={chg(MP)} s={`${MP.reduce((x, y) => x + y, 0)} во ${year}`} />}
        {see('banka') && <Stat href="/banka" g="bh-g3" ic="🏦" t="Непрокнижени ставки од извод" v={unb[0]?.n ?? 0} hot={(unb[0]?.n ?? 0) > 0} s={(unb[0]?.n ?? 0) ? 'чекаат книжење' : '✓ сите се прокнижени'} />}
        <Stat href="#bh-chk" g="bh-g4" ic="✅" t="Контрола на книжењето" v={chk.length} hot={chk.length > 0} s={chk.length ? 'за проверка' : '✓ сè е во ред'} />
      </div>
      {/* 🤖 what is missing in this firm (incoming / outgoing invoices, statements, payments without a document) */}
      <VnesAutopBox firmId={f.id} readOnly />
      <div className="quick q2">
        {QV.map(([v, t, s]) => (
          <Link key={v} href={v === 'izlez' ? '/izlez?nov' : `/${v}`}><span><b>{t}</b><small>{s}</small></span></Link>
        ))}
      </div>
      <div className="cols">
        <div className="card" id="bh-chk">
          <div className="hd"><h2>Контрола на книжењето</h2><span className={`pill ${chk.length ? 'warn' : 'good'}`}>{chk.length ? chk.length + ' за проверка' : '✓ во ред'}</span></div>
          <ul className="todo">{chk.length ? chk.map(([n, t, go]) => <li key={t}><Link className="lnk" href={`/${go}`}><span><b>{t}</b></span><span className="pill warn">{n}</span></Link></li>)
            : <li className="ok">✓ Изводите се средени, нема дупликати или негативна залиха; налозите се во рамнотежа.</li>}</ul>
        </div>
        <div className="card"><div className="hd"><h2>Последни документи</h2></div>
          {rec.length ? <div className="tw"><table><thead><tr><th>Датум</th><th>Вид</th><th>Број</th><th>Партнер</th><th className="n">Износ</th><th></th></tr></thead><tbody>
            {rec.map((x, i) => <tr key={i}><td>{dmy(x.d)}</td><td><span className="pill">{x.t}</span></td><td>{x.n}</td><td>{x.p}</td><td className="n">{fmt(x.v)}</td>
              <td>{nalOf.get(`${x.st}|${x.id}`) ? <Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(nalOf.get(`${x.st}|${x.id}`)!)}`}>Налог</Link> : <Link className="btn sm" href={x.href} title="Документот сè уште не е прокнижен">Отвори</Link>}</td></tr>)}
          </tbody></table></div> : <div className="empty">Сè уште нема документи.</div>}
        </div>
      </div>
      {(see('izlez') || see('vlez')) && (
        <div className="card"><div className="hd"><h2>Внесени документи по месеци · {year}</h2>
          <div className="legend"><span><i style={{ background: '#f28c6b' }} />излезни</span><span><i style={{ background: '#2a9577' }} />влезни</span></div></div>
          <div className="bh-bars">{MNS.map((m, i) => (
            <div key={m} className={`bh-m ${i === cm ? 'bh-cur' : ''}`} title={`${m}: излезни ${MI[i]} · влезни ${MP[i]}`}>
              <div className="bh-pair">
                {see('izlez') && <i style={{ height: `${MI[i]! / mxM * 100}%`, background: '#f28c6b' }} />}
                {see('vlez') && <i style={{ height: `${MP[i]! / mxM * 100}%`, background: '#2a9577' }} />}
              </div><small>{m}</small></div>))}
          </div>
        </div>
      )}
    </div>
  );
}

const WD = ['Недела', 'Понеделник', 'Вторник', 'Среда', 'Четврток', 'Петок', 'Сабота'];

/** A stat card in the style of modern admin dashboards: title, big number, change against last month, icon. */
function Stat({ href, g, ic, t, v, d, s, hot }: { href: string; g: string; ic: string; t: string; v: number; d?: number | null; s: string; hot?: boolean }) {
  return (
    <Link href={href} className={`bh-card ${g} ${hot ? 'bh-hot' : ''}`}>
      <span className="bh-ic" aria-hidden>{ic}</span>
      <span className="bh-t">{t}</span>
      <b className="bh-v">{v.toLocaleString('mk-MK')}</b>
      <span className="bh-s">{d != null && <span className={d >= 0 ? 'bh-up' : 'bh-dn'}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}% </span>}{d != null ? 'од минатиот месец · ' : ''}{s}</span>
    </Link>
  );
}
