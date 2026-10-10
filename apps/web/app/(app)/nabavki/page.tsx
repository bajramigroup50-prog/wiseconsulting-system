/**
 * Нарачки до добавувачи — legacy `VIEWS.nabavki` 9900, `poOpen`, `poSaveB`, `poRecv`, `poCancel`, `poPdf` (`?view=`).
 * Supplier orders are not posted; they come from replenishment, MRP or are entered by hand.
 * The e-mail to the supplier (`poMail`, Gmail MCP in legacy) is replaced by the printable order.
 */
import Link from 'next/link';
import { asc, desc, eq } from 'drizzle-orm';
import { partners, supplierOrders } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { orderItemOptions, reservations } from '@/lib/retail';
import { stockPage, todayIso } from '@/lib/stock';
import { dmy, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PrintButton } from '@/components/stock-ui';
import { poStatusAction } from '../_retail/actions';
import { PoEditor } from '../_retail/order-editors';

const ST: Record<string, [string, string]> = { open: ['отворена', 'info'], recv: ['примена', 'good'], cancel: ['откажана', ''] };

export default async function NabavkiPage({ searchParams }: { searchParams: Promise<{ id?: string; nov?: string; view?: string }> }) {
  const sp = await searchParams;
  const { u, firm, L } = await stockPage('nabavki');
  if (!firm || !L) return <NoFirm t="Нарачки до добавувачи" />;
  const write = canDo(u, 'poSaveB', firm.id);
  const [all, P] = await Promise.all([
    db().select().from(supplierOrders).where(eq(supplierOrders.firmId, firm.id)).orderBy(desc(supplierOrders.date), desc(supplierOrders.number)),
    db().select({ id: partners.id, name: partners.name, address: partners.address }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name)),
  ]);
  const pName = new Map(P.map((p) => [p.id, p.name]));

  const view = sp.view ? all.find((o) => o.id === sp.view) : undefined;
  if (view) {
    const p = P.find((x) => x.id === view.partnerId);
    return (
      <>
        <Hd t={'Нарачка до добавувач ' + view.number}><Link className="btn" href={`/nabavki?id=${view.id}`}>← Назад</Link><PrintButton /></Hd>
        <div className="printarea pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <div className="ph"><div><div className="pt">НАРАЧКА ДО ДОБАВУВАЧ</div><div className="ps">бр. {view.number} од {dmy(view.date)}</div></div><div className="pm">{firm.name}</div></div>
          <p><b>До:</b> {p?.name}{p?.address ? ', ' + p.address : ''}{view.note && <><br />{view.note}</>}</p>
          <table><thead><tr><th>Р.бр</th><th>Шифра</th><th>Артикл</th><th>ЕМ</th><th className="n">Количина</th></tr></thead>
            <tbody>{view.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{L.items.get(l.itemId)?.code}</td><td>{l.name}</td><td>{l.unit}</td><td className="n">{fq(l.qty)}</td></tr>)}</tbody></table>
          <p>Ве молиме потврдете ги цената и рокот на испорака.</p>
          <div className="sig"><span>Нарачал</span><span /></div>
        </div>
      </>
    );
  }

  const edit = sp.id ? all.find((o) => o.id === sp.id) : undefined;
  if (write && (sp.nov !== undefined || edit)) {
    const R = await reservations(db(), firm.id);
    const items = await orderItemOptions(db(), L, R.reserved);
    const st = edit?.status ?? 'open';
    return (
      <>
        <Hd t={edit ? 'Нарачка до добавувач ' + edit.number : 'Нова нарачка до добавувач'} sub={ST[st]![0]}>
          <Link className="btn" href="/nabavki">← Листа</Link>
          {edit && <Link className="btn" href={`/nabavki?view=${edit.id}`}>🖨 PDF</Link>}
          {edit && st === 'open' && <RowAction action={poStatusAction.bind(null, edit.id, 'recv')} className="btn" label="✓ Стоката е примена" confirm="Да се означи нарачката како примена? Внесете ја влезната фактура во Влез." />}
          {edit && st === 'open' && <RowAction action={poStatusAction.bind(null, edit.id, 'cancel')} className="btn ghost" style={{ color: 'var(--bad)' }} label="Откажи" confirm="Да се откаже нарачката?" />}
        </Hd>
        <PoEditor items={items} partners={P}
          initial={edit ? { id: edit.id, number: edit.number, date: edit.date, partnerId: edit.partnerId ?? '', note: edit.note ?? '', lines: edit.lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: String(l.qty), price: l.price })) }
            : { date: todayIso(), partnerId: '', note: '', lines: [] }} />
      </>
    );
  }

  return (
    <>
      <Hd t="Нарачки до добавувачи" sub={`${all.filter((p) => p.status === 'open').length} отворени`}>
        <Link className="btn" href="/dopolnuvanje">🔄 Дополнување залиха</Link><Link className="btn" href="/mrp">🏭 Планирање производство</Link>
        {write && <Link className="btn pri" href="/nabavki?nov">+ Нова нарачка</Link>}
      </Hd>
      <div className="tw"><table>
        <thead><tr><th>Број</th><th>Датум</th><th>Добавувач</th><th className="n">Ставки</th><th>Извор</th><th>Статус</th><th /></tr></thead>
        <tbody>{all.map((p) => (
          <tr key={p.id}>
            <td><b>{p.number}</b></td><td>{dmy(p.date)}</td><td>{p.partnerId ? pName.get(p.partnerId) : '— без добавувач —'}</td><td className="n">{p.lines.length}</td>
            <td className="mini">{p.source === 'mrp' ? 'планирање' : p.source === 'repl' ? 'дополнување' : ''}</td>
            <td><span className={'pill ' + ST[p.status]![1]}>{ST[p.status]![0]}</span></td>
            <td><Link className="btn sm" href={`/nabavki?id=${p.id}`}>Отвори</Link></td>
          </tr>
        ))}{!all.length && <tr><td colSpan={7} className="note">Нема нарачки.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
