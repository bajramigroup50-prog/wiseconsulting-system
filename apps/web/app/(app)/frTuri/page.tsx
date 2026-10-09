/**
 * Legacy `VIEWS.frTuri` 14479 / `frEditor` 14703 — превоз за трети лица: tours (CMR data, countries crossed, per diems
 * abroad, tolls, fuel), result per tour, one Phase 3 invoice for several tours of a client (in the tours' currency).
 */
import Link from 'next/link';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { fxRate } from '@wise/core';
import { FR_COUNTRIES, FR_REDUCTIONS, FR_STATUS, frCountryName, frPerDiems, nextModuleNumber } from '@wise/core/industry';
import { employees, fleetVehicles, freightTours, industryConfigOf, invoices, loadFxSources } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { deleteFreightAction, invoiceFreightAction, saveFreightAction } from '../pnalozi/actions';

export default async function FrTuri({ searchParams }: { searchParams: Promise<{ id?: string; st?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frTuri', 'Превоз за трети лица');
  if (g.blocked) return g.blocked;
  const { firm, write, year } = g;
  const [P, V, Dr, fx] = await Promise.all([
    partnerOptions(firm.id),
    db().select().from(fleetVehicles).where(eq(fleetVehicles.firmId, firm.id)).orderBy(asc(fleetVehicles.plate)),
    db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)),
    loadFxSources(db(), firm.id),
  ]);
  const rates = (industryConfigOf<{ rates: Record<string, [number, string]> }>(firm, 'frt').rates ?? {}) as Record<string, [number, string]>;
  const dn = (t: { red: number; segs: { c: string; in: string; out: string; units?: number | string | null }[]; date: string }) => frPerDiems(t, (c, d) => (c === 'MKD' ? 1 : fxRate(c, d, fx)), rates);

  if (sp.id) {
    const all = await db().select({ n: freightTours.number }).from(freightTours).where(eq(freightTours.firmId, firm.id));
    const [t0] = sp.id === 'new' ? [] : await db().select().from(freightTours).where(and(eq(freightTours.id, sp.id), eq(freightTours.firmId, firm.id))).limit(1);
    const t = t0 ?? { id: '', number: nextModuleNumber('Т-', all.map((x) => x.n).filter((n) => n.endsWith('/' + year)), year), date: today(), status: 'plan' as const, partnerId: null, orderNo: '', km: null, vehicleId: null, trailer: '', driverId: null, driver2Id: null,
      loadPlace: '', loadC: 'MK', sender: '', unloadDate: null, unloadPlace: '', unloadC: '', consignee: '', retDate: null, goods: '', packages: '', kg: null, m3: null, adr: '', docsAtt: '', price: null, cur: 'EUR', fx: null, vat: 'intl' as const, red: 100, tolls: null, tollCur: 'EUR', otherCost: null, note: '', segs: [], invoiceId: null };
    const d = dn(t);
    const v = (x: unknown) => (x == null ? '' : String(x));
    const ctry = <>{FR_COUNTRIES.map((c) => <option key={c[0]} value={c[0]}>{c[1]}</option>)}</>;
    return (
      <>
        <Hd t={t.id ? `Тура ${t.number}` : 'Нова тура'} sub={FR_STATUS[t.status][0]}><Link className="btn" href="/frTuri">← Тури</Link></Hd>
        <BankForm action={saveFreightAction}>
          <input type="hidden" name="id" value={t.id} />
          <div className="card"><div className="form">
            <label className="f">Број (CMR)<input name="number" defaultValue={t.number} /></label>
            <label className="f">Датум<input name="date" type="date" defaultValue={t.date} /></label>
            <label className="f">Статус<select name="status" defaultValue={t.status}>{Object.entries(FR_STATUS).filter(([k]) => k !== 'inv' || t.invoiceId).map(([k, s]) => <option key={k} value={k}>{s[0]}</option>)}</select></label>
            <label className="f">Клиент (налогодавач)<select name="partner" defaultValue={t.partnerId ?? ''}><option value="">—</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Нарачка бр.<input name="orderNo" defaultValue={v(t.orderNo)} /></label>
            <label className="f">Км<input name="km" type="number" defaultValue={v(t.km)} /></label>
            <label className="f">Возило<select name="veh" defaultValue={t.vehicleId ?? ''}><option value="">—</option>{V.filter((x) => !x.trailer).map((x) => <option key={x.id} value={x.id}>{x.plate}</option>)}</select></label>
            <label className="f">Приколка<input name="trailer" defaultValue={v(t.trailer)} list="fr_tr" /></label>
            <datalist id="fr_tr">{V.filter((x) => x.trailer).map((x) => <option key={x.id} value={x.plate} />)}</datalist>
            <label className="f">Возач<select name="drv" defaultValue={t.driverId ?? ''}><option value="">—</option>{Dr.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="f">Втор возач<select name="drv2" defaultValue={t.driver2Id ?? ''}><option value="">—</option>{Dr.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="f">Место на товарење<input name="loadPlace" defaultValue={v(t.loadPlace)} /></label>
            <label className="f">Држава<select name="loadC" defaultValue={v(t.loadC)}><option value="MK">Македонија</option>{ctry}</select></label>
            <label className="f">Испраќач<input name="sender" defaultValue={v(t.sender)} /></label>
            <label className="f">Датум на истовар<input name="unloadDate" type="date" defaultValue={v(t.unloadDate)} /></label>
            <label className="f">Место на истовар<input name="unloadPlace" defaultValue={v(t.unloadPlace)} /></label>
            <label className="f">Држава<select name="unloadC" defaultValue={v(t.unloadC)}><option value="">—</option><option value="MK">Македонија</option>{ctry}</select></label>
            <label className="f">Примач<input name="consignee" defaultValue={v(t.consignee)} /></label>
            <label className="f">Враќање во база<input name="retDate" type="date" defaultValue={v(t.retDate)} /></label>
            <label className="f">Стока<input name="goods" defaultValue={v(t.goods)} /></label>
            <label className="f">Пакети<input name="packages" defaultValue={v(t.packages)} /></label>
            <label className="f">Кг<input name="kg" type="number" step="any" defaultValue={v(t.kg)} /></label>
            <label className="f">м³<input name="m3" type="number" step="any" defaultValue={v(t.m3)} /></label>
            <label className="f">ADR<input name="adr" defaultValue={v(t.adr)} /></label>
            <label className="f">Цена<input name="price" type="number" step="any" defaultValue={v(t.price)} /></label>
            <label className="f">Валута<input name="cur" defaultValue={t.cur} style={{ width: 70 }} /></label>
            <label className="f">Курс<input name="fx" type="number" step="any" defaultValue={v(t.fx)} placeholder="од курсната листа" /></label>
            <label className="f">ДДВ<select name="vat" defaultValue={t.vat}><option value="intl">меѓународен превоз (0%)</option><option value="dom">домашен превоз (18%)</option></select></label>
            <label className="f">Патарини<input name="tolls" type="number" step="any" defaultValue={v(t.tolls)} /></label>
            <label className="f">Валута патарини<input name="tollCur" defaultValue={v(t.tollCur)} style={{ width: 70 }} /></label>
            <label className="f">Други трошоци (ден.)<input name="otherCost" type="number" step="any" defaultValue={v(t.otherCost)} /></label>
            <label className="f">Дневници<select name="red" defaultValue={String(t.red)}>{FR_REDUCTIONS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label className="f wide">Забелешка<input name="note" defaultValue={v(t.note)} /></label>
          </div></div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Држави (влез / излез) – дневници во странство</h2>
            <table className="dense"><thead><tr><th>Држава</th><th>Влез</th><th>Излез</th><th className="n">Дневници (рачно)</th><th className="n">Автоматски</th><th className="n">Износ</th><th className="n">ден.</th></tr></thead>
              <tbody>{[...t.segs, ...Array(3).fill({ c: '', in: '', out: '', units: '' })].map((s, i) => { const r = d.rows.find((x) => x.c === s.c && x.in === s.in); return (
                <tr key={i}><td><select name={`g.c.${i}`} defaultValue={s.c}><option value="">—</option>{ctry}</select></td><td><input name={`g.in.${i}`} type="datetime-local" defaultValue={s.in} /></td><td><input name={`g.out.${i}`} type="datetime-local" defaultValue={s.out} /></td>
                  <td className="n"><input name={`g.units.${i}`} type="number" step="0.5" defaultValue={s.units ?? ''} style={{ width: 70 }} /></td><td className="n">{r?.auto ?? ''}</td><td className="n">{r ? `${fmt(r.v)} ${r.cur}` : ''}</td><td className="n">{r ? fmt(r.m) : ''}</td></tr>); })}</tbody>
              <tfoot><tr><td colSpan={5}>Вкупно {d.totH ? `${d.totH} ч → ${d.totU} дневници` : ''}{d.miss.length ? ` · нема курс за ${d.miss.join(', ')}` : ''}</td><td className="n">{Object.entries(d.by).map(([c, x]) => `${fmt(x)} ${c}`).join(' + ')}</td><td className="n"><b>{fmt(d.mkd)}</b></td></tr></tfoot></table>
            <p className="note">Времето се брои од преминот на македонската граница до враќањето: за секои 24 ч = 1 дневница, остаток над 12 ч = 1, од 8 до 12 ч = ½; се дели по држави според времето поминато во секоја.</p>
          </div>
          {write && !t.invoiceId && <div className="row"><span style={{ flex: 1 }} />{t.id && <RowAction className="btn ghost" action={deleteFreightAction.bind(null, t.id)} confirm={`Да се избрише турата ${t.number}?`} label="Избриши" />}<button className="btn pri">Зачувај</button></div>}
          {t.invoiceId && <p className="note">Турата е фактурирана – цената, валутата, ДДВ и клиентот не се менуваат тука.</p>}
        </BankForm>
      </>
    );
  }

  const L = await db().select().from(freightTours).where(and(eq(freightTours.firmId, firm.id), sql`extract(year from ${freightTours.date}) = ${year}`, sp.st ? eq(freightTours.status, sp.st as 'plan') : undefined)).orderBy(desc(freightTours.date));
  const inv = new Map((await db().select({ id: invoices.id, n: invoices.number }).from(invoices).where(eq(invoices.firmId, firm.id))).map((x) => [x.id, x.n]));
  return (
    <>
      <Hd t="Превоз за трети лица – тури" sub={String(year)}>
        <Link className="btn" href="/frDnev">🧾 Дневници</Link><Link className="btn" href="/frDok">📄 Лиценци и документи</Link>
        {write && <Link className="btn pri" href="/frTuri?id=new">+ Нова тура</Link>}
      </Hd>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}><Link className={`btn sm ${!sp.st ? 'pri' : ''}`} href="/frTuri">Сите</Link>{Object.entries(FR_STATUS).map(([k, s]) => <Link key={k} className={`btn sm ${sp.st === k ? 'pri' : ''}`} href={`/frTuri?st=${k}`}>{s[0]}</Link>)}</div>
      <BankForm action={invoiceFreightAction}>
        <div className="tw"><table><thead><tr><th /><th>Тура</th><th>Датум</th><th>Клиент</th><th>Релација</th><th>Возило</th><th className="n">Цена</th><th className="n">Дневници ден.</th><th>Статус</th><th /></tr></thead>
          <tbody>{L.map((t) => { const s = FR_STATUS[t.status]; const vv = V.find((x) => x.id === t.vehicleId); return (
            <tr key={t.id}><td>{!t.invoiceId && t.partnerId && <input type="checkbox" name="sel" value={t.id} style={{ width: 'auto' }} />}</td><td><b>{t.number}</b></td><td>{dmy(t.date)}</td><td>{P.find((p) => p.id === t.partnerId)?.name}</td>
              <td className="mini">{t.loadPlace} ({t.loadC}) → {t.unloadPlace} ({t.unloadC ? frCountryName(t.unloadC) : ''})</td><td>{vv?.plate}{t.trailer ? '/' + t.trailer : ''}</td>
              <td className="n">{t.price ? `${fmt(t.price)} ${t.cur}` : ''}</td><td className="n">{fmt(dn(t).mkd)}</td><td><span className={`pill ${s[1]}`}>{s[0]}</span>{t.invoiceId && <span className="mini"> {inv.get(t.invoiceId)}</span>}</td>
              <td><Link className="btn sm" href={`/frTuri?id=${t.id}`}>Отвори</Link></td></tr>); })}
            {!L.length && <tr><td colSpan={10} className="note">Нема тури.</td></tr>}</tbody></table></div>
        {write && L.some((t) => !t.invoiceId) && <div className="row" style={{ marginTop: 8 }}><span style={{ flex: 1 }} /><button className="btn pri">🧾 Фактура од избраните тури</button></div>}
      </BankForm>
    </>
  );
}
