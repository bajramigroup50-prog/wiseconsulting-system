/**
 * Legacy `VIEWS.servis` 9645 / `woEditor` 9650 — Сервис: работни налози (list with search and the open/all filter,
 * editor with parts and labour, invoice that issues the parts from stock, PDF).
 */
import Link from 'next/link';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { vehicleLabel, woCalc, woState, WO_STATUS } from '@wise/core/industry';
import { employees, firmAutoConfig, invoices, nextWorkOrderNumber, workOrders } from '@wise/db';
import { customerVehicleList, partsCatalog } from '@/lib/auto';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { WorkOrderEditor } from '@/components/work-order-editor';
import { deleteWorkOrderAction, type WorkOrderPayload } from './actions';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default async function Servis({ searchParams }: { searchParams: Promise<{ id?: string; veh?: string; q?: string; f?: string; saved?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('servis', 'Сервис – работни налози');
  if (g.blocked) return g.blocked;
  const { firm, year } = g;
  const cfg = firmAutoConfig(firm);
  const [V, P] = await Promise.all([customerVehicleList(firm.id), partnerOptions(firm.id)]);

  if (sp.id) {
    const [w] = sp.id === 'new' ? [] : await db().select().from(workOrders).where(and(eq(workOrders.id, sp.id), eq(workOrders.firmId, firm.id))).limit(1);
    if (sp.id !== 'new' && !w) return <><Hd t="Работен налог" /><div className="callout bad">Работниот налог не постои.</div></>;
    const [I, M, inv] = await Promise.all([
      partsCatalog(firm.id),
      db().select({ id: employees.id, name: employees.name }).from(employees).where(and(eq(employees.firmId, firm.id), eq(employees.active, true))).orderBy(asc(employees.name)),
      w?.invoiceId ? db().select({ id: invoices.id, number: invoices.number }).from(invoices).where(eq(invoices.id, w.invoiceId)).limit(1) : Promise.resolve([]),
    ]);
    const v0 = V.find((x) => x.id === (w?.vehicleId ?? sp.veh));
    const init: WorkOrderPayload = w ? {
      id: w.id, number: w.number, date: w.date, vehicleId: w.vehicleId, partnerId: w.partnerId, km: w.km ? String(w.km) : '', mechanicId: w.mechanicId ?? '', status: w.status,
      complaint: w.complaint ?? '', work: w.work ?? '', nextKm: w.nextKm ? String(w.nextKm) : '', nextDate: w.nextDate ?? '', nextNote: w.nextNote ?? '', parts: w.parts, labour: w.labour,
    } : {
      id: '', number: await nextWorkOrderNumber(db(), firm.id, today()), date: today(), vehicleId: v0?.id ?? '', partnerId: v0?.partnerId ?? '', km: '', mechanicId: '', status: 'open',
      complaint: '', work: '', nextKm: '', nextDate: '', nextNote: 'Редовен сервис', parts: [], labour: [],
    };
    const hist = v0 ? (await db().select().from(workOrders).where(and(eq(workOrders.firmId, firm.id), eq(workOrders.vehicleId, v0.id))).orderBy(desc(workOrders.date)))
      .filter((x) => x.id !== w?.id).slice(0, 5).map((x) => ({ date: x.date, text: String(x.work || x.complaint || '').slice(0, 40) })) : [];
    const st = w ? woState(w) : 'open';
    return (
      <>
        <Hd t={w ? `Работен налог ${w.number}` : 'Нов работен налог'} sub={WO_STATUS[st][0]}>
          <Link className="btn" href="/servis">← Листа</Link>
          {w && <Link className="btn" href={`/servis/nalog?id=${w.id}`} target="_blank">🖨 PDF</Link>}
          {w && !w.invoiceId && g.del && <RowAction className="btn ghost" action={deleteWorkOrderAction.bind(null, w.id)} confirm={`Да се избрише налогот ${w.number}?`} label="🗑 Избриши" />}
        </Hd>
        {sp.saved && <div className="callout good">Работниот налог е зачуван.</div>}
        <WorkOrderEditor init={init} state={st} vehicles={V} partners={P.map((p) => ({ id: p.id, name: p.name }))} mechanics={M}
          goods={I.filter((i) => i.type !== 'service')} services={I.filter((i) => i.type === 'service')} hourPrice={cfg.hr} intervalKm={cfg.km}
          history={hist} readOnly={!g.write || !!w?.invoiceId} invoice={inv[0] ?? null} />
      </>
    );
  }

  const f = sp.f === 'all' ? 'all' : 'act';
  const q = (sp.q ?? '').trim();
  const L0 = await db().select().from(workOrders).where(eq(workOrders.firmId, firm.id)).orderBy(desc(workOrders.date), desc(workOrders.number));
  const invN = new Map((await db().select({ id: invoices.id, n: invoices.number }).from(invoices).where(and(eq(invoices.firmId, firm.id), sql`${invoices.data}->'source'->>'type' = 'work_order'`))).map((x) => [x.id, x.n]));
  const pn = (id: string | null) => P.find((p) => p.id === id)?.name ?? '';
  const vl = (id: string) => vehicleLabel(V.find((x) => x.id === id));
  let L = L0;
  if (q) L = L.filter((w) => fold([w.number, w.plate, pn(w.partnerId), vl(w.vehicleId), w.complaint].join(' ')).includes(fold(q)));
  if (f === 'act') L = L.filter((w) => woState(w) !== 'inv');
  return (
    <>
      <Hd t="Сервис – работни налози" sub={String(year)}>
        <Link className="btn" href="/vozila">🚘 Возила</Link><Link className="btn" href="/delovi">🔩 Делови</Link><Link className="btn" href="/potsetnici">⏰ Потсетници</Link>
        {g.write && <Link className="btn pri" href="/servis?id=new">+ Нов работен налог</Link>}
      </Hd>
      <form className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input name="q" placeholder="🔍 Таблица, број, сопственик…" defaultValue={q} style={{ width: 280 }} />
        <select name="f" defaultValue={f} style={{ width: 'auto' }}><option value="act">отворени (примени, во работа, завршени)</option><option value="all">сите</option></select>
        <button className="btn">Прикажи</button>
      </form>
      <div className="tw"><table><thead><tr><th>Број</th><th>Датум</th><th>Возило</th><th>Сопственик</th><th className="n">Км</th><th>Дефект / работа</th><th className="n">Износ со ДДВ</th><th>Статус</th><th /></tr></thead>
        <tbody>{L.map((w) => { const s = WO_STATUS[woState(w)]; return (
          <tr key={w.id}><td><b>{w.number}</b></td><td>{dmy(w.date)}</td><td>{vl(w.vehicleId) || w.plate}</td><td>{pn(w.partnerId)}</td><td className="n">{w.km ? w.km.toLocaleString('de-DE') : ''}</td>
            <td className="mini">{String(w.complaint ?? '').slice(0, 60)}</td><td className="n">{fmt(woCalc(w).tot)}</td>
            <td><span className={`pill ${s[1]}`}>{s[0]}</span>{w.invoiceId && <span className="mini"> {invN.get(w.invoiceId)}</span>}</td>
            <td><Link className="btn sm" href={`/servis?id=${w.id}`}>Отвори</Link></td></tr>); })}
          {!L.length && <tr><td colSpan={9} className="note">Нема работни налози.</td></tr>}</tbody></table></div>
    </>
  );
}
