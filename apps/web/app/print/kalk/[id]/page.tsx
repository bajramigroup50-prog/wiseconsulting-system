/**
 * Purchase calculation prints — legacy `calcPdfHTML` (ПРЕГЛЕД НА ВЛЕЗНА КАЛКУЛАЦИЈА) and `pltPdfHTML` (ПРИЕМЕН ЛИСТ),
 * 4401–4419, on `@wise/core` `calculationRows` (`?t=plt` for the ПЛТ).
 */
import { notFound } from 'next/navigation';
import { asc, eq, inArray } from 'drizzle-orm';
import { calculationRows, costsOf, firmAllowed, type PurchaseLike } from '@wise/core';
import { codes, firms, items, partners, purchaseCosts, purchases, purchaseStockLines, toStockItem } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { PrintBar } from '@/components/sales/print-button';

const r2 = (x: number) => Math.round(x * 100) / 100;

export default async function PrintKalk({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const plt = (await searchParams).t === 'plt';
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [p] = await db().select().from(purchases).where(eq(purchases.id, id)).limit(1);
  if (!p || !firmAllowed(u.principal, p.firmId)) notFound();
  const [[f], ST, C, sup, loc] = await Promise.all([
    db().select().from(firms).where(eq(firms.id, p.firmId)).limit(1),
    db().select().from(purchaseStockLines).where(eq(purchaseStockLines.purchaseId, id)).orderBy(asc(purchaseStockLines.lineNo)),
    db().select({ c: purchaseCosts, pn: partners.name }).from(purchaseCosts).leftJoin(partners, eq(partners.id, purchaseCosts.partnerId)).where(eq(purchaseCosts.purchaseId, id)),
    p.partnerId ? db().select().from(partners).where(eq(partners.id, p.partnerId)).limit(1) : Promise.resolve([]),
    p.warehouseId ? db().select().from(codes).where(eq(codes.id, p.warehouseId)).limit(1) : Promise.resolve([]),
  ]);
  if (!f) notFound();
  const I = ST.length ? await db().select().from(items).where(inArray(items.id, ST.map((s) => s.itemId))) : [];
  const costs: PurchaseLike['costs'] = Object.fromEntries(C.map(({ c }) => [c.slot, { amt: Number(c.amount), fx: c.fx ?? undefined, byQty: c.byQty, doc: c.doc ?? '', lines: c.lines }]));
  const P: PurchaseLike = {
    imp: p.imp, fx: Number(p.fx), wh: p.warehouseId ?? 'main', costs, cnames: p.cnames, distMode: p.distMode, art32: p.art32,
    stock: ST.map((s) => ({ item: s.itemId, name: s.name ?? '', qty: Number(s.qty), price: Number(s.price), rab: Number(s.rab), cn: s.cn ?? '', dep: s.dep ?? '', sp: s.sp ?? '' })),
  };
  const R = calculationRows({ items: I.map(toStockItem) }, P);
  const T = (k: keyof (typeof R)[number]) => r2(R.reduce((a, r) => a + Number(r[k]), 0));
  const locName = loc[0]?.name ?? 'Главен магацин';
  const head = (t: string) => <>
    <div className="ph"><div><div className="pt">{t} бр. {p.calcNo || p.number}</div><div className="ps">{locName} · {dmy(p.date)}</div></div><div className="pm">{f.name}<br />ЕДБ {f.edb}</div></div>
    <div className="grid2"><div className="box"><b>Добавувач:</b> {sup[0]?.name ?? p.supplierName}<br /><b>Фактура:</b> {p.number} од {dmy(p.docDate || p.date)}{p.imp && <><br /><b>ЕЦД:</b> {(p.data as Record<string, string>).ecd ?? ''} · <b>Курс:</b> {Number(p.fx)} {p.currency}</>}</div>
      <div className="box"><b>Датум на прием:</b> {dmy(p.date)}<br /><b>Објект:</b> {locName}{p.due && <><br /><b>Валута:</b> {dmy(p.due)}</>}</div></div></>;
  const sig = (w: string[]) => <div className="sig">{w.map((x) => <span key={x}>{x}</span>)}</div>;
  if (plt) {
    const R2 = R.map((r) => ({ ...r, inVat: p.imp ? r.cvat : p.art32 || !f.vatRegistered ? 0 : r2((r.v * r.rate) / 100) }));
    return <><PrintBar /><div className="pdfdoc printarea land">{head('ПРИЕМЕН ЛИСТ (ПЛТ)')}
      <table className="plt"><thead>
        <tr><th rowSpan={2} /><th rowSpan={2}>Назив на производ</th><th rowSpan={2}>Е.м.</th><th rowSpan={2} className="n">Количина</th><th colSpan={2} style={{ textAlign: 'center' }}>Набавна вредност на стоките</th><th rowSpan={2} className="n">ДДВ при набавка</th><th style={{ textAlign: 'center' }}>Стапка на ДДВ</th><th colSpan={2} style={{ textAlign: 'center' }}>Продажна вредност на стоките</th><th style={{ textAlign: 'center' }}>Вкупен ДДВ</th></tr>
        <tr><th className="n">Цена</th><th className="n">Износ (4x5)</th><th style={{ textAlign: 'center' }}>Пропишана</th><th className="n">Цена</th><th className="n">Износ (4x9)</th><th style={{ textAlign: 'center' }}>во продажна вредност</th></tr>
        <tr>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => <th key={n} style={{ textAlign: 'center' }}>{n}</th>)}</tr></thead>
        <tbody>{R2.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td>{r.unit}</td><td className="n">{r.qty.toFixed(3)}</td><td className="n">{fmt(r.nabU)}</td><td className="n">{fmt(r.nabV)}</td><td className="n">{fmt(r.inVat)}</td><td className="n">{r.rate.toFixed(3)}</td><td className="n">{fmt(r.sp)}</td><td className="n">{fmt(r.spV)}</td><td className="n">{fmt(r.vat)}</td></tr>)}
          <tr className="tot"><td colSpan={5}>Вкупно</td><td className="n">{fmt(T('nabV'))}</td><td className="n">{fmt(r2(R2.reduce((a, r) => a + r.inVat, 0)))}</td><td /><td /><td className="n">{fmt(T('spV'))}</td><td className="n">{fmt(T('vat'))}</td></tr></tbody></table>
      <table style={{ width: '55%', marginLeft: 'auto' }}><tbody><tr><td>Набавна вредност</td><td className="n">{fmt(T('nabV'))}</td></tr><tr><td>Разлика во цена</td><td className="n">{fmt(T('marg'))}</td></tr><tr><td>Пресметан ДДВ во продажна вредност</td><td className="n">{fmt(T('vat'))}</td></tr><tr className="tot"><td>Продажна вредност со ДДВ</td><td className="n">{fmt(T('spV'))}</td></tr></tbody></table>
      {sig(['Предал', 'Примил', 'Одговорно лице'])}</div></>;
  }
  const cs = costsOf(P);
  return <><PrintBar><a className="btn" href={`/print/kalk/${id}?t=plt`}>Приемен лист (ПЛТ)</a></PrintBar><div className="pdfdoc printarea land">{head('ПРЕГЛЕД НА ВЛЕЗНА КАЛКУЛАЦИЈА')}
    <table><thead><tr><th rowSpan={2}>Шифра</th><th rowSpan={2}>Назив</th><th rowSpan={2}>Ем</th><th rowSpan={2} className="n">Кол</th><th colSpan={2} className="n">Набавна цена</th><th colSpan={2} className="n">Рабат</th><th rowSpan={2} className="n">Завис. трошоци</th><th rowSpan={2} className="n">Пренесен ДДВ</th><th rowSpan={2} className="n">Тар</th><th colSpan={2} className="n">Цена со ДДВ</th></tr>
      <tr><th className="n">По ед.</th><th className="n">Износ</th><th className="n">%</th><th className="n">Износ</th><th className="n">По ед.</th><th className="n">Износ</th></tr></thead>
      <tbody>{R.map((r, i) => <tr key={i}><td>{r.code}</td><td>{r.name}</td><td>{r.unit}</td><td className="n">{fq(r.qty)}</td><td className="n">{r.nabU.toFixed(4)}</td><td className="n">{fmt(r.nabV)}</td><td className="n">{fmt(r.rab)}</td><td className="n">{fmt(r.rabA)}</td><td className="n">{fmt(r.dep)}</td><td className="n">{fmt(r.cvat)}</td><td className="n">{r.rate}</td><td className="n">{fmt(r.sp)}</td><td className="n">{fmt(r.spV)}</td></tr>)}
        <tr className="tot"><td colSpan={5}>Вкупно</td><td className="n">{fmt(T('nabV'))}</td><td /><td className="n">{fmt(T('rabA'))}</td><td className="n">{fmt(T('dep'))}</td><td className="n">{fmt(T('cvat'))}</td><td /><td /><td className="n">{fmt(T('spV'))}</td></tr></tbody></table>
    {cs.length > 0 && <table style={{ width: '60%' }}><thead><tr><th>Зависен трошок</th><th>Документ</th><th className="n">Износ</th><th className="n">ДДВ</th></tr></thead>
      <tbody>{cs.map((c) => <tr key={c.k}><td>{c.n}</td><td>{String(c.o.doc ?? '')} {C.find((x) => x.c.slot === c.k)?.pn ?? ''}</td><td className="n">{fmt(c.amt)}</td><td className="n">{fmt(c.vat)}</td></tr>)}</tbody></table>}
    <table style={{ width: '60%', marginLeft: 'auto' }}><tbody><tr><td>Фактурна вредност{p.imp && ` (${p.currency} × ${Number(p.fx)})`}</td><td className="n">{fmt(T('gross'))}</td></tr><tr><td>Рабат</td><td className="n">{fmt(T('rabA'))}</td></tr><tr><td>Зависни трошоци</td><td className="n">{fmt(T('dep'))}</td></tr>
      <tr className="tot"><td>Набавна вредност</td><td className="n">{fmt(T('nabV'))}</td></tr><tr><td>Разлика во цена</td><td className="n">{fmt(T('marg'))}</td></tr><tr><td>ДДВ (пресметан во продажна цена)</td><td className="n">{fmt(T('vat'))}</td></tr><tr className="tot"><td>Продажна вредност со ДДВ</td><td className="n">{fmt(T('spV'))}</td></tr></tbody></table>
    {sig(['Калкулирал', 'Одобрил'])}</div></>;
}
