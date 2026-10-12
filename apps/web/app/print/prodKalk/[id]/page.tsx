/**
 * „КАЛКУЛАЦИЈА НА ПРОИЗВОДСТВО“ of a sales invoice with production (production invoice „🏭 Фактура од производство“
 * or lines marked „🏭 Производство“): invoice header data (број, датум, комитент, курс, работен налог / период), per
 * product the materials (booked: at the value the production order issued them), labour, other direct costs,
 * overhead, cost of production, unit cost, sale value and margin, the notes (materials short), on the firm header.
 * Data: `@wise/db` `invoiceProdSheet`.
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { invoiceProdSheet, invoices } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { FirmHead } from '../../firm-head';

export default async function PrintProdKalk({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [inv] = await db().select({ firmId: invoices.firmId }).from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv || !firmAllowed(u.principal, inv.firmId)) notFound();
  const S = await invoiceProdSheet(db(), inv.firmId, id);
  if (!S) notFound();
  const pct = (x: number | null) => (x == null ? '—' : `${x.toFixed(2)}%`);
  return (
    <div className="pdfdoc printarea" data-testid="prod-kalk">
      <FirmHead firm={S.firm} title={`КАЛКУЛАЦИЈА НА ПРОИЗВОДСТВО кон фактура бр. ${S.number}`} sub={`${S.prodInv ? 'Фактура од производство' : 'Производство по фактура'} · ${dmy(S.date)}${S.booked ? '' : ' · ПЛАН (не е прокнижено)'}`} />
      <div className="grid2">
        <div className="box"><b>Фактура бр.:</b> {S.number}<br /><b>Датум:</b> {dmy(S.date)}<br /><b>Комитент:</b> {S.partner || '—'}</div>
        <div className="box"><b>Валута / курс:</b> {S.currency === 'MKD' ? 'денари' : `${S.currency} · ${S.fx}`}<br /><b>Работен налог / период:</b> {S.workOrder || '—'}</div>
      </div>
      {S.products.map((p, k) => (
        <div key={k} style={{ marginTop: 10, breakInside: 'avoid' }}>
          <h3 style={{ margin: '6px 0' }}>{k + 1}. {p.code ? `[${p.code}] ` : ''}{p.name} · {fq(p.qty)} {p.unit}{p.orderNo ? ` · налог за производство бр. ${p.orderNo}` : ''}</h3>
          {p.spec && <div className="mini">Спецификација: {p.spec}</div>}
          <table>
            <thead><tr><th>Р.б.</th><th>Шифра</th><th>Репроматеријал</th><th>Ем</th><th className="n">Количина</th><th className="n">Просечна цена</th><th className="n">Вредност</th></tr></thead>
            <tbody>
              {p.materials.map((m, j) => <tr key={j}><td>{j + 1}</td><td>{m.code}</td><td>{m.name}{m.short ? ' ⚠ недостига' : ''}</td><td>{m.unit}</td><td className="n">{fq(m.qty)}</td><td className="n">{fmt(m.price)}</td><td className="n">{fmt(m.value)}</td></tr>)}
              {!p.materials.length && <tr><td colSpan={7}>Без репроматеријали.</td></tr>}
              <tr className="tot"><td colSpan={6}>Материјали</td><td className="n">{fmt(p.mat)}</td></tr>
            </tbody>
          </table>
          <table style={{ width: '60%', marginLeft: 'auto' }}><tbody>
            <tr><td>Материјали</td><td className="n">{fmt(p.mat)}</td></tr>
            <tr><td>Труд{p.labNote ? ` (${p.labNote})` : ''}</td><td className="n">{fmt(p.lab)}</td></tr>
            {p.other.map((o, j) => <tr key={j}><td>{o.label || 'Друг директен трошок'}</td><td className="n">{fmt(o.amount)}</td></tr>)}
            {p.ovh ? <tr><td>Режиски трошоци {p.ovhPct ? `${p.ovhPct}%` : ''}</td><td className="n">{fmt(p.ovh)}</td></tr> : null}
            <tr className="tot"><td>Цена на чинење</td><td className="n">{fmt(p.cost)}</td></tr>
            <tr><td>Цена на чинење по единица</td><td className="n">{fmt(p.unitCost)}</td></tr>
            <tr><td>Продажна вредност (без ДДВ, ден.)</td><td className="n">{fmt(p.sale)}</td></tr>
            <tr className="tot"><td>Маржа</td><td className="n" style={p.margin < 0 ? { color: '#b00' } : undefined}>{fmt(p.margin)} ({pct(p.pct)})</td></tr>
          </tbody></table>
          {p.below && <p style={{ color: '#b00' }}>⚠ Се продава под цената на чинење.</p>}
        </div>
      ))}
      {S.products.length > 1 && <table style={{ width: '60%', marginLeft: 'auto', marginTop: 10 }}><tbody>
        <tr className="tot"><td>Вкупно цена на чинење</td><td className="n">{fmt(S.totals.cost)}</td></tr>
        <tr><td>Вкупно продажна вредност</td><td className="n">{fmt(S.totals.sale)}</td></tr>
        <tr className="tot"><td>Вкупно маржа</td><td className="n">{fmt(S.totals.margin)} ({pct(S.totals.pct)})</td></tr>
      </tbody></table>}
      {S.notes.length > 0 && <div style={{ marginTop: 8 }}><b>Напомена:</b><ul style={{ margin: '4px 0' }}>{S.notes.map((n, k) => <li key={k}>{n}</li>)}</ul></div>}
      <div className="sig"><span>Калкулирал</span><span>Одобрил</span></div>
    </div>
  );
}
