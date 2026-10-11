/**
 * Legacy `VIEWS.frTuri` 14479 / `frEditor` 14503 (+ quick-add patch 14703) — 🚛 Тури – превоз за трети лица: tours with
 * client, route, vehicle / driver, price (currency + MKD), costs (`frCost`: card fuel + tolls + per diems + other),
 * difference and status; expiring-licence callout; filters; pick tours of one client → one invoice; Excel (`frTXlsx`,
 * the legacy 23 columns) and PDF of the list. `?id=` opens the editor (`?dn=1` = straight to the borders table).
 */
import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import {
  FR_FILTERS, FR_STATUS, FR_XLSX_HEAD, frCanPick, frDmy, frExpiredFor, frExpiring, frFilterTours, frNextNo, frXlsxRow, isMonth, monthOptions, type FrStatus,
} from '@wise/core/industry';
import { freightTours, invoices } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { freightContext } from '@/lib/freight';
import { industryPage, today } from '@/lib/industry';
import { FreightEditor, FreightPickForm, type FrEditorTour } from '@/components/freight-ui';
import { ExportXlsx, ListPdf, type Cell } from '@/components/list-tools';
import { Hd } from '@/components/hd';

const s = (x: unknown) => (x == null ? '' : String(x));

export default async function FrTuri({ searchParams }: { searchParams: Promise<{ id?: string; st?: string; mo?: string; p?: string; dn?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frTuri', 'Тури – превоз за трети лица');
  if (g.blocked) return g.blocked;
  const { firm, write, year } = g;
  const td = today();
  const [P, X, invs] = await Promise.all([
    partnerOptions(firm.id),
    freightContext(firm),
    db().select({ id: invoices.id, n: invoices.number }).from(invoices).where(and(eq(invoices.firmId, firm.id), sql`${invoices.data}->'source'->>'type' = 'freight_tour'`)),
  ]);
  const invNo = new Map(invs.map((x) => [x.id, x.n]));
  const pname = (id: string | null | undefined) => (id ? P.find((p) => p.id === id)?.name ?? '' : '');

  /* ---------------- editor ---------------- */
  if (sp.id) {
    const all = await db().select({ number: freightTours.number, date: freightTours.date }).from(freightTours).where(eq(freightTours.firmId, firm.id));
    const [t0] = sp.id === 'new' ? [] : await db().select().from(freightTours).where(and(eq(freightTours.id, sp.id), eq(freightTours.firmId, firm.id))).limit(1);
    const segs = (t0?.segs ?? []).map((x) => ({ c: s(x.c), in: s(x.in), out: s(x.out), units: s(x.units) }));
    if (sp.dn && !segs.length) segs.push({ c: '', in: '', out: '', units: '' });
    const t: FrEditorTour = t0 ? {
      id: t0.id, number: t0.number, date: t0.date, status: t0.status, partnerId: s(t0.partnerId), orderNo: s(t0.orderNo), km: s(t0.km), vehicleId: s(t0.vehicleId), trailer: s(t0.trailer),
      driverId: s(t0.driverId), driver2Id: s(t0.driver2Id), loadPlace: s(t0.loadPlace), loadC: s(t0.loadC), sender: s(t0.sender), unloadDate: s(t0.unloadDate), unloadPlace: s(t0.unloadPlace),
      unloadC: s(t0.unloadC), consignee: s(t0.consignee), retDate: s(t0.retDate), goods: s(t0.goods), packages: s(t0.packages), kg: s(t0.kg), m3: s(t0.m3), adr: s(t0.adr), docsAtt: s(t0.docsAtt),
      price: s(t0.price), cur: t0.cur, fx: s(t0.fx), vat: t0.vat, red: String(t0.red), tolls: s(t0.tolls), tollCur: s(t0.tollCur) || 'EUR', otherCost: s(t0.otherCost), note: s(t0.note), segs,
      invoiceId: t0.invoiceId, invNumber: t0.invoiceId ? invNo.get(t0.invoiceId) ?? null : null,
    } : {
      // Legacy `ACT.frNew`: number, today, planned, EUR, international, full per diem, loading in MK.
      id: '', number: frNextNo(all, td), date: td, status: 'plan', partnerId: '', orderNo: '', km: '', vehicleId: '', trailer: '', driverId: '', driver2Id: '', loadPlace: '', loadC: 'MK', sender: '',
      unloadDate: '', unloadPlace: '', unloadC: '', consignee: '', retDate: '', goods: '', packages: '', kg: '', m3: '', adr: '', docsAtt: '', price: '', cur: 'EUR', fx: '', vat: 'intl', red: '100',
      tolls: '', tollCur: 'EUR', otherCost: '', note: '', segs, invoiceId: null, invNumber: null,
    };
    // FX table for the live notes: every rate the tour's dates can need, plus the latest rate as a fallback.
    const curs = new Set(['EUR', 'USD', 'CHF', 'GBP', ...Object.values(X.rates).map((r) => r[1])]);
    const dates = new Set([t.date, t.unloadDate, ...segs.flatMap((x) => [x.in.slice(0, 10), x.out.slice(0, 10)])].filter(Boolean));
    const fxTable: Record<string, number> = {};
    for (const c of curs) { fxTable[`${c}|*`] = X.fx(c, td); for (const d of dates) fxTable[`${c}|${d}`] = X.fx(c, d); }
    const fu = t0 ? X.fuel(t0) : { mkd: 0, l: 0 };
    const bad = t0 ? frExpiredFor(t0, X.docs.map((d) => ({ ...d.data })), td).map((d) => `${d.kind} (${dmy(d.validTo)})`) : [];
    const active = (e: { id: string; active: boolean }) => e.active || e.id === t.driverId || e.id === t.driver2Id;
    return (
      <FreightEditor t={t} partners={P.map((p) => ({ id: p.id, name: p.name }))}
        vehicles={X.V.filter((v) => !v.trailer).map((v) => ({ id: v.id, label: `${v.plate} ${v.name ?? ''}`.trim() }))}
        trailers={X.V.filter((v) => v.trailer).map((v) => ({ plate: v.plate, name: v.name ?? '' }))}
        drivers={X.E.filter(active).map((e) => ({ id: e.id, name: e.name }))} rates={X.rates} fxTable={fxTable} fuel={{ mkd: fu.mkd, l: fu.l }} bad={bad}
        write={write} canDel={g.del} focusSeg={!!sp.dn} />
    );
  }

  /* ---------------- list ---------------- */
  const F = { st: sp.st || 'open', mo: isMonth(sp.mo) ? sp.mo : '', p: sp.p || '' };
  const Y = await db().select().from(freightTours).where(and(eq(freightTours.firmId, firm.id), sql`extract(year from ${freightTours.date}) = ${year}`));
  const L = frFilterTours(Y, F).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
  const ex = frExpiring(X.docs.map((d) => d.data), td);
  let sRev = 0, sCost = 0;
  const R = L.map((t) => { const e = X.econ(t); sRev += e.rev; sCost += e.cost.total; return { t, ...e }; });
  const xlsx: Cell[][] = [[...FR_XLSX_HEAD], ...[...Y].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((t) => {
    const e = X.econ(t);
    return frXlsxRow(t, { partner: pname(t.partnerId), plate: X.plate(t.vehicleId), driver: X.driver(t.driverId), rev: e.rev, cost: e.cost, invNumber: t.invoiceId ? invNo.get(t.invoiceId) ?? '' : '' });
  })];
  const filters = (
    <form className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <select name="st" defaultValue={F.st} style={{ width: 'auto' }}>{FR_FILTERS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      <select name="mo" defaultValue={F.mo} style={{ width: 'auto' }}><option value="">— сите месеци —</option>{monthOptions(F.mo || td.slice(0, 7), year).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      <select name="p" defaultValue={F.p} className="wide" style={{ width: 'auto', maxWidth: 280 }}><option value="">— сите клиенти —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button className="btn">Филтрирај</button>
    </form>
  );
  return (
    <>
      <Hd t="🚛 Тури – превоз за трети лица" sub={`${L.length} тури`}>
        <Link className="btn" href="/frDok">📋 Лиценци</Link><Link className="btn" href="/frDnev">🌍 Дневници</Link><Link className="btn" href="/frGor">⛽ Картички</Link>
        <ExportXlsx name={`Turi_${year}.xlsx`} sheets={[{ name: 'Тури', rows: xlsx }]} />
        <ListPdf target="frTuriList" title={`Тури – превоз за трети лица ${year}`} landscape />
        {write && <Link className="btn pri" href="/frTuri?id=new">+ Нова тура</Link>}
      </Hd>
      {ex.length > 0 && <div className="callout warn">📋 <b>{ex.length}</b> лиценци/документи истекуваат или се истечени: {ex.slice(0, 4).map((x) => `${X.docLabel(x.d)} – ${x.d.kind} ${frDmy(x.d.validTo)}`).join(' · ')} <Link className="btn sm" href="/frDok">Види</Link></div>}
      <FreightPickForm write={write} filters={filters}>
        {L.length ? <div id="frTuriList">
          <div className="tw"><table><thead><tr><th /><th>Тура</th><th>Клиент</th><th>Релација</th><th>Возило / возач</th><th className="n">Км</th><th className="n">Цена</th><th className="n">Трошоци</th><th className="n">Разлика</th><th>Статус</th></tr></thead>
            <tbody>{R.map(({ t, rev, cost, diff }) => {
              const st = FR_STATUS[(t.status || 'plan') as FrStatus] ?? FR_STATUS.plan;
              return (
                <tr key={t.id}>
                  <td>{write && frCanPick(t) && <input type="checkbox" name="sel" value={t.id} aria-label="Избери" style={{ width: 'auto' }} />}</td>
                  <td><Link href={`/frTuri?id=${t.id}`}><b>{t.number}</b></Link><br /><small className="note">{dmy(t.date)}</small></td>
                  <td>{pname(t.partnerId) || '—'}{t.orderNo && <><br /><small className="note">нар. {t.orderNo}</small></>}</td>
                  <td>{t.loadPlace} <small className="note">{t.loadC}</small> → {t.unloadPlace} <small className="note">{t.unloadC}</small></td>
                  <td>{X.plate(t.vehicleId)}{t.trailer ? ' / ' + t.trailer : ''}<br /><small className="note">{X.driver(t.driverId)}</small></td>
                  <td className="n">{t.km ? fq(t.km) : ''}</td>
                  <td className="n">{t.cur && t.cur !== 'MKD' ? <>{fmt(t.price)} {t.cur}<br /><small className="note">{fmt(rev)} ден.</small></> : fmt(rev)}</td>
                  <td className="n">{fmt(cost.total)}</td>
                  <td className="n" style={diff < 0 ? { color: 'var(--bad)' } : undefined}>{fmt(diff)}</td>
                  <td><span className={`pill ${st[1]}`}>{st[0]}</span>{t.invoiceId && <><br /><small className="note">ф-ра {invNo.get(t.invoiceId) ?? ''}</small></>}</td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr><th colSpan={6}>Вкупно</th><th className="n">{fmt(sRev)}</th><th className="n">{fmt(sCost)}</th><th className="n">{fmt(sRev - sCost)}</th><th /></tr></tfoot></table></div>
          <p className="note">Трошоци = гориво од картичките (иста регистрација, во периодот на турата) + патарини + дневници + други трошоци. Износите во девизи се по курс на НБРМ.</p>
        </div> : <div className="empty">Нема тури. Кликнете „+ Нова тура“.</div>}
      </FreightPickForm>
    </>
  );
}
