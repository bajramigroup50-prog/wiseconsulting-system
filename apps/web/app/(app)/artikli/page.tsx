/** Legacy `VIEWS.artikli` 6820 → `artikli0` 6821 (`simpleList`), Шифрарник › Производи и артикли. */
import Link from 'next/link';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { effectiveChart, firmPostingContext, itemBarcodes, items, itemSupplierCodes, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteItem, deleteItemsAction, setItemActive } from './actions';
import { fuelItemsRateAction } from '../izlez/actions';
import { fuelBannerFor, itemUsage, usedList } from '@/lib/sales-parity';
import { BulkBar, SelAll, SelBox } from '@/components/sales/bulk-select';
import { schemeValue } from '@wise/core';
import { ItemForm } from './item-form';

const TYPES: Record<string, string> = { service: 'Услуга', goods: 'Стока (трговија)', material: 'Суровина / материјал', product: 'Готов производ' };
const LIMIT = 500;

export default async function ArtikliPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nov?: string; use?: string; t?: string }> }) {
  const sp = await searchParams;
  const svc = sp.t === 'service';
  const base = svc ? '/uslugiS' : '/artikli';
  const { u, firm } = await booksPage(svc ? 'uslugiS' : 'artikli');
  if (!firm) return <NoFirm t={svc ? 'Услуги' : 'Артикли и услуги'} />;
  const q = (sp.q ?? '').trim();
  const bcMatch = q ? db().select({ id: itemBarcodes.itemId }).from(itemBarcodes).where(and(eq(itemBarcodes.firmId, firm.id), eq(itemBarcodes.barcode, q))) : undefined;
  const where = and(eq(items.firmId, firm.id), svc ? eq(items.type, 'service') : undefined, q ? or(ilike(items.name, `%${q}%`), ilike(items.code, `%${q}%`), inArray(items.id, bcMatch!)) : undefined);
  const [rows, [total]] = await Promise.all([
    db().select().from(items).where(where).orderBy(asc(items.name)).limit(LIMIT),
    db().select({ n: sql<number>`count(*)::int` }).from(items).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const bcs = ids.length ? await db().select().from(itemBarcodes).where(inArray(itemBarcodes.itemId, ids)) : [];
  const bcOf = (id: string) => bcs.filter((b) => b.itemId === id).sort((a, b) => Number(b.primary) - Number(a.primary)).map((b) => b.barcode);
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const admin = u.role === 'admin' && del;
  const [used, fuel, [{ c: noName } = { c: 0 }]] = await Promise.all([
    itemUsage(firm.id), svc ? Promise.resolve(null) : fuelBannerFor(firm),
    db().select({ c: sql<number>`count(*)::int` }).from(items).where(and(eq(items.firmId, firm.id), sql`${items.name} ~ '^Артикл\s' and trim(substr(${items.name}, 8)) = coalesce(${items.code}, '')`)),
  ]);
  const useI = sp.use ? rows.find((r) => r.id === sp.use) : undefined;
  const useL = useI ? await usedList(firm.id, 'item', useI.id) : [];
  const ctx = await firmPostingContext(db(), firm);
  const revK = { service: schemeValue(ctx, 'revService'), goods: schemeValue(ctx, 'revGoods'), material: schemeValue(ctx, 'revGoods'), product: schemeValue(ctx, 'revProduct') };
  const auto = rows.some((r) => Number(r.weight) || r.oe || r.crossRefs || r.fits);

  const edit = sp.edit ? (await db().select().from(items).where(and(eq(items.id, sp.edit), eq(items.firmId, firm.id))).limit(1))[0] : undefined;
  const showForm = write && (sp.nov !== undefined || !!edit);
  let form = null;
  if (showForm) {
    const [chart, editBc, sup] = await Promise.all([
      effectiveChart(db(), firm.id),
      edit ? db().select({ b: itemBarcodes.barcode, p: itemBarcodes.primary }).from(itemBarcodes).where(eq(itemBarcodes.itemId, edit.id)) : [],
      edit ? db().select({ code: itemSupplierCodes.code, partner: partners.name }).from(itemSupplierCodes)
        .leftJoin(partners, eq(partners.id, itemSupplierCodes.partnerId)).where(eq(itemSupplierCodes.itemId, edit.id)) : [],
    ]);
    form = (
      <ItemForm it={edit ?? null} barcodes={editBc.sort((a, b) => Number(b.p) - Number(a.p)).map((x) => x.b)} supplierCodes={sup}
        revAccounts={chart.filter((a) => a.code.startsWith('7') && !a.code.startsWith('70')).map((a) => [a.code, a.name])} revK={revK} defType={svc ? 'service' : undefined} back={base} />
    );
  }

  return (
    <>
      <Hd t={svc ? 'Услуги' : 'Артикли и услуги'} sub={`${total?.n ?? 0} ${svc ? 'услуги' : 'артикли'}`}>
        {write && !showForm && !svc && <Link className="btn" href="/uvoz?t=items&back=artikli">Увоз од Excel</Link>}
        {write && <Link className="btn pri" href={`${base}?nov`}>+ Додај</Link>}
      </Hd>
      {fuel && <div className={'callout' + (fuel.warn ? ' warn' : '')} id="fuelBan">⛽ <b>Оваа фирма продава гориво.</b> ДДВ за гориво денес: <b>{fuel.rate}%</b>{fuel.inR && fuel.to ? <> – намалената стапка важи до <b>{fuel.to.split('-').reverse().join('.')}</b>{fuel.left != null ? ` (уште ${fuel.left} ден${fuel.left === 1 ? '' : 'а'})` : ''}, потоа {fuel.else}% освен ако Владата не продолжи</> : null}.{fuel.wrong ? <> <b>{fuel.wrong} артикли гориво</b> се со друга стапка.</> : null} Прилагодете ги и <b>фискалните апарати</b>.{' '}
        {fuel.wrong > 0 && canDo(u, 'settings', firm.id) && <RowAction className="btn sm pri" action={fuelItemsRateAction.bind(null, fuel.rate)} label={`Постави ${fuel.rate}% на артиклите`} confirm={`Да се постави ДДВ ${fuel.rate}% на ${fuel.wrong} артикли гориво?\n\nВажи за новите фактури/продажби. Фискалниот апарат прилагодете го посебно.`} />} <Link className="btn sm" href="/zakoni">⚖️ Извор</Link></div>}
      {noName > 0 && !svc && <div className="callout warn" id="anBtn" style={{ margin: '6px 0' }}>{noName} артикли се само со шифра („Артикл …“). <Link className="btn sm pri" href="/artNames">✎ Внеси називи</Link></div>}
      {form}
      {showForm && edit && !(used.get(edit.id) ?? 0) && del && <div className="row" style={{ marginTop: -6, marginBottom: 10 }}><RowAction className="btn danger" action={deleteItem.bind(null, edit.id)} label="Избриши" confirm={`Да се избрише „${edit.name}“?`} /></div>}
      {useI && <div className="card"><div className="hd"><h2>🔒 {useI.name} – се користи во {used.get(useI.id) ?? 0} документи</h2><Link className="btn sm" href={base}>✕</Link></div>
        <p className="note">Партнер/артикл што е користен не може да се избрише, за да не се расипат книжењата. Ако документите се погрешни, прво избришете ги нив (во нивната листа) – потоа ќе може да се избрише и овој. Инаку означете го како неактивен.</p>
        <div className="tw"><table className="dense"><thead><tr><th>Вид</th><th>Број</th><th>Датум</th><th className="n">Износ</th></tr></thead><tbody>{useL.map((x, k) => <tr key={k}><td>{x.kind}</td><td>{x.number}</td><td>{x.date.split('-').reverse().join('.')}</td><td className="n">{x.total == null ? '' : fmt(x.total)}</td></tr>)}</tbody></table></div></div>}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={q} placeholder="🔍 Барај по назив, шифра или баркод…" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn">Барај</button>
      </form>
      {rows.length ? (<>
        {admin && <BulkBar label={`🗑 Избриши ги избраните ({n})`} confirm={`Да се избришат {n} избрани?\nТие што се користат во документи НЕ се бришат (може „Неактивен“).\n\nОва не може да се врати.`} action={deleteItemsAction} />}
        <div className="tw"><table>
          <thead><tr>{admin && <th style={{ width: 30 }}><SelAll /></th>}<th>Шифра</th><th>Баркод</th><th>Назив</th><th>Вид</th><th>Ед. мерка</th><th className="n">Продажна цена без ДДВ</th><th>ДДВ %</th><th>Конто за приход</th><th className="n">Минимална залиха</th>{auto && <><th className="n">Тежина (кг)</th><th>OE броеви</th><th>Замени</th><th>Возила</th></>}<th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                {admin && <td><SelBox id={r.id} /></td>}
                <td>{r.code}</td><td>{bcOf(r.id).join(', ')}</td><td>{r.name}{r.madeInMk && <> <span className="pill">МК</span></>}</td>
                <td><span className="pill">{TYPES[r.type]}</span></td><td>{r.unit}</td>
                <td className="n"><span className="num">{r.price ? fmt(r.price) : ''}</span></td><td>{r.vatRate}</td><td>{r.revenueAccount}</td>
                <td className="n"><span className="num">{r.minStock ? fmt(r.minStock) : ''}</span></td>
                {auto && <><td className="n">{Number(r.weight) ? fq(r.weight) : ''}</td><td>{r.oe}</td><td>{r.crossRefs}</td><td>{r.fits}</td></>}
                <td style={{ whiteSpace: 'nowrap' }}>
                  {write && <Link className="btn sm" href={`${base}?edit=${r.id}${q ? '&q=' + encodeURIComponent(q) : ''}`}>Измени</Link>}{' '}
                  {(used.get(r.id) ?? 0) > 0 ? <>
                    <Link className="btn sm ghost" href={`${base}?use=${r.id}`} title={`Користен во ${used.get(r.id)} документи – не може да се избрише. Кликнете за да видите каде.`}>🔒 {used.get(r.id)}</Link>{' '}
                    {write && <RowAction action={setItemActive.bind(null, r.id, !r.active)} label={r.active ? 'Неактивен' : 'Активирај'} />}</>
                    : del && <RowAction action={deleteItem.bind(null, r.id)} label="Избриши" confirm={`Да се избрише „${r.name}“?`} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div></>
      ) : <div className="card empty">{q ? `Нема артикл што одговара на „${q}“.` : 'Листата е празна.'}</div>}
      {(total?.n ?? 0) > LIMIT && <p className="note">Прикажани се првите {LIMIT}. Користете пребарување.</p>}
    </>
  );
}
