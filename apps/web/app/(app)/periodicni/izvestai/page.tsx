/**
 * 📊 Извештаи за периодичните фактури: for the buyers with a recurring definition (or, with „сите“, every buyer) –
 * per month and buyer, the e-mails sent, the unpaid invoices (debt with days late) and the products sold.
 * The invoices are the ordinary issued invoices (Излезни фактури); paid / remaining from `documentPayments`.
 */
import Link from 'next/link';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { documentPayments, invoiceLines, invoices, mailLog, partners, recurringInvoices } from '@wise/db';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { fmt } from '@/lib/fmt';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { Pill } from '@/components/file-chips';
import { ExportXlsx, type Cell } from '@/components/list-tools';

const TABS = { mes: '📅 Месечно по комитент', mail: '✉ Испратени е-пошти', dolg: '⏳ Неплатени / долг', prod: '📦 По производ' } as const;
type Tab = keyof typeof TABS;
const r2 = (n: number) => Math.round(n * 100) / 100;
const MON = ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const monLbl = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const ymOk = (s: string | undefined) => (s && /^\d{4}-\d{2}$/.test(s) ? s : undefined);
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export default async function PeriodicniIzvestai({ searchParams }: { searchParams: Promise<{ t?: string; od?: string; do?: string; all?: string }> }) {
  const sp = await searchParams;
  const { firm } = await officePage('periodicni', { perm: 'office' });
  if (!firm) return <NoFirm t="📊 Извештаи – периодични фактури" />;
  const td = today();
  const tab: Tab = sp.t && sp.t in TABS ? (sp.t as Tab) : 'mes';
  const to = ymOk(sp.do) ?? td.slice(0, 7);
  const from0 = ymOk(sp.od) ?? `${td.slice(0, 4)}-01`;
  // at most 24 months on one report (the month columns)
  const minFrom = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 24, 1)).toISOString().slice(0, 7);
  const from = from0 > to ? to : from0 < minFrom ? minFrom : from0;
  const all = sp.all === '1';
  const months: string[] = [];
  for (let m = from; m <= to && months.length < 24; ) { months.push(m); const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)); m = d.toISOString().slice(0, 7); }

  const R = await db().selectDistinct({ id: recurringInvoices.partnerId }).from(recurringInvoices).where(eq(recurringInvoices.firmId, firm.id));
  const recP = R.map((x) => x.id);
  const scope = all ? undefined : recP.length ? inArray(invoices.partnerId, recP) : sql`false`;
  const cols = { id: invoices.id, number: invoices.number, date: invoices.date, due: invoices.due, status: invoices.status, total: invoices.total, base: invoices.base, vat: invoices.vat, fx: invoices.fx, currency: invoices.currency, data: invoices.data, partnerId: invoices.partnerId, partner: partners.name, email: partners.email };
  const base = (extra: ReturnType<typeof and>) => db().select(cols).from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId))
    .where(and(eq(invoices.firmId, firm.id), eq(invoices.kind, 'invoice'), scope, extra)).orderBy(asc(invoices.date), asc(invoices.number));
  const live = <T extends { data: unknown }>(L: T[]) => L.filter((i) => !(i.data as { cancelled?: unknown } | null)?.cancelled);
  const fxOf = (i: { currency: string; fx: string }) => (i.currency !== 'MKD' ? Number(i.fx) || 1 : 1);

  // the invoices of the period (tabs mes / mail / prod) and, for the debt, every issued invoice up to today
  const I = live(await base(and(sql`${invoices.date} between ${from + '-01'} and ${lastDay(to)}`)));
  const ids = I.map((i) => i.id);
  const D = tab === 'dolg' ? live(await base(and(lte(invoices.date, td), sql`${invoices.status} = 'posted'`))) : [];
  const [pay, lines, mails] = await Promise.all([
    documentPayments(db(), firm.id, { invoiceIds: tab === 'dolg' ? D.map((i) => i.id) : ids }),
    tab === 'prod' && ids.length ? db().select({ inv: invoiceLines.invoiceId, name: invoiceLines.name, unit: invoiceLines.unit, qty: invoiceLines.qty, price: invoiceLines.price, disc: invoiceLines.disc, rate: invoiceLines.rate }).from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)) : Promise.resolve([]),
    tab === 'mail' && ids.length ? db().select({ id: mailLog.id, inv: mailLog.entityId, to: mailLog.to, subject: mailLog.subject, status: mailLog.status, error: mailLog.error, at: mailLog.createdAt, sentAt: mailLog.sentAt }).from(mailLog).where(and(eq(mailLog.entityType, 'invoice'), inArray(mailLog.entityId, ids))).orderBy(asc(mailLog.createdAt)) : Promise.resolve([]),
  ]);

  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const v = { t: tab, od: from, do: to, all: all ? '1' : undefined, ...o };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return `/periodicni/izvestai?${p}`;
  };
  const title = `${TABS[tab]} · ${firm.name} · ${monLbl(from)} – ${monLbl(to)}`;
  let body: React.ReactNode = null;
  let xl: Cell[][] = [];

  if (tab === 'mes') {
    const P = new Map<string, { name: string; m: Record<string, number>; n: number; tot: number; paid: number }>();
    for (const i of I) {
      const k = i.partnerId ?? '-';
      const p = P.get(k) ?? { name: i.partner ?? '—', m: {}, n: 0, tot: 0, paid: 0 };
      const pm = pay.get(i.id);
      const t = pm?.total ?? Number(i.total) * fxOf(i);
      p.m[i.date.slice(0, 7)] = r2((p.m[i.date.slice(0, 7)] ?? 0) + t);
      p.n++; p.tot = r2(p.tot + t); p.paid = r2(p.paid + (pm?.paid ?? 0));
      P.set(k, p);
    }
    const rows = [...P.values()].sort((a, b) => a.name.localeCompare(b.name, 'mk'));
    const colSum = (m: string) => r2(rows.reduce((a, r) => a + (r.m[m] ?? 0), 0));
    const S = { n: rows.reduce((a, r) => a + r.n, 0), tot: r2(rows.reduce((a, r) => a + r.tot, 0)), paid: r2(rows.reduce((a, r) => a + r.paid, 0)) };
    xl = [['Комитент', ...months.map(monLbl), 'Фактури', 'Вкупно со ДДВ', 'Платено', 'Остаток'], ...rows.map((r) => [r.name, ...months.map((m) => r.m[m] ?? 0), r.n, r.tot, r.paid, r2(r.tot - r.paid)]), ['ВКУПНО', ...months.map(colSum), S.n, S.tot, S.paid, r2(S.tot - S.paid)]];
    body = rows.length ? <>
      <div className="tw"><table className="dense"><thead><tr><th>Комитент</th>{months.map((m) => <th key={m} className="n">{monLbl(m)}</th>)}<th className="n">Фактури</th><th className="n">Вкупно со ДДВ</th><th className="n">Платено</th><th className="n">Остаток</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name}><td><b>{r.name}</b></td>{months.map((m) => <td key={m} className="n">{r.m[m] ? fmt(r.m[m]) : ''}</td>)}<td className="n">{r.n}</td><td className="n"><b>{fmt(r.tot)}</b></td><td className="n">{fmt(r.paid)}</td><td className="n" style={r.tot - r.paid > 0.5 ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{fmt(r2(r.tot - r.paid))}</td></tr>)}</tbody>
        <tfoot><tr><th>Вкупно</th>{months.map((m) => <th key={m} className="n">{fmt(colSum(m))}</th>)}<th className="n">{S.n}</th><th className="n">{fmt(S.tot)}</th><th className="n">{fmt(S.paid)}</th><th className="n">{fmt(r2(S.tot - S.paid))}</th></tr></tfoot></table></div>
      <h3 style={{ fontSize: 14, marginTop: 14 }}>Фактури во периодот ({I.length})</h3>
      <div className="tw"><table className="dense"><thead><tr><th>Број</th><th>Датум</th><th>Комитент</th><th className="n">Без ДДВ</th><th className="n">ДДВ</th><th className="n">Вкупно</th><th className="n">Остаток</th><th>Статус</th><th className="noprint" /></tr></thead>
        <tbody>{I.map((i) => { const pm = pay.get(i.id); return <tr key={i.id}><td><b>{i.number}</b></td><td>{dmy(i.date)}</td><td>{i.partner}</td><td className="n">{fmt(Number(i.base) * fxOf(i))}</td><td className="n">{fmt(Number(i.vat) * fxOf(i))}</td><td className="n">{fmt(pm?.total ?? Number(i.total) * fxOf(i))}</td><td className="n">{pm ? fmt(pm.remaining) : ''}</td>
          <td>{i.status === 'posted' ? (pm && pm.remaining <= 0.5 ? <Pill c="good">платена</Pill> : pm && pm.paid > 0 ? <Pill c="warn">делумно</Pill> : <Pill>неплатена</Pill>) : <Pill c="info">нацрт</Pill>}</td>
          <td className="noprint"><Link className="btn sm" href={`/print/doc/${i.id}`} target="_blank">👁</Link></td></tr>; })}</tbody></table></div>
    </> : null;
  }

  if (tab === 'mail') {
    const byInv = new Map<string, typeof mails>();
    for (const m of mails) if (m.inv) byInv.set(m.inv, [...(byInv.get(m.inv) ?? []), m]);
    const no = I.filter((i) => !byInv.has(i.id));
    const ok = mails.filter((m) => m.status === 'sent').length, bad = mails.filter((m) => m.status === 'failed').length;
    xl = [['Фактура', 'Датум', 'Комитент', 'Примач', 'Наслов', 'Статус', 'Испратено', 'Грешка'],
      ...I.flatMap((i) => (byInv.get(i.id) ?? [null]).map((m) => [i.number, dmy(i.date), i.partner ?? '', m ? m.to.join(', ') : '', m?.subject ?? '', m ? m.status : 'НЕ Е ИСПРАТЕНА', m?.sentAt ? dmyHm(m.sentAt) : '', m?.error ?? '']))];
    body = I.length ? <>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><Pill c="good">испратени {ok}</Pill>{bad > 0 && <Pill c="bad">неуспешни {bad}</Pill>}{no.length > 0 && <Pill c="warn">фактури без е-пошта {no.length}</Pill>}</div>
      <div className="tw"><table className="dense"><thead><tr><th>Фактура</th><th>Комитент</th><th>Примач</th><th>Наслов</th><th>Статус</th><th>Испратено</th><th className="noprint" /></tr></thead>
        <tbody>{I.flatMap((i) => {
          const M = byInv.get(i.id);
          if (!M) return [<tr key={i.id} style={{ background: 'var(--warn-bg, #fff7e0)' }}><td><b>{i.number}</b> <span className="mini">{dmy(i.date)}</span></td><td>{i.partner}</td><td className="mini">{i.email || <i>нема е-пошта на комитентот</i>}</td><td /><td><Pill c="warn">не е испратена</Pill></td><td /><td className="noprint"><Link className="btn sm" href={`/print/doc/${i.id}?mail=1`} target="_blank">✉ Прати</Link></td></tr>];
          return M.map((m, k) => <tr key={m.id}><td>{k === 0 && <><b>{i.number}</b> <span className="mini">{dmy(i.date)}</span></>}</td><td>{k === 0 && i.partner}</td><td className="mini">{m.to.join(', ')}</td><td className="mini">{m.subject}</td>
            <td>{m.status === 'sent' ? <Pill c="good">испратена</Pill> : m.status === 'failed' ? <Pill c="bad">неуспешна</Pill> : <Pill c="info">во ред</Pill>}{m.error && <div className="mini" style={{ color: 'var(--bad)' }}>{m.error.slice(0, 120)}</div>}</td>
            <td className="mini">{m.sentAt ? dmyHm(m.sentAt) : dmyHm(m.at)}</td><td className="noprint">{k === 0 && <Link className="btn sm" href={`/print/doc/${i.id}?mail=1`} target="_blank">✉ Повторно</Link>}</td></tr>);
        })}</tbody></table></div>
    </> : null;
  }

  if (tab === 'dolg') {
    const P = new Map<string, { name: string; email: string; L: { id: string; number: string; date: string; due: string | null; open: number; late: number }[] }>();
    for (const i of D) {
      const open = r2(pay.get(i.id)?.remaining ?? 0);
      if (open <= 0.5) continue;
      const k = i.partnerId ?? '-';
      const p = P.get(k) ?? { name: i.partner ?? '—', email: i.email ?? '', L: [] };
      p.L.push({ id: i.id, number: i.number, date: i.date, due: i.due, open, late: i.due && i.due < td ? daysBetween(i.due, td) : 0 });
      P.set(k, p);
    }
    const rows = [...P.entries()].map(([id, p]) => ({ id, ...p, open: r2(p.L.reduce((a, x) => a + x.open, 0)), over: r2(p.L.filter((x) => x.late > 0).reduce((a, x) => a + x.open, 0)), late: Math.max(0, ...p.L.map((x) => x.late)) }))
      .sort((a, b) => b.open - a.open);
    const S = { open: r2(rows.reduce((a, r) => a + r.open, 0)), over: r2(rows.reduce((a, r) => a + r.over, 0)) };
    xl = [['Комитент', 'Фактура', 'Датум', 'Валута', 'Остаток', 'Денови доцнење'], ...rows.flatMap((r) => r.L.map((x) => [r.name, x.number, dmy(x.date), dmy(x.due), x.open, x.late || ''])), ['ВКУПНО', '', '', '', S.open, '']];
    body = rows.length ? <>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><Pill c="warn">вкупно долг {fmt(S.open)} ден.</Pill><Pill c="bad">доспеан {fmt(S.over)} ден.</Pill><span className="note">состојба на {dmy(td)} · само прокнижени фактури, по сите плаќања и одобренија</span></div>
      <div className="tw"><table className="dense"><thead><tr><th>Комитент</th><th className="n">Фактури</th><th className="n">Долг</th><th className="n">Доспеан</th><th className="n">Најстара (денови)</th><th>Фактури</th><th className="noprint" /></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td><b>{r.name}</b>{r.email && <div className="mini">{r.email}</div>}</td><td className="n">{r.L.length}</td><td className="n"><b>{fmt(r.open)}</b></td><td className="n" style={r.over > 0 ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{fmt(r.over)}</td>
          <td className="n" style={r.late > 30 ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{r.late || ''}</td>
          <td className="mini">{r.L.map((x) => <div key={x.id}><Link href={`/print/doc/${x.id}`} target="_blank">{x.number}</Link> од {dmy(x.date)} – {fmt(x.open)}{x.late > 0 && <span style={{ color: 'var(--bad)' }}> · {x.late} дена</span>}</div>)}</td>
          <td className="noprint">{r.id !== '-' && <Link className="btn sm" href={`/kkart?k=1200&sub=1&p=${r.id}`} title="Картица на комитентот">📒 Картица</Link>}</td></tr>)}</tbody>
        <tfoot><tr><th>Вкупно</th><th className="n">{rows.reduce((a, r) => a + r.L.length, 0)}</th><th className="n">{fmt(S.open)}</th><th className="n">{fmt(S.over)}</th><th colSpan={3} /></tr></tfoot></table></div>
    </> : <div className="card empty">Нема неплатени фактури. 👍</div>;
  }

  if (tab === 'prod') {
    const dOf = new Map(I.map((i) => [i.id, i]));
    const P = new Map<string, { name: string; unit: string; m: Record<string, number>; qty: number; base: number; vat: number; buyers: Set<string> }>();
    for (const l of lines) {
      const i = dOf.get(l.inv);
      if (!i) continue;
      const k = l.name.trim().toLowerCase();
      const p = P.get(k) ?? { name: l.name.trim(), unit: l.unit ?? '', m: {}, qty: 0, base: 0, vat: 0, buyers: new Set<string>() };
      const qn = Number(l.qty), b = r2(qn * Number(l.price) * (1 - Number(l.disc) / 100) * fxOf(i));
      p.m[i.date.slice(0, 7)] = (p.m[i.date.slice(0, 7)] ?? 0) + qn;
      p.qty += qn; p.base = r2(p.base + b); p.vat = r2(p.vat + b * l.rate / 100);
      if (i.partnerId) p.buyers.add(i.partnerId);
      P.set(k, p);
    }
    const rows = [...P.values()].sort((a, b) => b.base - a.base);
    const S = { base: r2(rows.reduce((a, r) => a + r.base, 0)), vat: r2(rows.reduce((a, r) => a + r.vat, 0)) };
    xl = [['Производ', 'Ед. мерка', ...months.map((m) => `Кол. ${monLbl(m)}`), 'Количина', 'Комитенти', 'Без ДДВ', 'ДДВ', 'Со ДДВ'], ...rows.map((r) => [r.name, r.unit, ...months.map((m) => r.m[m] ?? 0), r.qty, r.buyers.size, r.base, r.vat, r2(r.base + r.vat)]), ['ВКУПНО', '', ...months.map(() => ''), '', '', S.base, S.vat, r2(S.base + S.vat)]];
    body = rows.length ? <div className="tw"><table className="dense"><thead><tr><th>Производ</th><th>Ед.</th>{months.map((m) => <th key={m} className="n">{monLbl(m)}</th>)}<th className="n">Количина</th><th className="n">Комитенти</th><th className="n">Без ДДВ</th><th className="n">ДДВ</th><th className="n">Со ДДВ</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.name}><td><b>{r.name}</b></td><td>{r.unit}</td>{months.map((m) => <td key={m} className="n">{r.m[m] ? r2(r.m[m]) : ''}</td>)}<td className="n"><b>{r2(r.qty)}</b></td><td className="n">{r.buyers.size}</td><td className="n">{fmt(r.base)}</td><td className="n">{fmt(r.vat)}</td><td className="n"><b>{fmt(r2(r.base + r.vat))}</b></td></tr>)}</tbody>
      <tfoot><tr><th colSpan={4 + months.length}>Вкупно</th><th className="n">{fmt(S.base)}</th><th className="n">{fmt(S.vat)}</th><th className="n">{fmt(r2(S.base + S.vat))}</th></tr></tfoot></table></div> : null;
  }

  return (
    <>
      <Hd t="📊 Извештаи – периодични фактури" sub={`${firm.name} · ${all ? 'сите купувачи' : `${recP.length} комитенти со периодична фактура`}`}>
        <Link className="btn" href="/periodicni">🔁 Периодични фактури</Link>
        {xl.length > 1 && <ExportXlsx name={`Izvestaj-${tab}-${from}_${to}.xlsx`} rows={xl} label="⬇ Excel извештај" />}
      </Hd>
      <div className="row noprint" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {(Object.keys(TABS) as Tab[]).map((k) => <Link key={k} className={`btn${k === tab ? ' pri' : ''}`} href={q({ t: k })}>{TABS[k]}</Link>)}
      </div>
      <form className="row noprint" style={{ gap: 8, marginBottom: 10, alignItems: 'end' }} action="/periodicni/izvestai">
        <input type="hidden" name="t" value={tab} />
        {tab !== 'dolg' && <><label className="f">Од месец<input type="month" name="od" defaultValue={from} /></label><label className="f">До месец<input type="month" name="do" defaultValue={to} /></label></>}
        <label className="chk"><input type="checkbox" name="all" value="1" defaultChecked={all} /> сите купувачи (не само со периодична фактура)</label>
        <button className="btn">Прикажи</button>
      </form>
      <div id="perRep">
        <h2 style={{ fontSize: 15 }}>{tab === 'dolg' ? `${TABS.dolg} · ${firm.name} · на ${dmy(td)}` : title}</h2>
        {body ?? <div className="card empty">{!all && !recP.length ? 'Фирмата нема периодични фактури – штиклирајте „сите купувачи“.' : 'Нема фактури во избраниот период.'}</div>}
      </div>
    </>
  );
}
