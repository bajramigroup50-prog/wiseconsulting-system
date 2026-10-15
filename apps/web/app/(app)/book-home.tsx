/**
 * 🔒 The dashboard of a book-only colleague („Колегите гледаат само сметководство“): the firm, the bookkeeping
 * shortcuts, the booking checks and the latest documents — only links the route guard lets them open. No firm KPIs,
 * analyses, charts, deadlines, client messages, autopilot, the robot or other users' tasks.
 */
import Link from 'next/link';
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
  ['kasa', '🛒 Каса', 'дневен промет'], ['ppNal', '💳 Платни налози', 'ПП30 · ПП50 · ПП10'],
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
      <section className="dash-hero">
        <div>
          <h1>{f.name}</h1>
          <p className="note"><span className="hchip">ЕДБ {f.edb || '—'}</span><span className="hchip">Деловна {year}</span><span className="hchip">{f.vatRegistered ? 'ДДВ обврзник' : 'Не е ДДВ обврзник'}</span></p>
        </div>
      </section>
      <div className="quick q2">
        {QV.map(([v, t, s]) => (
          <Link key={v} href={v === 'izlez' ? '/izlez?nov' : `/${v}`}><span><b>{t}</b><small>{s}</small></span></Link>
        ))}
      </div>
      <div className="cols">
        <div className="card">
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
    </div>
  );
}
