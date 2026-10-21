/**
 * Client portal home – the office's dashboard pieces a client may see, each an option the office switches on per firm
 * (🔑 Профили на клиенти → sections `kpi`, `top`, `otv`): revenue / expenses / profit / VAT / profit-tax estimate /
 * money; the largest customers, suppliers and the expense structure; the open invoices and obligations.
 * The same numbers as the office dashboard (`app/(app)/page.tsx`), for the working year.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { EXPG, dashAgg, dashMonthly, daysBetween } from '@wise/core/firms/dash';
import { invoices, purchases, type Firm } from '@wise/db';
import { HBars } from '@/components/dash-charts';
import { dmy } from '@/components/hd';
import { acctMonths, cashKontos } from '@/lib/dash';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { invoicesWithPayments, partnerNames, purchasesWithPayments } from '@/lib/firms-office';

export async function KlDashCards({ firm, year, td, vat, show }: {
  firm: Firm; year: number; td: string; vat: number | null; show: { kpi: boolean; top: boolean; otv: boolean };
}) {
  if (!show.kpi && !show.top && !show.otv) return null;
  const yr = sql`between ${`${year}-01-01`} and ${`${year}-12-31`}`;
  const [L, ck, inv, pur, TC, TSu] = await Promise.all([
    show.kpi || show.top ? acctMonths(firm.id, year) : Promise.resolve([]),
    show.kpi ? cashKontos(firm.id) : Promise.resolve(new Set<string>()),
    show.otv ? invoicesWithPayments(firm.id, { until: `${year}-12-31` }) : Promise.resolve([]),
    show.otv ? purchasesWithPayments(firm.id, { until: `${year}-12-31` }) : Promise.resolve([]),
    show.top ? db().select({ p: invoices.partnerId, v: sql<string>`sum(case when ${invoices.kind} = 'credit' then -1 else 1 end * ${invoices.base} * ${invoices.fx})` }).from(invoices)
      .where(and(eq(invoices.firmId, firm.id), sql`${invoices.kind} in ('invoice','credit')`, ne(invoices.status, 'draft'), sql`${invoices.date} ${yr}`)).groupBy(invoices.partnerId) : Promise.resolve([]),
    show.top ? db().select({ p: purchases.partnerId, v: sql<string>`sum(${purchases.base} * ${purchases.fx})` }).from(purchases)
      .where(and(eq(purchases.firmId, firm.id), ne(purchases.status, 'draft'), sql`${purchases.date} ${yr}`)).groupBy(purchases.partnerId) : Promise.resolve([]),
  ]);
  const PN = await partnerNames(firm.id, [...TC.map((x) => x.p), ...TSu.map((x) => x.p), ...inv.map((x) => x.partnerId), ...pur.map((x) => x.partnerId)]);
  const pn = (id: string | null) => (id ? PN.get(id)?.name ?? '' : '');
  const A = dashAgg(L, 0, 11);
  const cash = show.kpi ? dashMonthly(L, ck).CB[11]! : 0;
  const top = (R: { p: string | null; v: string }[]) => R.map((x) => ({ n: pn(x.p) || '—', v: Math.round(Number(x.v) * 100) / 100 })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 6);
  const expRows = Object.entries(A.eg).map(([k, v]) => ({ n: EXPG[k] ?? 'Група ' + k, v: Math.round(v * 100) / 100 })).filter((r) => r.v > 0.5).sort((a, b) => b.v - a.v);
  const od = (x: { due: string | null; date: string }) => daysBetween(td, x.due || x.date);
  const open = (x: { total: number; paid: number }) => (x.total - x.paid) / 100;
  const tile = (lab: string, v: string, sub?: string, c?: string) => <div className="tile" key={lab}><span>{lab}</span><b style={c ? { color: c } : undefined}>{v}</b>{sub && <i>{sub}</i>}</div>;
  const docs = (R: typeof inv, who: string, none: string) => (R.length ? <div className="tw"><table><thead><tr><th>Фактура</th><th>{who}</th><th>Рок</th><th className="n">Неплатено</th></tr></thead><tbody>
    {[...R].sort((a, b) => od(a) - od(b)).slice(0, 8).map((x) => <tr key={x.id}><td>{x.number}</td><td>{pn(x.partnerId)}</td><td>{dmy(x.due || x.date)}{od(x) < 0 && <> <span className="pill bad">{-od(x)} ден.</span></>}</td><td className="n">{fmt(open(x))}</td></tr>)}
  </tbody></table></div> : <div className="empty">{none}</div>);
  return (
    <>
      {show.kpi && (
        <div className="card"><div className="hd"><b>📊 Работењето во {year}</b><span className="note">според книгите до {dmy(td)}</span></div>
          <div className="tiles">
            {tile('Приходи', fmt(A.rev))}
            {tile('Расходи', fmt(A.exp))}
            {tile('Добивка', fmt(A.res), A.rev ? `маржа ${Math.round((A.res / A.rev) * 1000) / 10}%` : undefined, A.res < 0 ? 'var(--bad)' : undefined)}
            {vat != null ? tile('ДДВ за тековниот период', fmt(vat), vat > 0 ? 'за плаќање' : vat < 0 ? 'за поврат' : 'нема обврска') : null}
            {tile('Данок на добивка 10% ≈', fmt(Math.max(0, Math.round(A.res * 10) / 100)), `проценка · ДБ до 15.03.${year + 1}`)}
            {tile('Пари – банки + благајна', fmt(cash))}
          </div>
        </div>
      )}
      {show.top && (
        <div className="cols">
          <div className="card"><div className="hd"><b>Најголеми купувачи</b><span className="note">{year}</span></div><HBars rows={top(TC)} col="var(--c1)" unit="Промет без ДДВ" /></div>
          <div className="card"><div className="hd"><b>Најголеми добавувачи</b><span className="note">{year}</span></div><HBars rows={top(TSu)} col="var(--c2)" unit="Набавки без ДДВ" /></div>
          <div className="card"><div className="hd"><b>Структура на расходите</b><span className="note">{year}</span></div><HBars rows={expRows} col="var(--c2)" unit="Расход" /></div>
        </div>
      )}
      {show.otv && (
        <div className="cols">
          <div className="card"><div className="hd"><b>Отворени побарувања (купувачите ви должат)</b></div>{docs(inv, 'Купувач', 'Сите фактури се наплатени.')}</div>
          <div className="card"><div className="hd"><b>Обврски кон добавувачи (вие должите)</b></div>{docs(pur, 'Добавувач', 'Нема отворени обврски.')}</div>
        </div>
      )}
    </>
  );
}
