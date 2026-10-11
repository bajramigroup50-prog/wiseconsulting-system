/**
 * Transfer prints — legacy `PR_ACT.prPdf` (ПРЕНОСНИЦА бр. N: Од / Во, Р.б., Шифра, Назив, Ем, Количина, Набавна цена,
 * Набавна вредност, МПЦ со ДДВ, Продажна вредност; Издал / Примил / Одговорно лице) and `prPlt` (`?t=plt`: the store's
 * ПРИЕМЕН ЛИСТ on `prPseudo` — art. 32, no input VAT).
 */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { calculationRows, type PurchaseLike } from '@wise/core';
import { loadStockContext, transfers } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { FirmHead, Sig } from '../../firm-head';
import { printGuard } from '../../guard';

const r2 = (x: number) => Math.round(x * 100) / 100;

export default async function PrintPrenos({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const plt = (await searchParams).t === 'plt';
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { firm } = await printGuard('prenosi');
  const [d] = await db().select().from(transfers).where(and(eq(transfers.id, id), eq(transfers.firmId, firm.id))).limit(1);
  if (!d) notFound();
  const L = await loadStockContext(db(), firm.id);
  const from = L.locName(d.fromLocationId), to = L.locName(d.toLocationId);
  const P: PurchaseLike = { wh: d.toLocationId ?? 'main', art32: true, stock: d.lines.map((l) => ({ item: l.itemId, qty: l.qty, price: l.nabU ?? 0, sp: l.sp ?? '' })) };
  const R = calculationRows(L.ctx, P);
  const T = (k: 'nabV' | 'spV' | 'vat' | 'marg') => r2(R.reduce((a, r) => a + r[k], 0));
  if (plt) {
    return (
      <div className="pdfdoc land printarea">
        <FirmHead firm={firm} title={`ПРИЕМЕН ЛИСТ (ПЛТ) бр. ${d.number}`} sub={`${to} · ${dmy(d.date)}`} />
        <div className="grid2"><div className="box"><b>Добавувач:</b> Пренос од {from}<br /><b>Документ:</b> Преносница {d.number} од {dmy(d.date)}</div>
          <div className="box"><b>Датум на прием:</b> {dmy(d.date)}<br /><b>Објект:</b> {to}</div></div>
        <table className="plt"><thead>
          <tr><th rowSpan={2} /><th rowSpan={2}>Назив на производ</th><th rowSpan={2}>Е.м.</th><th rowSpan={2} className="n">Количина</th><th colSpan={2} style={{ textAlign: 'center' }}>Набавна вредност на стоките</th><th rowSpan={2} className="n">ДДВ при набавка</th><th style={{ textAlign: 'center' }}>Стапка на ДДВ</th><th colSpan={2} style={{ textAlign: 'center' }}>Продажна вредност на стоките</th><th style={{ textAlign: 'center' }}>Вкупен ДДВ</th></tr>
          <tr><th className="n">Цена</th><th className="n">Износ (4x5)</th><th style={{ textAlign: 'center' }}>Пропишана</th><th className="n">Цена</th><th className="n">Износ (4x9)</th><th style={{ textAlign: 'center' }}>во продажна вредност</th></tr>
          <tr>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => <th key={n} style={{ textAlign: 'center' }}>{n}</th>)}</tr></thead>
          <tbody>{R.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td>{r.unit}</td><td className="n">{r.qty.toFixed(3)}</td><td className="n">{fmt(r.nabU)}</td><td className="n">{fmt(r.nabV)}</td><td className="n">{fmt(0)}</td><td className="n">{r.rate.toFixed(3)}</td><td className="n">{fmt(r.sp)}</td><td className="n">{fmt(r.spV)}</td><td className="n">{fmt(r.vat)}</td></tr>)}
            <tr className="tot"><td colSpan={5}>Вкупно</td><td className="n">{fmt(T('nabV'))}</td><td className="n">{fmt(0)}</td><td /><td /><td className="n">{fmt(T('spV'))}</td><td className="n">{fmt(T('vat'))}</td></tr></tbody></table>
        <table style={{ width: '55%', marginLeft: 'auto' }}><tbody><tr><td>Набавна вредност</td><td className="n">{fmt(T('nabV'))}</td></tr><tr><td>Разлика во цена</td><td className="n">{fmt(T('marg'))}</td></tr><tr><td>Пресметан ДДВ во продажна вредност</td><td className="n">{fmt(T('vat'))}</td></tr><tr className="tot"><td>Продажна вредност со ДДВ</td><td className="n">{fmt(T('spV'))}</td></tr></tbody></table>
        <Sig who={['Предал', 'Примил', 'Одговорно лице']} />
      </div>
    );
  }
  return (
    <div className="pdfdoc land printarea">
      <div className="noprint row" style={{ justifyContent: 'center', paddingTop: 6 }}><a className="btn" href={`/print/prenos/${id}?t=plt`}>Приемен лист (ПЛТ)</a></div>
      <FirmHead firm={firm} title={`ПРЕНОСНИЦА бр. ${d.number}`} sub={dmy(d.date)} />
      <div className="grid2"><div className="box"><b>Од објект:</b> {from}</div><div className="box"><b>Во објект:</b> {to}</div></div>
      <table><thead><tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>Ем</th><th className="n">Количина</th><th className="n">Набавна цена</th><th className="n">Набавна вредност</th><th className="n">МПЦ со ДДВ</th><th className="n">Продажна вредност</th></tr></thead>
        <tbody>{R.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.code}</td><td>{r.name}</td><td>{r.unit}</td><td className="n">{fq(r.qty)}</td><td className="n">{r.nabU.toFixed(4).replace('.', ',')}</td><td className="n">{fmt(r.nabV)}</td><td className="n">{fmt(r.sp)}</td><td className="n">{fmt(r.spV)}</td></tr>)}
          <tr className="tot"><td colSpan={6}>Вкупно</td><td className="n">{fmt(T('nabV'))}</td><td /><td className="n">{fmt(T('spV'))}</td></tr></tbody></table>
      {d.note && <p>{d.note}</p>}
      <Sig who={['Издал', 'Примил', 'Одговорно лице']} />
    </div>
  );
}
