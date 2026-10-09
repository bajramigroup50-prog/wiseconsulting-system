/**
 * Legacy `VIEWS.turaIzv` 11966 — reports: result per arrangement, VAT on the margin per period (with posting of the
 * `tourVat` journal), the чл. 38 ст. 5 register, advances for un-invoiced trips, departures.
 */
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { periodsOfYear } from '@wise/core';
import { addDays, bookingPaid, bookingTotal, dayDiff } from '@wise/core/industry';
import { arrangementsWithResults, journals, travelMarginPeriod } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { postTravelVatAction } from '../tura/actions';

const TABS = [['arr', '📊 По аранжман'], ['vat', '🏛 ДДВ на маржа'], ['evid', '📒 Евиденција чл. 38'], ['adv', '💰 Аванси'], ['dep', '🛫 Поаѓања']] as const;

export default async function TuraIzv({ searchParams }: { searchParams: Promise<{ t?: string; p?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('turaIzv', 'Туристичка агенција – извештаи');
  if (g.blocked) return g.blocked;
  const { firm, year } = g;
  const T = TABS.some((x) => x[0] === sp.t) ? sp.t! : 'arr';
  const Y = String(year);
  const L = await db().transaction((tx) => arrangementsWithResults(tx, firm));
  let body: React.ReactNode;
  if (T === 'arr') {
    const R = L.filter((x) => String(x.A.from).startsWith(Y) || String(x.A.to).startsWith(Y));
    const s = (k: 'pax' | 'rev' | 'cost' | 'margin' | 'vat' | 'net') => R.reduce((a, x) => a + (x.R[k] || 0), 0);
    body = <div className="tw"><table><thead><tr><th>Аранжман</th><th>Период</th><th className="n">Патници</th><th className="n">Пополнетост</th><th className="n">Промет</th><th className="n">Трошоци</th><th className="n">Маржа</th><th className="n">ДДВ</th><th className="n">Заработка без ДДВ</th><th className="n">По патник</th></tr></thead>
      <tbody>{R.map(({ A, R: c }) => <tr key={A.id}><td><Link href={`/tura?a=${A.id}`}><b>{A.code} {A.name}</b></Link><div className="mini">{A.dest}{A.kind === 'agent' ? ' · посредување' : ''}</div></td><td>{dmy(A.from)} – {dmy(A.to)}</td><td className="n">{c.pax}</td><td className="n">{c.fill != null ? c.fill + '%' : ''}</td>
        <td className="n">{fmt(c.rev)}</td><td className="n">{fmt(c.cost)}</td><td className="n">{fmt(c.margin)}</td><td className="n">{fmt(c.vat)}</td><td className="n" style={{ color: c.net < 0 ? 'var(--bad)' : undefined }}><b>{fmt(c.net)}</b></td><td className="n">{c.pax ? fmt(c.net / c.pax) : ''}</td></tr>)}
        {R.length > 0 && <tr style={{ background: 'var(--soft)' }}><td colSpan={2}><b>Вкупно {Y}</b></td><td className="n"><b>{s('pax')}</b></td><td /><td className="n"><b>{fmt(s('rev'))}</b></td><td className="n"><b>{fmt(s('cost'))}</b></td><td className="n"><b>{fmt(s('margin'))}</b></td><td className="n"><b>{fmt(s('vat'))}</b></td><td className="n"><b>{fmt(s('net'))}</b></td><td /></tr>}
        {!R.length && <tr><td colSpan={10} className="note">Нема аранжмани во {Y}.</td></tr>}</tbody></table></div>;
  } else if (T === 'vat' || T === 'evid') {
    const P = periodsOfYear(year, firm.vatPeriod === 'month' ? 'month' : 'quarter');
    const X = await db().transaction(async (tx) => Promise.all(P.map(async (p) => [p, await travelMarginPeriod(tx, firm, p)] as const)));
    if (T === 'vat') {
      const J = await db().select().from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'travel_vat'), inArray(journals.sourceId, P)));
      body = <><div className="tw"><table><thead><tr><th>Период</th><th className="n">Фактури</th><th className="n">Плаќаат патниците</th><th className="n">Претходни услуги</th><th className="n">Сопствени услуги</th><th className="n">Разлика (маржа)</th><th className="n">Основица</th><th className="n">ДДВ 18%</th><th>Книжено</th></tr></thead>
        <tbody>{X.map(([p, x]) => { const V = Math.round((x.vat + x.ownVat) * 100) / 100; const j = J.find((y) => y.sourceId === p); return (
          <tr key={p}><td><b>{p}</b></td><td className="n">{x.L.length || ''}</td><td className="n">{fmt(x.L.reduce((s, y) => s + y.g, 0))}</td><td className="n">{fmt(x.L.reduce((s, y) => s + y.cost, 0))}</td><td className="n">{x.own ? fmt(x.own) : ''}</td>
            <td className="n" style={{ color: x.m < 0 ? 'var(--bad)' : undefined }}>{fmt(x.m)}{x.agg === 'arr' && Math.abs(x.mt - x.m) > 0.5 && <div className="mini">оданочиво {fmt(x.mt)}</div>}</td><td className="n">{fmt(x.base + x.ownBase)}</td><td className="n"><b>{fmt(V)}</b></td>
            <td>{j ? <span className="pill good">налог {j.number}</span> : V > 0 && g.write ? <RowAction className="btn sm" action={postTravelVatAction.bind(null, p)} confirm={`Налог за ДДВ на маржа ${p}: ${fmt(V)} ден.?`} label="Книжи" /> : ''}</td></tr>); })}</tbody></table></div>
        <p className="note"><b>Чл. 38 ЗДДВ.</b> Основица = разлика меѓу износот што го плаќа патникот и износот за претходните туристички услуги; ДДВ = разлика × 18/118. ДДВ од фактурите за претходните услуги не се одбива. Износите влегуваат во ДДВ-04 полиња 01/02 (Phase 5 ги пресметува од фактурите со посебна постапка и од трошоците на аранжманите). „Книжи“: Должи приход / Побарува излезен ДДВ 18%.</p></>;
    } else {
      const sel = sp.p && P.includes(sp.p) ? sp.p : (X.find(([, x]) => x.L.length)?.[0] ?? P[0]!);
      const x = X.find(([p]) => p === sel)![1];
      body = <><div className="row" style={{ gap: 6, marginBottom: 8 }}>{P.map((p) => <Link key={p} className={`btn sm ${p === sel ? 'pri' : ''}`} href={`/turaIzv?t=evid&p=${encodeURIComponent(p)}`}>{p}</Link>)}</div>
        <div className="tw"><table className="dense"><thead><tr><th>Р.бр</th><th>Датум</th><th>Фактура</th><th>Аранжман</th><th className="n">Плаќа патникот</th><th className="n">Претходни услуги</th><th className="n">Сопствени</th><th className="n">Разлика</th><th className="n">Основица</th><th className="n">ДДВ</th></tr></thead>
          <tbody>{x.L.map((y, i) => { const v = Math.round((y.mg * 18) / 118 * 100) / 100; const A = L.find((a) => a.A.id === y.arrangementId)?.A; return (
            <tr key={i}><td>{i + 1}</td><td>{dmy(y.invoice.date)}</td><td>{y.invoice.number}{y.invoice.credit && <span className="pill warn"> одобрение</span>}</td><td>{A?.code ?? '—'}</td><td className="n">{fmt(y.g)}</td><td className="n">{fmt(y.cost)}</td><td className="n">{y.own ? fmt(y.own) : ''}</td><td className="n">{fmt(y.mg)}</td><td className="n">{fmt(y.mg - v)}</td><td className="n">{fmt(v)}</td></tr>); })}
            {!x.L.length && <tr><td colSpan={10} className="note">Нема фактури по посебна постапка во периодот.</td></tr>}</tbody></table></div></>;
    }
  } else if (T === 'adv') {
    const R = L.flatMap(({ A, B }) => B.filter((b) => b.status !== 'cancel' && !b.invoiceId && bookingPaid(b) > 0).map((b) => ({ A, b, p: bookingPaid(b), t: bookingTotal(b, A) })));
    body = <div className="tw"><table><thead><tr><th>Поаѓање</th><th>Аранжман</th><th>Пријава</th><th>Носител</th><th className="n">Уплатено (аванс)</th><th className="n">Цена</th><th className="n">Остаток</th></tr></thead>
      <tbody>{R.map((x) => <tr key={x.b.id}><td>{dmy(x.A.from)}</td><td>{x.A.code} {x.A.name}</td><td>{x.b.number}</td><td>{x.b.client.name}</td><td className="n">{fmt(x.p)}</td><td className="n">{fmt(x.t)}</td><td className="n">{fmt(x.t - x.p)}</td></tr>)}
        {R.length > 0 && <tr style={{ background: 'var(--soft)' }}><td colSpan={4}><b>Вкупно аванси</b></td><td className="n"><b>{fmt(R.reduce((s, x) => s + x.p, 0))}</b></td><td colSpan={2} /></tr>}
        {!R.length && <tr><td colSpan={7} className="note">Нема примени аванси за нефактурирани патувања.</td></tr>}</tbody></table></div>;
  } else {
    const td = today(), to = addDays(td, 30);
    const R = L.filter(({ A }) => A.status !== 'cancel' && A.from && A.from >= td && A.from <= to);
    body = <>{R.map(({ A, B, R: c }) => {
      const debt = B.filter((b) => b.status !== 'cancel' && bookingTotal(b, A) - bookingPaid(b) > 0.5);
      const docs = B.flatMap((b) => b.pax).filter((p) => p.name && (!p.doc || (p.docExp && p.docExp < addDays(A.to || A.from!, 90)))).map((p) => p.name);
      return <div className="card" key={A.id}><div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>✈ {dmy(A.from)} · {A.code} {A.name} <span className="pill info">за {dayDiff(td, A.from!)} дена</span></h2><Link className="btn sm" href={`/tura?a=${A.id}`}>Отвори</Link></div>
        <div className="mini">{c.pax}{A.seats ? ' / ' + A.seats : ''} патници · уплатено {fmt(c.paid)} од {fmt(c.rev)}</div>
        {debt.length > 0 && <div className="callout warn" style={{ marginTop: 6 }}>Неплатен остаток: {debt.map((b) => `${b.client.name} ${fmt(bookingTotal(b, A) - bookingPaid(b))}${b.client.phone ? ' (' + b.client.phone + ')' : ''}`).join(' · ')}</div>}
        {docs.length > 0 && <div className="callout bad" style={{ marginTop: 6 }}>🛂 Без пасош или пасошот важи помалку од 3 месеци по враќањето: {docs.join(', ')}</div>}</div>;
    })}{!R.length && <p className="note">Нема поаѓања во наредните 30 дена.</p>}</>;
  }
  return (
    <>
      <Hd t="Туристичка агенција – извештаи" sub={Y}><Link className="btn" href="/tura">✈ Аранжмани</Link></Hd>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{TABS.map(([k, n]) => <Link key={k} className={`btn ${T === k ? 'pri' : ''}`} href={`/turaIzv?t=${k}`}>{n}</Link>)}</div>
      {body}
    </>
  );
}
