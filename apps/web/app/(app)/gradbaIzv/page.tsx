/**
 * Legacy `VIEWS.gradbaIzv` 11823 — Градежништво – анализи: tabs 📍 По објект и град (contract, executed, invoiced,
 * not invoiced, collected, receivable, costs, result, margin; per city with totals), 💰 Структура на трошоци (purchase
 * invoices, cash payments, labour and machines from the diary, cost / executed, structure bar), 📅 По месец
 * (situations, executed in the month, invoiced, costs, difference); status filter (all / in progress / finished).
 */
import Link from 'next/link';
import { eq, inArray } from 'drizzle-orm';
import { boqValue, consByCity, consByMonth, consFilter, consRow, consSum, pctOf, situationCalc, sortSituations } from '@wise/core/industry';
import { constructionProjects, documentPayments, invoices, partners, projectCosts, projectSituations } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { Hd } from '@/components/hd';

const TABS = [['obj', '📍 По објект и град'], ['cost', '💰 Структура на трошоци'], ['mon', '📅 По месец']] as const;

export default async function GradbaIzv({ searchParams }: { searchParams: Promise<{ t?: string; st?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('gradbaIzv', 'Градежништво – анализи');
  if (g.blocked) return g.blocked;
  const T = TABS.some((x) => x[0] === sp.t) ? sp.t! : 'obj';
  const st = sp.st === 'open' || sp.st === 'done' ? sp.st : '';
  const all = await db().select().from(constructionProjects).where(eq(constructionProjects.firmId, g.firm.id));
  const PN = all.length ? await db().select({ id: partners.id, name: partners.name }).from(partners).where(inArray(partners.id, [...new Set(all.map((p) => p.investorId))])) : [];
  const data = await db().transaction(async (tx) => Promise.all(all.map(async (P) => {
    const S = sortSituations(await projectSituations(tx, P.id));
    const last = S[S.length - 1];
    const k = await projectCosts(tx, g.firm, P);
    const invIds = S.map((s) => s.invoiceId).filter((x): x is string => !!x);
    const I = invIds.length ? await tx.select({ id: invoices.id, base: invoices.base, total: invoices.total }).from(invoices).where(inArray(invoices.id, invIds)) : [];
    const pay = invIds.length ? await documentPayments(tx, g.firm.id, { invoiceIds: invIds }) : new Map();
    const done = last ? situationCalc(P.boq, S, last) : { cum: 0, pct: 0 };
    const row = consRow({
      id: P.id, name: P.name, city: P.city, investor: PN.find((x) => x.id === P.investorId)?.name ?? '', status: P.status,
      boq: boqValue(P.boq), exe: done.cum, pct: done.pct, rev: k.rev, gross: I.reduce((s, i) => s + Number(i.total), 0), paid: I.reduce((s, i) => s + (pay.get(i.id)?.paid ?? 0), 0),
      pur: k.pur, blg: k.blg, lab: k.lab, cost: k.tot,
    });
    const sits = S.map((s) => ({ date: s.date, cur: situationCalc(P.boq, S, s).cur, inv: Number(I.find((i) => i.id === s.invoiceId)?.base ?? 0) }));
    return { row, sits, costs: k.L };
  })));
  const R = consFilter(data.map((x) => ({ ...x.row })), st);
  const ids = new Set(R.map((r) => r.id));
  const q = (t: string, s = st) => `/gradbaIzv?t=${t}${s ? '&st=' + s : ''}`;
  const tot = (A: typeof R, t: string, key?: string) => { const S = consSum(A); return (
    <tr key={key} style={{ background: 'var(--soft)' }}><td><b>{t}</b></td><td className="n"><b>{fmt(S.boq)}</b></td><td className="n"><b>{fmt(S.exe)}</b></td><td className="n"><b>{fmt(S.rev)}</b></td><td className="n">{fmt(S.nonInv)}</td><td className="n">{fmt(S.paid)}</td><td className="n"><b>{fmt(S.open)}</b></td><td className="n"><b>{fmt(S.cost)}</b></td><td className="n"><b>{fmt(S.res)}</b></td><td className="n">{pctOf(S.res, S.rev)}</td></tr>); };
  let body: React.ReactNode;
  if (T === 'obj') {
    body = <><div className="tw"><table className="dense"><thead><tr><th style={{ minWidth: 190 }}>Објект</th><th className="n">Договорено</th><th className="n">Изведено</th><th className="n">Фактурирано</th><th className="n">Нефактурирано</th><th className="n">Наплатено</th><th className="n">Побарување</th><th className="n">Трошоци</th><th className="n">Резултат</th><th className="n">Маржа</th></tr></thead>
      <tbody>{consByCity(R).map((c) => [
        <tr key={'c' + c.city}><td colSpan={10} style={{ background: '#eef3f1' }}><b>📍 {c.city}</b> <span className="mini">{c.rows.length} објекти</span></td></tr>,
        ...c.rows.map((x) => <tr key={x.id}><td><Link href={`/gradba?p=${x.id}`}><b>{x.name}</b></Link><div className="mini">{x.investor}</div></td><td className="n">{fmt(x.boq)}</td><td className="n">{fmt(x.exe)} <span className="mini">{x.pct}%</span></td><td className="n">{fmt(x.rev)}</td>
          <td className="n" style={x.nonInv > 0 ? { color: 'var(--warn)' } : undefined}>{x.nonInv ? fmt(x.nonInv) : ''}</td><td className="n">{fmt(x.paid)}</td><td className="n" style={x.open > 0 ? { color: 'var(--bad)' } : undefined}>{x.open ? fmt(x.open) : ''}</td><td className="n">{fmt(x.cost)}</td>
          <td className="n" style={x.res < 0 ? { color: 'var(--bad)' } : undefined}><b>{fmt(x.res)}</b></td><td className="n">{pctOf(x.res, x.rev)}</td></tr>),
        c.rows.length > 1 ? tot(c.rows, 'Вкупно ' + c.city, 't' + c.city) : null,
      ])}
        {!R.length && <tr><td colSpan={10} className="note">Нема објекти.</td></tr>}
        {R.length > 0 && tot(R, 'ВКУПНО СИТЕ ОБЈЕКТИ')}</tbody></table></div>
      <p className="note">Изведено = кумулатив од последната ситуација. Фактурирано е без ДДВ. „Нефактурирано“ = изведено по ситуации без издадена фактура. Наплатено и побарување (од инвеститорот) се со ДДВ (од изводи, благајна и компензации). Трошоците се влезни фактури, исплатници и работници/машини од градежниот дневник.</p></>;
  } else if (T === 'cost') {
    const S = consSum(R);
    body = <div className="tw"><table className="dense"><thead><tr><th>Објект</th><th className="n">Материјали и услуги (влезни фактури)</th><th className="n">Готовински исплати</th><th className="n">Работна сила и машини (дневник)</th><th className="n">Вкупно трошоци</th><th className="n">Трошок / изведено</th><th style={{ width: '24%' }}>Структура</th></tr></thead>
      <tbody>{R.map((x) => { const t = x.cost || 1; return (
        <tr key={x.id}><td><b>{x.name}</b><div className="mini">{x.city}</div></td><td className="n">{fmt(x.pur)}</td><td className="n">{fmt(x.blg)}</td><td className="n">{fmt(x.lab)}</td><td className="n"><b>{fmt(x.cost)}</b></td><td className="n">{pctOf(x.cost, x.exe)}</td>
          <td><div style={{ display: 'flex', height: 12, gap: 2 }}>{([[x.pur, 'var(--t3)'], [x.blg, 'var(--t2)'], [x.lab, 'var(--t1)']] as const).filter(([v]) => v > 0).map(([v, c], i) => <span key={i} title={fmt(v)} style={{ flex: v / t, background: c, borderRadius: 2 }} />)}</div></td></tr>); })}
        <tr style={{ background: 'var(--soft)' }}><td><b>Вкупно</b></td><td className="n"><b>{fmt(S.pur)}</b></td><td className="n"><b>{fmt(S.blg)}</b></td><td className="n"><b>{fmt(S.lab)}</b></td><td className="n"><b>{fmt(S.cost)}</b></td><td className="n">{pctOf(S.cost, S.exe)}</td>
          <td className="mini"><span style={{ color: 'var(--t3)' }}>■</span> фактури <span style={{ color: 'var(--t2)' }}>■</span> готовина <span style={{ color: 'var(--t1)' }}>■</span> дневник</td></tr></tbody></table></div>;
  } else {
    const D = data.filter((x) => ids.has(x.row.id));
    const M = consByMonth(D.flatMap((x) => x.sits), D.flatMap((x) => x.costs), g.year);
    const mx = Math.max(1, ...M.map((o) => Math.max(o.exe, o.cost)));
    body = <div className="tw"><table className="dense"><thead><tr><th>Месец</th><th className="n">Ситуации</th><th className="n">Изведено во месецот</th><th className="n">Фактурирано</th><th className="n">Трошоци</th><th className="n">Разлика</th><th style={{ width: '26%' }}>Изведено / трошоци</th></tr></thead>
      <tbody>{M.map((o) => <tr key={o.mo}><td><b>{o.mo.slice(5)}/{o.mo.slice(0, 4)}</b></td><td className="n">{o.n || ''}</td><td className="n">{fmt(o.exe)}</td><td className="n">{fmt(o.inv)}</td><td className="n">{fmt(o.cost)}</td><td className="n" style={o.diff < 0 ? { color: 'var(--bad)' } : undefined}>{fmt(o.diff)}</td>
        <td><div style={{ height: 7, background: 'var(--accent)', width: `${Math.round((o.exe / mx) * 100)}%`, borderRadius: '0 3px 3px 0', marginBottom: 2 }} /><div style={{ height: 7, background: 'var(--t2)', width: `${Math.round((o.cost / mx) * 100)}%`, borderRadius: '0 3px 3px 0' }} /></td></tr>)}
        {!M.length && <tr><td colSpan={7} className="note">Нема ситуации и трошоци во {g.year}.</td></tr>}
        {M.length > 0 && <tr style={{ background: 'var(--soft)' }}><td><b>{g.year}</b></td><td className="n">{M.reduce((s, o) => s + o.n, 0)}</td><td className="n"><b>{fmt(M.reduce((s, o) => s + o.exe, 0))}</b></td><td className="n"><b>{fmt(M.reduce((s, o) => s + o.inv, 0))}</b></td><td className="n"><b>{fmt(M.reduce((s, o) => s + o.cost, 0))}</b></td><td className="n"><b>{fmt(M.reduce((s, o) => s + o.diff, 0))}</b></td>
          <td className="mini"><span style={{ color: 'var(--accent)' }}>■</span> изведено <span style={{ color: 'var(--t2)' }}>■</span> трошоци</td></tr>}</tbody></table></div>;
  }
  return (
    <>
      <Hd t="Градежништво – анализи" sub={`${R.length} објекти · состојба ${dmy(today())}`}><Link className="btn" href="/gradba">🏗 Објекти</Link></Hd>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {TABS.map(([k, n]) => <Link key={k} className={`btn ${T === k ? 'pri' : ''}`} href={q(k)}>{n}</Link>)}<span style={{ flex: 1 }} />
        <span className="mini">Статус</span>{([['', 'сите'], ['open', 'во тек'], ['done', 'завршени']] as const).map(([k, n]) => <Link key={k} className={`btn sm ${st === k ? 'pri' : ''}`} href={q(T, k)}>{n}</Link>)}
      </div>
      {body}
    </>
  );
}
