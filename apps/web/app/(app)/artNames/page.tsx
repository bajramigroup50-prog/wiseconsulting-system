/**
 * Називи за артикли само со шифра — legacy `VIEWS.artNames` 17360, `anSave`, `anImp`: items created by an import with
 * only a code (`Артикл <шифра>`) get their names typed in a list or taken from an Excel (Шифра · Назив).
 */
import { and, asc, eq, like } from 'drizzle-orm';
import { Retail } from '@wise/core';
import { items } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/stock-ui';
import { artNamesAction } from '../_retail/actions';
import { NamesImport } from './names-import';

export default async function ArtNamesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('artNames');
  if (!firm) return <NoFirm t="Називи за нови артикли" />;
  const write = canDo(u, 'anSave', firm.id);
  const L = (await db().select({ id: items.id, code: items.code, name: items.name, unit: items.unit }).from(items)
    .where(and(eq(items.firmId, firm.id), like(items.name, 'Артикл %'))).orderBy(asc(items.code))).filter((i) => Retail.isNoNameItem(i));
  const q = (sp.q ?? '').toLowerCase().trim();
  const R = L.filter((i) => !q || String(i.code ?? '').toLowerCase().includes(q));
  return (
    <>
      <Hd t="Називи за нови артикли" sub={`${L.length} артикли се само со шифра`}>{write && <NamesImport />}</Hd>
      <div className="card">
        <p className="note">Овие артикли се креирани при увоз само со шифра. Внесете назив до секоја шифра (може и само дел) и кликнете „Зачувај“ – називот се менува насекаде: калкулации, лагер листа, МЕТГ, фактури. Или изберете Excel со колони <b>Шифра</b> и <b>Назив</b> (на пр. ценовникот / фактурата на добавувачот).</p>
        <form><input name="q" placeholder="Барај шифра…" defaultValue={sp.q ?? ''} style={{ width: 240 }} /></form>
      </div>
      {R.length ? (
        <ActionForm action={artNamesAction} className="">
          <div className="tw"><table>
            <thead><tr><th>Шифра</th><th>Назив</th><th>Ед.</th></tr></thead>
            <tbody>{R.slice(0, 500).map((i) => <tr key={i.id}><td><b>{i.code}</b></td><td><input name={'n_' + i.id} placeholder="внеси назив…" style={{ width: '100%', minWidth: 320 }} disabled={!write} /></td><td>{i.unit}</td></tr>)}</tbody>
          </table></div>
          {R.length > 500 && <p className="note">Прикажани се првите 500 – барајте по шифра за останатите.</p>}
          {write && <div className="row" style={{ marginTop: 8 }}><button className="btn pri">Зачувај ги називите</button></div>}
        </ActionForm>
      ) : <div className="card empty">Сите артикли имаат назив. ✓</div>}
    </>
  );
}
