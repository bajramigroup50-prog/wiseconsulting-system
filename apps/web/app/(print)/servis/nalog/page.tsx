/** Legacy `woPdfHTML` (9674): РАБОТЕН НАЛОГ – СЕРВИС. */
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { partLineBase, woCalc } from '@wise/core/industry';
import { customerVehicles, employees, items, partners, workOrders } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

const fq = (v: number | string) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 3 });

export default async function WorkOrderPrint({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('servis', 'Работен налог');
  if (g.blocked || !id) notFound();
  const [w] = await db().select().from(workOrders).where(and(eq(workOrders.id, id), eq(workOrders.firmId, g.firm.id))).limit(1);
  if (!w) notFound();
  const [[v], [p], [m]] = await Promise.all([
    db().select().from(customerVehicles).where(eq(customerVehicles.id, w.vehicleId)).limit(1),
    db().select().from(partners).where(eq(partners.id, w.partnerId)).limit(1),
    w.mechanicId ? db().select().from(employees).where(eq(employees.id, w.mechanicId)).limit(1) : Promise.resolve([]),
  ]);
  const ids = w.parts.map((x) => x.itemId).filter((x): x is string => !!x);
  const codes = new Map(ids.length ? (await db().select({ id: items.id, code: items.code }).from(items).where(inArray(items.id, ids))).map((x) => [x.id, x.code]) : []);
  const c = woCalc(w);
  return (
    <>
      <DocHead firm={g.firm} title="РАБОТЕН НАЛОГ – СЕРВИС" sub={`бр. ${w.number} од ${dmy(w.date)}`} />
      <table><tbody>
        <tr><td style={{ width: '28%' }}>Клиент</td><td><b>{p?.name}</b>{p?.phone ? ' · ' + p.phone : ''}</td></tr>
        <tr><td>Возило</td><td><b>{v?.plate ?? w.plate}</b> {[v?.make, v?.model, v?.year].filter(Boolean).join(' ')}{v?.vin ? ' · VIN ' + v.vin : ''}</td></tr>
        <tr><td>Километража</td><td>{w.km ? `${fq(w.km)} км` : ''}</td></tr>
        <tr><td>Опис на дефект</td><td>{w.complaint}</td></tr>
        <tr><td>Извршена работа</td><td>{w.work}</td></tr>
        {m && <tr><td>Механичар</td><td>{m.name}</td></tr>}
      </tbody></table>
      <h2>Делови</h2>
      <table><thead><tr><th>Шифра</th><th>Назив</th><th className="n">Кол.</th><th className="n">Цена</th><th className="n">Рабат</th><th className="n">Износ без ДДВ</th></tr></thead>
        <tbody>{w.parts.map((x, i) => <tr key={i}><td>{x.itemId ? codes.get(x.itemId) ?? '' : ''}</td><td>{x.name}</td><td className="n">{fq(x.qty)}</td><td className="n">{fmt(x.price)}</td><td className="n">{x.disc ? x.disc + '%' : ''}</td><td className="n">{fmt(partLineBase(x))}</td></tr>)}
          {!w.parts.length && <tr><td colSpan={6}>—</td></tr>}</tbody></table>
      <h2>Работа</h2>
      <table><thead><tr><th>Опис</th><th className="n">Часови</th><th className="n">Цена/час</th><th className="n">Износ без ДДВ</th></tr></thead>
        <tbody>{w.labour.map((x, i) => <tr key={i}><td>{x.name}</td><td className="n">{fq(x.hrs)}</td><td className="n">{fmt(x.price)}</td><td className="n">{fmt(Number(x.hrs) * Number(x.price))}</td></tr>)}
          {!w.labour.length && <tr><td colSpan={4}>—</td></tr>}</tbody></table>
      <table style={{ width: '60%', marginLeft: 'auto' }}><tbody>
        <tr><td>Основица</td><td className="n">{fmt(c.base)}</td></tr><tr><td>ДДВ</td><td className="n">{fmt(c.vat)}</td></tr><tr><td><b>Вкупно</b></td><td className="n"><b>{fmt(c.tot)}</b></td></tr>
      </tbody></table>
      {(w.nextKm || w.nextDate) && <p>Следен сервис: {w.nextKm ? `на ${fq(w.nextKm)} км` : ''}{w.nextKm && w.nextDate ? ' или ' : ''}{w.nextDate ? `до ${dmy(w.nextDate)}` : ''} {w.nextNote}</p>}
      <p style={{ fontSize: '9pt' }}>Со потписот клиентот го предава возилото за поправка и ја прифаќа извршената работа.</p>
      <Signs L={['Примил (сервис)', 'Клиент']} />
    </>
  );
}
