/**
 * „💲 Ценовник по комитент“ (Helix Cenovnik_po_Komitent, „Доделени рабати“): the customer's own net price per item
 * (`partners.data.prices`), or one rabat % applied to every item; a new invoice line for this customer takes it.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { items, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportBar, type Cell } from '@/components/parity-fin/export-bar';
import { partnerPricesAction } from '../../price-actions';

export default async function PartnerPricesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { u, firm } = await booksPage('partneri');
  if (!firm) return <NoFirm t="Ценовник по комитент" />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [p] = await db().select().from(partners).where(and(eq(partners.id, id), eq(partners.firmId, firm.id))).limit(1);
  if (!p) notFound();
  const write = canDo(u, 'write', firm.id);
  const P = (((p.data ?? {}) as { prices?: Record<string, number> }).prices ?? {});
  const q = (sp.q ?? '').trim().toLowerCase();
  const I = (await db().select({ id: items.id, code: items.code, name: items.name, unit: items.unit, price: items.price }).from(items)
    .where(and(eq(items.firmId, firm.id), eq(items.active, true))).orderBy(asc(items.name)))
    .filter((i) => !q || `${i.code ?? ''} ${i.name}`.toLowerCase().includes(q) || P[i.id] != null);
  const x: Cell[][] = [['Шифра', 'Артикл', 'Ед.', 'Основна цена', 'Цена за купувачот', 'Рабат %'],
    ...I.filter((i) => P[i.id] != null).map((i) => { const b = Number(i.price ?? 0), c = P[i.id]!; return [i.code ?? '', i.name, i.unit ?? '', b, c, b ? Math.round((1 - c / b) * 10000) / 100 : ''] as Cell[]; })];
  return (
    <>
      <Hd t="Ценовник по комитент" sub={p.name}>
        <Link className="btn" href="/partneri">← Комитенти</Link>
        <ExportBar name={`Cenovnik_${p.name}`} title={`Ценовник за ${p.name}`} rows={x} pdf={false} />
      </Hd>
      <form className="row" style={{ gap: 8, marginBottom: 8 }}><input name="q" defaultValue={sp.q ?? ''} placeholder="🔍 Барај артикл…" style={{ flex: 1 }} /><button className="btn">Барај</button></form>
      <ActionForm action={partnerPricesAction} className="card">
        <input type="hidden" name="partner" value={p.id} />
        {write && <div className="row" style={{ gap: 8, alignItems: 'end', marginBottom: 8 }}>
          <label className="f">Рабат % за сите прикажани артикли<input name="rabatAll" type="number" step="any" style={{ width: 100 }} /></label>
          <span className="mini mut">(празно = цените подолу; цена 0 или празна = основната цена)</span>
        </div>}
        <div className="tw"><table className="dense">
          <thead><tr><th>Шифра</th><th>Артикл</th><th>Ед.</th><th className="n">Основна цена</th><th className="n">Цена за купувачот (без ДДВ)</th></tr></thead>
          <tbody>{I.map((i) => (
            <tr key={i.id}><td>{i.code}</td><td>{i.name}</td><td>{i.unit}</td><td className="n">{fmt(Number(i.price ?? 0))}</td>
              <td className="n"><input type="hidden" name="item" value={i.id} /><input name="price" type="number" step="any" defaultValue={P[i.id] ?? ''} disabled={!write} style={{ width: 120, textAlign: 'right' }} /></td></tr>
          ))}</tbody>
        </table></div>
        {write && <button className="btn pri">Зачувај цени</button>}
        <p className="note">Кога ќе го изберете купувачот во излезна фактура, артиклот ја добива неговата цена. Артиклите без внесена цена ја задржуваат основната.</p>
      </ActionForm>
    </>
  );
}
