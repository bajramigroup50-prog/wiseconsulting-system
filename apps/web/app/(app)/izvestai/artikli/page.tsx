/**
 * „Продадени и набавени артикли“ (📊 Извештаи; Helix „Продадени производи и услуги …“, „Набавени …“, „Споредба
 * набавени и продадени“): quantity and value without VAT per item – or per customer / supplier and item – for a period.
 * Sales = posted invoice lines (credit notes subtract), purchases = stock lines of the purchase invoices; in denars.
 */
import Link from 'next/link';
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { invoiceLines, invoices, partners, purchases, purchaseStockLines } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportBar, type Cell } from '@/components/parity-fin/export-bar';

export const metadata = { title: 'Продадени и набавени артикли' };

type Row = { code: string; name: string; unit: string; partner: string; qty: number; val: number; docs: number };
const r2 = (v: number) => Math.round(v * 100) / 100;

export default async function ArtikliPage({ searchParams }: { searchParams: Promise<{ t?: string; by?: string; from?: string; to?: string; q?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('izvestai');
  if (!firm) return <NoFirm t="Продадени и набавени артикли" />;
  const t = sp.t === 'p' ? 'p' : sp.t === 'c' ? 'c' : 's';
  const byP = sp.by === 'p';
  const from = isDate(sp.from) ? sp.from : `${year}-01-01`, to = isDate(sp.to) ? sp.to : `${year}-12-31`;
  const q = (sp.q ?? '').trim().toLowerCase();

  const sales = async (): Promise<Row[]> => {
    const sign = sql`case when ${invoices.kind} = 'credit' then -1 else 1 end`;
    const R = await db().select({
      code: sql<string>`coalesce(${invoiceLines.code}, '')`, name: invoiceLines.name, unit: sql<string>`coalesce(${invoiceLines.unit}, '')`,
      partner: byP ? sql<string>`coalesce(${partners.name}, '')` : sql<string>`''`,
      qty: sql<string>`sum(${sign} * ${invoiceLines.qty})`,
      val: sql<string>`sum(${sign} * ${invoiceLines.qty} * ${invoiceLines.price} * (1 - ${invoiceLines.disc} / 100) * ${invoices.fx})`,
      docs: sql<string>`count(distinct ${invoices.id})`,
    }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).leftJoin(partners, eq(partners.id, invoices.partnerId))
      .where(and(eq(invoices.firmId, firm.id), sql`${invoices.kind} in ('invoice', 'credit')`, ne(invoices.status, 'draft'), gte(invoices.date, from), lte(invoices.date, to)))
      .groupBy(sql`1, 2, 3, 4`);
    return R.map((r) => ({ ...r, qty: +r.qty, val: r2(+r.val), docs: +r.docs }));
  };
  const purch = async (): Promise<Row[]> => {
    const R = await db().select({
      code: sql<string>`coalesce(${purchaseStockLines.code}, '')`, name: sql<string>`coalesce(${purchaseStockLines.name}, '')`, unit: sql<string>`''`,
      partner: byP ? sql<string>`coalesce(${partners.name}, ${purchases.supplierName}, '')` : sql<string>`''`,
      qty: sql<string>`sum(${purchaseStockLines.qty})`,
      val: sql<string>`sum(coalesce(${purchaseStockLines.amount}, ${purchaseStockLines.qty} * ${purchaseStockLines.price} * ${purchases.fx}))`,
      docs: sql<string>`count(distinct ${purchases.id})`,
    }).from(purchaseStockLines).innerJoin(purchases, eq(purchases.id, purchaseStockLines.purchaseId)).leftJoin(partners, eq(partners.id, purchases.partnerId))
      .where(and(eq(purchases.firmId, firm.id), ne(purchases.status, 'draft'), gte(purchases.date, from), lte(purchases.date, to)))
      .groupBy(sql`1, 2, 3, 4`);
    return R.map((r) => ({ ...r, qty: +r.qty, val: r2(+r.val), docs: +r.docs }));
  };

  const match = (r: { code: string; name: string; partner?: string }) => !q || `${r.code} ${r.name} ${r.partner ?? ''}`.toLowerCase().includes(q);
  const link = (o: Record<string, string>) => '/izvestai/artikli?' + new URLSearchParams({ t, by: byP ? 'p' : 'i', from, to, ...(q ? { q } : {}), ...o }).toString();
  const per = `${dmy(from)} – ${dmy(to)}`;

  /* columns: [title, kind] – kind q = quantity, v = value (summed), p = price, n = count */
  let cols: [string, '' | 'q' | 'v' | 'p' | 'n'][], body: Cell[][], title: string;
  if (t === 'c') {
    const [S, P] = await Promise.all([sales(), purch()]);
    const M = new Map<string, { code: string; name: string; pq: number; pv: number; sq: number; sv: number }>();
    const get = (r: Row) => { const k = (r.code || r.name).toLowerCase(); return M.get(k) ?? M.set(k, { code: r.code, name: r.name, pq: 0, pv: 0, sq: 0, sv: 0 }).get(k)!; };
    for (const r of P) { const m = get(r); m.pq += r.qty; m.pv += r.val; }
    for (const r of S) { const m = get(r); m.sq += r.qty; m.sv += r.val; }
    const L = [...M.values()].filter((m) => match(m)).sort((a, b) => b.sv - a.sv || a.name.localeCompare(b.name, 'mk'));
    title = 'Споредба – набавени и продадени';
    cols = [['Шифра', ''], ['Артикл', ''], ['Набавено кол.', 'q'], ['Набавено вредност', 'v'], ['Продадено кол.', 'q'], ['Продадено вредност', 'v'], ['Разлика кол.', 'q'], ['Разлика вредност', 'v']];
    body = L.map((m) => [m.code, m.name, m.pq, r2(m.pv), m.sq, r2(m.sv), Math.round((m.pq - m.sq) * 1000) / 1000, r2(m.sv - m.pv)]);
  } else {
    const L = (t === 's' ? await sales() : await purch()).filter(match).sort((a, b) => (byP ? a.partner.localeCompare(b.partner, 'mk') : 0) || b.val - a.val);
    title = t === 's' ? 'Продадени артикли и услуги' : 'Набавени артикли';
    cols = [...(byP ? [[t === 's' ? 'Купувач' : 'Добавувач', ''] as [string, '']] : []), ['Шифра', ''], ['Артикл', ''], ['Ед.', ''], ['Количина', 'q'], ['Вредност без ДДВ', 'v'], ['Просечна цена', 'p'], ['Документи', 'n']];
    body = L.map((r) => [...(byP ? [r.partner] : []), r.code, r.name, r.unit, r.qty, r.val, r.qty ? r2(r.val / r.qty) : 0, r.docs]);
  }
  const head = cols.map((c) => c[0]);
  const tot = cols.map((c, i) => (c[1] === 'v' ? r2(body.reduce((a, r) => a + (+(r[i] as number) || 0), 0)) : null));
  const cell = (v: Cell, k: string) => (typeof v !== 'number' ? v : k === 'q' ? fq(v) : k === 'n' ? v : fmt(v));

  return (
    <>
      <Hd t={title} sub={per} excel={false} />
      <form className="card">
        <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <Link className="btn sm ghost" href="/izvestai">← Сите извештаи</Link>
          {([['s', 'Продадени'], ['p', 'Набавени'], ['c', 'Споредба набавени / продадени']] as const).map(([k, l]) => <Link key={k} className={'btn sm' + (t === k ? ' pri' : '')} href={link({ t: k })}>{l}</Link>)}
          {t !== 'c' && ([['i', 'по артикл'], ['p', t === 's' ? 'по купувач и артикл' : 'по добавувач и артикл']] as const).map(([k, l]) => <Link key={k} className={'btn sm' + ((k === 'p') === byP ? ' pri' : '')} href={link({ by: k })}>{l}</Link>)}
        </div>
        <input type="hidden" name="t" value={t} /><input type="hidden" name="by" value={byP ? 'p' : 'i'} />
        <div className="form">
          <label className="f">Од<input name="from" type="date" defaultValue={from} /></label>
          <label className="f">До<input name="to" type="date" defaultValue={to} /></label>
          <label className="f">Барај (артикл, шифра, комитент)<input name="q" defaultValue={sp.q ?? ''} /></label>
        </div>
        <button className="btn">Прикажи</button>
      </form>
      {body.length ? (<>
        <div className="row"><ExportBar pdf={false} name={`artikli_${t}_${from}_${to}`} title={`${title} ${per}`} rows={[head, ...body, tot.map((v, i) => (i === 0 ? 'Вкупно' : v ?? ''))]} /></div>
        <div className="tw" id="finArea"><table className="dense">
          <thead><tr>{cols.map(([h, k], i) => <th key={i} className={k ? 'n' : undefined}>{h}</th>)}</tr></thead>
          <tbody>{body.map((r, j) => <tr key={j}>{r.map((v, i) => <td key={i} className={cols[i]![1] ? 'n' : undefined}>{cell(v, cols[i]![1])}</td>)}</tr>)}</tbody>
          <tfoot><tr>{tot.map((v, i) => <td key={i} className={cols[i]![1] ? 'n' : undefined}>{i === 0 ? 'Вкупно' : v == null ? '' : fmt(v)}</td>)}</tr></tfoot>
        </table></div>
      </>) : <div className="card empty">Нема {t === 'p' ? 'набавки на артикли' : 'продажба'} за {per}.</div>}
    </>
  );
}
