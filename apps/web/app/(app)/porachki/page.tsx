/**
 * Нарачки од купувачи — legacy `VIEWS.porachki` 9870, `ordEditor`, `ordSaveB`, `ordInv`, `ordCancel`, `ordPdf`
 * (потврда на нарачка, `?view=`). An order reserves stock (available = stock − reserved); "Фактура за преостанатото"
 * creates an invoice draft for what is on stock; delivered quantities come from the invoices issued from the order.
 */
import Link from 'next/link';
import { asc, desc, eq } from 'drizzle-orm';
import { calcLines, Retail } from '@wise/core';
import { customerOrders, partners } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { orderItemOptions, reservations } from '@/lib/retail';
import { stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { PrintButton } from '@/components/stock-ui';
import { cancelOrderAction, orderInvoiceAction } from '../_retail/actions';
import { OrderEditor } from '../_retail/order-editors';

type SP = { f?: string; id?: string; nov?: string; view?: string };
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default async function PorachkiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, L } = await stockPage('porachki');
  if (!firm || !L) return <NoFirm t="Нарачки од купувачи" />;
  const write = canDo(u, 'ordSaveB', firm.id);
  const [all, P, R] = await Promise.all([
    db().select().from(customerOrders).where(eq(customerOrders.firmId, firm.id)).orderBy(desc(customerOrders.date), desc(customerOrders.number)),
    db().select({ id: partners.id, name: partners.name, address: partners.address, data: partners.data }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name)),
    reservations(db(), firm.id),
  ]);
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const stateOf = (o: (typeof all)[number]) => Retail.orderState({ id: o.id, status: o.status, lines: o.lines }, R.deliveries.get(o.id) ?? {});
  const today = todayIso();
  const qty = (id: string) => L.ctx.moves.filter((m) => m.item === id && !m.pend).reduce((s, m) => s + m.qty, 0);

  const view = sp.view ? all.find((o) => o.id === sp.view) : undefined;
  if (view) {
    const c = calcLines(view.lines.map((l) => ({ qty: l.qty, price: l.price, disc: l.disc, rate: l.rate })));
    const p = P.find((x) => x.id === view.partnerId);
    return (
      <>
        <Hd t={'Нарачка ' + view.number}><Link className="btn" href={`/porachki?id=${view.id}`}>← Назад</Link><PrintButton /></Hd>
        <div className="printarea pdfdoc" style={{ background: '#fff', padding: 12 }}>
          <div className="ph"><div><div className="pt">ПОТВРДА НА НАРАЧКА</div><div className="ps">бр. {view.number} од {dmy(view.date)}</div></div><div className="pm">{firm.name}</div></div>
          <p><b>Купувач:</b> {p?.name}{p?.address ? ', ' + p.address : ''}{view.deliveryDate && <><br /><b>Испорака до:</b> {dmy(view.deliveryDate)}</>}{view.note && <><br />{view.note}</>}</p>
          <table><thead><tr><th>Р.бр</th><th>Артикл</th><th>ЕМ</th><th className="n">Кол.</th><th className="n">Цена</th><th className="n">Рабат</th><th className="n">ДДВ</th><th className="n">Износ</th></tr></thead>
            <tbody>{view.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td>{l.unit}</td><td className="n">{fq(l.qty)}</td><td className="n">{fmt(l.price)}</td><td className="n">{l.disc ? l.disc + '%' : ''}</td><td className="n">{l.rate}%</td><td className="n">{fmt(l.qty * l.price * (1 - (l.disc || 0) / 100))}</td></tr>)}</tbody></table>
          <table style={{ width: '50%', marginLeft: 'auto' }}><tbody><tr><td>Основица</td><td className="n">{fmt(c.base)}</td></tr><tr><td>ДДВ</td><td className="n">{fmt(c.vat)}</td></tr><tr><td><b>Вкупно</b></td><td className="n"><b>{fmt(c.total)}</b></td></tr></tbody></table>
          <div className="sig"><span>Примил нарачка</span><span>Купувач</span></div>
        </div>
      </>
    );
  }

  const edit = sp.id ? all.find((o) => o.id === sp.id) : undefined;
  if (write && (sp.nov !== undefined || edit)) {
    const st = edit ? stateOf(edit) : 'open';
    const items = await orderItemOptions(db(), L, R.reserved, edit?.lines);
    const dl = edit ? Retail.orderRest(edit.lines, R.deliveries.get(edit.id) ?? {}) : [];
    return (
      <>
        <Hd t={edit ? 'Нарачка ' + edit.number : 'Нова нарачка'} sub={Retail.ORDER_STATES[st][0]}>
          <Link className="btn" href="/porachki">← Листа</Link>
          {edit && <Link className="btn" href={`/porachki?view=${edit.id}`}>🖨 Потврда на нарачка</Link>}
          {edit && (st === 'open' || st === 'part') && <RowAction action={orderInvoiceAction.bind(null, edit.id)} className="btn pri" label="🧾 Фактура за преостанатото" confirm="Да се направи нацрт-фактура за преостанатото (количините на залиха)?" />}
          {edit && st === 'open' && <RowAction action={cancelOrderAction.bind(null, edit.id)} className="btn ghost" style={{ color: 'var(--bad)' }} label="Откажи нарачка" confirm={`Да се откаже нарачката ${edit.number}?`} />}
        </Hd>
        <OrderEditor items={items} partners={P.map((p) => ({ id: p.id, name: p.name, disc: Number((p.data as Record<string, unknown>).disc) || 0 }))}
          initial={edit ? {
            id: edit.id, number: edit.number, date: edit.date, partnerId: edit.partnerId ?? '', deliveryDate: edit.deliveryDate ?? '', note: edit.note ?? '',
            lines: edit.lines.map((l, i) => ({ itemId: l.itemId, name: l.name, unit: l.unit ?? '', qty: String(l.qty), price: String(l.price), disc: l.disc ? String(l.disc) : '', rate: l.rate, dl: dl[i]?.dl ?? 0 })),
          } : { number: '', date: today, partnerId: '', deliveryDate: addDays(today, 2), note: '', lines: [] }} />
      </>
    );
  }

  const f = sp.f === 'all' ? 'all' : 'act';
  const list = all.filter((o) => f === 'all' || ['open', 'part'].includes(stateOf(o)));
  return (
    <>
      <Hd t="Нарачки од купувачи" sub={String(list.length)}>
        <Link className="btn" href="/nabavki">📦 Нарачки до добавувачи</Link><Link className="btn" href="/dopolnuvanje">🔄 Дополнување залиха</Link>
        {write && <Link className="btn pri" href="/porachki?nov">+ Нова нарачка</Link>}
      </Hd>
      <div className="row" style={{ marginBottom: 8, gap: 6 }}>
        <Link className={`btn sm ${f === 'act' ? 'pri' : ''}`} href="/porachki">отворени и делумни</Link><Link className={`btn sm ${f === 'all' ? 'pri' : ''}`} href="/porachki?f=all">сите</Link>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Број</th><th>Датум</th><th>Купувач</th><th>Испорака до</th><th className="n">Ставки</th><th className="n">Износ со ДДВ</th><th>Залиха</th><th>Статус</th><th /></tr></thead>
        <tbody>{list.map((o) => {
          const st = stateOf(o);
          const S = Retail.ORDER_STATES[st];
          const rest = Retail.orderRest(o.lines, R.deliveries.get(o.id) ?? {});
          const sh = rest.filter((l) => l.rest > 0 && l.itemId && L.items.get(l.itemId)?.type !== 'service' && qty(l.itemId) < l.rest).length;
          const c = calcLines(o.lines.map((l) => ({ qty: l.qty, price: l.price, disc: l.disc, rate: l.rate })));
          return (
            <tr key={o.id}>
              <td><b>{o.number}</b></td><td>{dmy(o.date)}</td><td>{pName.get(o.partnerId ?? '')}</td>
              <td>{dmy(o.deliveryDate)}{o.deliveryDate && o.deliveryDate < today && (st === 'open' || st === 'part') && <> <span className="pill bad">доцни</span></>}</td>
              <td className="n">{o.lines.length}</td><td className="n">{fmt(c.total)}</td>
              <td>{sh ? <span className="pill warn">недостига {sh}</span> : <span className="pill good">има</span>}</td>
              <td><span className={'pill ' + S[1]}>{S[0]}</span></td>
              <td><Link className="btn sm" href={`/porachki?id=${o.id}`}>Отвори</Link></td>
            </tr>
          );
        })}{!list.length && <tr><td colSpan={9} className="note">Нема нарачки.</td></tr>}</tbody>
      </table></div>
      <p className="note">Нарачката ја резервира залихата (достапно = залиха − резервирано). Од нарачката се прави фактура за преостанатото; фактурата влегува во патниот налог. Производите што недостигаат ги планира „Планирање на производство“.</p>
    </>
  );
}
