/**
 * Legacy `VIEWS.servis` 9645 / `woEditor` 9650 — Сервис: работни налози (list with search and the open/all filter,
 * editor with parts and labour, draft invoice reviewed in the invoice editor, PDF). The list bar has the legacy
 * `digBar` tools of this view: „⬇ Извоз“ (Excel / PDF of the table) and the imports `vreg` (🪪 Сообраќајна) and
 * `cveh` (Возила од Excel).
 */
import Link from 'next/link';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { VEHICLE_IMPORT_TEMPLATE, vehicleLabel, woCalc, woState, workOrderExportRows, workOrderMatches, WO_STATUS } from '@wise/core/industry';
import { employees, firmAutoConfig, invoices, nextWorkOrderNumber, workOrders } from '@wise/db';
import { customerVehicleList, partsCatalog } from '@/lib/auto';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { ExportXlsx, ListPdf, XlsxImport } from '@/components/list-tools';
import { RowAction } from '@/components/row-action';
import { VregScan } from '@/components/vreg-scan';
import { WorkOrderEditor } from '@/components/work-order-editor';
import { deleteWorkOrderAction, importCustomerVehiclesAction, type WorkOrderPayload } from './actions';

type SP = { id?: string; veh?: string; q?: string; f?: string; saved?: string; r?: string; add?: string };

export default async function Servis({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('servis', 'Сервис – работни налози');
  if (g.blocked) return g.blocked;
  const { firm, year } = g;
  const cfg = firmAutoConfig(firm);
  const [V, P, L0] = await Promise.all([
    customerVehicleList(firm.id), partnerOptions(firm.id),
    db().select().from(workOrders).where(eq(workOrders.firmId, firm.id)).orderBy(desc(workOrders.date), desc(workOrders.number)),
  ]);
  const invIds = L0.map((w) => w.invoiceId).filter((x): x is string => !!x);
  const INV = new Map((invIds.length ? await db().select({ id: invoices.id, n: invoices.number, status: invoices.status }).from(invoices).where(inArray(invoices.id, invIds)) : [])
    .map((x) => [x.id, x]));
  const withInv = <T extends { invoiceId: string | null }>(w: T) => ({ ...w, invoiceStatus: w.invoiceId ? INV.get(w.invoiceId)?.status ?? null : null });

  if (sp.id) {
    const w0 = sp.id === 'new' ? undefined : L0.find((x) => x.id === sp.id);
    if (sp.id !== 'new' && !w0) return <><Hd t="Работен налог" /><div className="callout bad">Работниот налог не постои.</div></>;
    const w = w0 ? withInv(w0) : undefined;
    const [I, M] = await Promise.all([
      partsCatalog(firm.id),
      db().select({ id: employees.id, name: employees.name }).from(employees).where(and(eq(employees.firmId, firm.id), eq(employees.active, true))).orderBy(asc(employees.name)),
    ]);
    const v0 = V.find((x) => x.id === (w?.vehicleId ?? sp.veh));
    const init: WorkOrderPayload = w ? {
      id: w.id, number: w.number, date: w.date, vehicleId: w.vehicleId, partnerId: w.partnerId, km: w.km ? String(w.km) : '', mechanicId: w.mechanicId ?? '', status: w.status,
      complaint: w.complaint ?? '', work: w.work ?? '', nextKm: w.nextKm ? String(w.nextKm) : '', nextDate: w.nextDate ?? '', nextNote: w.nextNote ?? '', parts: w.parts, labour: w.labour,
    } : {
      id: '', number: await nextWorkOrderNumber(db(), firm.id, today()), date: today(), vehicleId: v0?.id ?? '', partnerId: v0?.partnerId ?? '', km: '', mechanicId: '', status: 'open',
      complaint: '', work: '', nextKm: '', nextDate: '', nextNote: 'Редовен сервис', parts: [], labour: [],
    };
    // legacy: the vehicle line shows the 5 previous services of the chosen vehicle (any vehicle may be chosen in the editor)
    const histories: Record<string, { date: string; text: string }[]> = {};
    for (const x of L0) {
      if (x.id === w?.id) continue;
      const H = (histories[x.vehicleId] ??= []);
      if (H.length < 5) H.push({ date: x.date, text: String(x.work || x.complaint || '').slice(0, 40) });
    }
    const st = w ? woState(w) : 'open';
    const inv = w?.invoiceId && INV.get(w.invoiceId) ? { id: w.invoiceId, number: INV.get(w.invoiceId)!.n, draft: w.invoiceStatus === 'draft' } : null;
    return (
      <>
        <Hd t={w ? `Работен налог ${w.number}` : 'Нов работен налог'} sub={WO_STATUS[st][0]}>
          <Link className="btn" href="/servis">← Листа</Link>
          {w && <Link className="btn" href={`/servis/nalog?id=${w.id}`} target="_blank">🖨 PDF</Link>}
          {w && st !== 'inv' && g.del && <RowAction className="btn ghost" action={deleteWorkOrderAction.bind(null, w.id)} confirm={`Да се избрише налогот ${w.number}?`} label="🗑 Избриши" />}
        </Hd>
        {sp.saved && <div className="callout good">Работниот налог е зачуван.</div>}
        <WorkOrderEditor key={sp.id + (sp.r ?? '') + (sp.add ?? '') + (sp.veh ?? '')} init={init} state={st} vehicles={V} partners={P.map((p) => ({ id: p.id, name: p.name }))} mechanics={M}
          goods={I.filter((i) => i.type !== 'service')} services={I.filter((i) => i.type === 'service')} hourPrice={cfg.hr} intervalKm={cfg.km}
          histories={histories} readOnly={!g.write || st === 'inv'} invoice={inv}
          restore={sp.r === '1'} vehParam={sp.veh} addItem={sp.add} />
      </>
    );
  }

  const f = sp.f === 'all' ? 'all' : 'act';
  const q = (sp.q ?? '').trim();
  const pn = (id: string | null) => P.find((p) => p.id === id)?.name ?? '';
  const vl = (id: string) => vehicleLabel(V.find((x) => x.id === id));
  let L = L0.map(withInv);
  if (q) L = L.filter((w) => workOrderMatches(w, pn(w.partnerId), vl(w.vehicleId), q));
  if (f === 'act') L = L.filter((w) => woState(w) !== 'inv');
  const invNo = (w: (typeof L)[number]) => (w.invoiceId ? (INV.get(w.invoiceId)?.n ?? '') + (w.invoiceStatus === 'draft' ? ' (нацрт)' : '') : '');
  return (
    <>
      <Hd t="Сервис – работни налози" sub={String(year)}>
        <Link className="btn" href="/vozila">🚘 Возила</Link><Link className="btn" href="/delovi">🔩 Делови</Link><Link className="btn" href="/potsetnici">⏰ Потсетници</Link>
        <ExportXlsx name={`Rabotni_nalozi_${year}`} rows={workOrderExportRows(L, (w) => vl(w.vehicleId), (w) => pn(w.partnerId), invNo)} />
        <ListPdf target="wo_list" title="Сервис – работни налози" landscape />
        {g.write && <VregScan firmId={firm.id} />}
        {g.write && <Link className="btn pri" href="/servis?id=new">+ Нов работен налог</Link>}
      </Hd>
      {g.write && <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <XlsxImport action={importCustomerVehiclesAction} template={VEHICLE_IMPORT_TEMPLATE} templateName="Obrazec_Vozila.xlsx" label="📥 Возила од Excel"
          note="Колоните се препознаваат и по назив на македонски, албански или англиски – не мора да се во ист редослед." />
      </div>}
      <form className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input name="q" placeholder="🔍 Таблица, број, сопственик…" defaultValue={q} style={{ width: 280 }} />
        <select name="f" defaultValue={f} style={{ width: 'auto' }}><option value="act">отворени (примени, во работа, завршени)</option><option value="all">сите</option></select>
        <button className="btn">Прикажи</button>
      </form>
      <div className="tw" id="wo_list"><table><thead><tr><th>Број</th><th>Датум</th><th>Возило</th><th>Сопственик</th><th className="n">Км</th><th>Дефект / работа</th><th className="n">Износ со ДДВ</th><th>Статус</th><th /></tr></thead>
        <tbody>{L.map((w) => { const s = WO_STATUS[woState(w)]; return (
          <tr key={w.id}><td><b>{w.number}</b></td><td>{dmy(w.date)}</td><td>{vl(w.vehicleId) || w.plate}</td><td>{pn(w.partnerId)}</td><td className="n">{w.km ? w.km.toLocaleString('de-DE') : ''}</td>
            <td className="mini">{String(w.complaint ?? '').slice(0, 60)}</td><td className="n">{fmt(woCalc(w).tot)}</td>
            <td><span className={`pill ${s[1]}`}>{s[0]}</span>{w.invoiceId && <span className="mini"> {invNo(w)}</span>}</td>
            <td><Link className="btn sm" href={`/servis?id=${w.id}`}>Отвори</Link></td></tr>); })}
          {!L.length && <tr><td colSpan={9} className="note">Нема работни налози.</td></tr>}</tbody></table></div>
    </>
  );
}
