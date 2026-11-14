/**
 * 💰 Профит на канцеларијата по клиент (Дневник на активности → owner only): for whole months `od`–`do` (`YYYY-MM`),
 * per client firm the accounting fee (the monthly fee invoice `fee_invoices.net` when issued, else the agreed fee
 * `settings.accFee` / the service contract) against the colleagues' active time in the firm (activity log, work
 * movements `classifyAction`, `activeMinutes` per colleague and firm) at the hourly cost `c` (default 500 ден/ч):
 * revenue per hour, profit, loss-making clients „за поскапување“ first. Excel (CSV) + print.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { addDays } from '@wise/core/office';
import { clientProfit, monthsOf, periodFee, profitTotals } from '@wise/core/office/client-profit';
import { todaySkopje } from '@wise/core/office/dates';
import { activeMinutes, classifyAction, fmtMinutes, skopjeDayStart } from '@wise/core/office/productivity';
import { auditLog, feeInvoices, firms, serviceContracts } from '@wise/db';
import { db } from '@/lib/db';
import { firmSideSql, officeFirmFor, scopeAuditSql } from '@/lib/demo-office';
import { fmt } from '@/lib/fmt';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { DownloadCsv } from '@/components/download-csv';
import { Hd } from '@/components/hd';
import { ownerGate } from '../../produktivnost/data';
import { PrintBtn } from '../mesec/print-btn';

const T = '💰 Профит на канцеларијата по клиент';
const MN = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const ml = (m: string) => `${MN[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const isM = (s: string | undefined): s is string => /^\d{4}-(0[1-9]|1[0-2])$/.test(s ?? '');
const nextM = (m: string) => { const y = +m.slice(0, 4), n = +m.slice(5, 7); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ od?: string; do?: string; c?: string }> }) {
  const { u, ok } = await ownerGate();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  if (!ok) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const sp = await searchParams;
  const td = todaySkopje();
  const prev = (() => { let y = +td.slice(0, 4), m = +td.slice(5, 7) - 1; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; })();
  let mFrom = isM(sp.od) ? sp.od : prev, mTo = isM(sp.do) ? sp.do : mFrom;
  if (mTo < mFrom) [mFrom, mTo] = [mTo, mFrom];
  const months = monthsOf(mFrom, mTo);
  mTo = months[months.length - 1]!;
  const cost = Math.max(0, Math.min(100000, Math.round(Number(String(sp.c ?? '').replace(/[\s.]/g, '').replace(',', '.')) || 500)));
  const from = mFrom + '-01', to = addDays(nextM(mTo) + '-01', -1);

  const office = await officeFirmFor(u);
  const [F, R] = await Promise.all([
    db().select({ id: firms.id, name: firms.name, settings: firms.settings }).from(firms).where(and(firmSideSql(u), eq(firms.active, true))),
    db().select({ u: auditLog.userId, f: auditLog.firmId, a: auditLog.action, e: auditLog.entityType, d: auditLog.data, at: auditLog.at }).from(auditLog)
      .where(and(scopeAuditSql(u), gte(auditLog.at, skopjeDayStart(from)), lt(auditLog.at, skopjeDayStart(addDays(to, 1))))).limit(900000),
  ]);
  const clients = F.filter((f) => f.id !== office?.id);
  const ids = clients.map((f) => f.id);
  const [FI, SC] = ids.length ? await Promise.all([
    db().select({ f: feeInvoices.clientFirmId, p: feeInvoices.period, net: feeInvoices.net }).from(feeInvoices)
      .where(and(inArray(feeInvoices.clientFirmId, ids), gte(feeInvoices.period, mFrom), lte(feeInvoices.period, mTo))),
    db().select({ f: serviceContracts.firmId, fee: serviceContracts.fee, status: serviceContracts.status, date: serviceContracts.date }).from(serviceContracts)
      .where(inArray(serviceContracts.firmId, ids)),
  ]) : [[], []];
  const billed = new Map<string, Map<string, number>>();
  for (const x of FI) { const m = billed.get(x.f) ?? new Map<string, number>(); m.set(x.p, (m.get(x.p) ?? 0) + Number(x.net)); billed.set(x.f, m); }
  // newest signed contract first, else the newest draft
  const con = new Map<string, number>();
  for (const c of [...SC].sort((a, b) => (a.status === 'signed' ? 0 : 1) - (b.status === 'signed' ? 0 : 1) || b.date.localeCompare(a.date))) if (!con.has(c.f) && c.status !== 'ended') con.set(c.f, Number(c.fee));

  // active minutes per colleague × firm (a burst counts in the firm it was done for)
  const tm = new Map<string, number[]>();
  const users = new Map<string, Set<string>>();
  for (const r of R) {
    if (!r.u || !r.f) continue;
    const c = classifyAction(r.a, r.e, r.d as Record<string, unknown> | null);
    if (!c || c.byProduct) continue;
    const k = r.f + '|' + r.u;
    const a = tm.get(k); if (a) a.push(r.at.getTime()); else tm.set(k, [r.at.getTime()]);
    const s = users.get(r.f) ?? new Set<string>(); s.add(r.u); users.set(r.f, s);
  }
  const mins = new Map<string, number>();
  for (const [k, t] of tm) { const f = k.slice(0, k.indexOf('|')); mins.set(f, (mins.get(f) ?? 0) + activeMinutes(t.sort((a, b) => a - b))); }

  const rows = clientProfit(clients.map((f) => {
    const st = (f.settings ?? {}) as { accFee?: unknown };
    const monthly = Number(st.accFee) || con.get(f.id) || 0;
    const pf = periodFee(months, billed.get(f.id) ?? new Map(), monthly);
    return { id: f.id, name: f.name, fee: pf.fee, minutes: mins.get(f.id) ?? 0, billedMonths: pf.billedMonths };
  }).filter((r) => r.fee > 0 || r.minutes > 0), cost, months.length);
  const tot = profitTotals(rows);
  const noFee = rows.filter((r) => r.fee <= 0 && r.minutes > 0).length;
  const opts = Array.from({ length: 24 }, (_, i) => { const d = new Date(Date.UTC(+td.slice(0, 4), +td.slice(5, 7) - 1 - i, 1)); return d.toISOString().slice(0, 7); });
  const n0 = (x: number) => Math.round(x).toLocaleString('mk-MK');
  const csv: (string | number | null)[][] = [
    ['Фирма', 'Хонорар', 'Фактурирани месеци', 'Часови', 'Колеги', 'Приход по час', 'Трошок на време', 'Профит', 'Маржа %', 'Предлог хонорар / месец'],
    ...rows.map((r) => [r.name, r.fee, r.billedMonths ?? 0, r.hours, users.get(r.id)?.size ?? 0, r.perHour, r.cost, r.profit, r.margin, r.suggest]),
  ];

  return (
    <div className="pdfdoc-screen">
      <Hd t={T} sub={`${months.length === 1 ? ml(mFrom) : `${ml(mFrom)} – ${ml(mTo)}`} · трошок ${n0(cost)} ден/ч`} exp={false}>
        <DownloadCsv name={`Profit_po_klient_${mFrom}_${mTo}.csv`} label="Excel" rows={csv} />
        <PrintBtn />
        <Link className="btn" href="/aktivnost">← Дневник на активности</Link>
      </Hd>
      <form className="card noprint" method="get" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="f" style={{ margin: 0 }}>Од месец<select name="od" defaultValue={mFrom}>{opts.map((m) => <option key={m} value={m}>{ml(m)}</option>)}</select></label>
        <label className="f" style={{ margin: 0 }}>До месец<select name="do" defaultValue={mTo}>{opts.map((m) => <option key={m} value={m}>{ml(m)}</option>)}</select></label>
        <label className="f" style={{ margin: 0 }}>Трошок за час работа (ден)<input name="c" inputMode="numeric" defaultValue={String(cost)} style={{ width: 120, textAlign: 'right' }} /></label>
        <button className="btn pri">Прикажи</button>
      </form>
      <div className="bh-stats" style={{ margin: '14px 0' }}>
        <div className="bh-card bh-g1"><span className="bh-ic">💵</span><span className="bh-t">Хонорари</span><b className="bh-v">{n0(tot.fee)}</b><span className="bh-s">{rows.length} клиенти</span></div>
        <div className="bh-card bh-g2"><span className="bh-ic">⏱</span><span className="bh-t">Активно време</span><b className="bh-v">{fmtMinutes(Math.round(tot.hours * 60))}</b><span className="bh-s">приход по час {tot.perHour != null ? n0(tot.perHour) : '—'} ден</span></div>
        <div className={`bh-card ${tot.profit >= 0 ? 'bh-g3' : 'bh-g4'}`}><span className="bh-ic">📈</span><span className="bh-t">Профит</span><b className="bh-v">{n0(tot.profit)}</b><span className="bh-s">трошок на време {n0(tot.cost)}</span></div>
        <div className="bh-card bh-g4"><span className="bh-ic">🔻</span><span className="bh-t">За поскапување</span><b className="bh-v">{tot.loss}</b><span className="bh-s">клиенти со загуба{noFee ? ` · ${noFee} без хонорар` : ''}</span></div>
      </div>
      <div className="card" style={{ borderRadius: 16 }}><div className="hd"><h2>По клиент · најлошите прво</h2></div>
        <div className="tw"><table>
          <thead><tr><th>Фирма</th><th className="n">Хонорар</th><th className="n">Часови</th><th className="n">Колеги</th><th className="n">Приход / час</th><th className="n">Трошок на време</th><th className="n">Профит</th><th className="n">Маржа</th><th>Статус</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link className="lnk" href={`/aktivnost?f=${r.id}&od=${from}&do=${to}`}>{r.name}</Link>{r.billedMonths ? <small className="mini" title="месеци со издадена фактура за сметководствени услуги"> 🧾 {r.billedMonths}/{months.length}</small> : null}</td>
              <td className="n">{fmt(r.fee)}</td><td className="n">{r.hours ? String(r.hours).replace('.', ',') : '—'}</td><td className="n">{users.get(r.id)?.size ?? 0}</td>
              <td className="n" style={{ color: r.perHour != null && r.perHour < cost ? 'var(--bad)' : undefined }}>{r.perHour != null ? n0(r.perHour) : '—'}</td>
              <td className="n">{fmt(r.cost)}</td><td className="n"><b style={{ color: r.profit < 0 ? 'var(--bad)' : 'var(--good)' }}>{fmt(r.profit)}</b></td>
              <td className="n">{r.margin != null ? `${String(r.margin).replace('.', ',')}%` : '—'}</td>
              <td>{r.fee <= 0 ? <span className="pill warn">⚠️ без хонорар</span> : r.loss ? <span className="pill bad">🔻 за поскапување{r.suggest ? ` · предлог ${n0(r.suggest)}/мес.` : ''}</span> : <span className="pill good">✅ профитабилен</span>}</td>
            </tr>))}
            {!rows.length && <tr><td colSpan={9} className="empty">Нема клиенти со хонорар или работа во периодот.</td></tr>}</tbody>
          {rows.length > 0 && <tfoot><tr><th>Вкупно</th><th className="n">{fmt(tot.fee)}</th><th className="n">{String(tot.hours).replace('.', ',')}</th><th /><th className="n">{tot.perHour != null ? n0(tot.perHour) : '—'}</th><th className="n">{fmt(tot.cost)}</th><th className="n">{fmt(tot.profit)}</th><th /><th /></tr></tfoot>}
        </table></div>
        <p className="mini" style={{ margin: '8px 0 0' }}>Хонорар = нето од месечната фактура за сметководствени услуги (🧾) кога е издадена, инаку договорениот месечен хонорар (Фирми → хонорар / договор). Часови = активно време на колегите во фирмата од Дневникот на активности (работни активности во низа, паузи над 15 мин. не се сметаат) – реалното време може да е поголемо. Профит = хонорар − часови × {n0(cost)} ден. Предлогот за поскапување е хонорарот што го покрива времето – ориентационо.</p>
      </div>
    </div>
  );
}
