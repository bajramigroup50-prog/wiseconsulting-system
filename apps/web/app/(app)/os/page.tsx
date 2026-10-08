/**
 * Legacy `VIEWS.os` 5850 — Основни средства › Регистар и амортизација: register with search (inventory no. /
 * barcode / name), editor, depreciation of the year (`depFor`) and the `runDep` posting (`dep-<Y>`).
 * FIX(P8 #9): depreciation is booked per asset group (not everything on 0190), presets use the chart's own groups,
 * `vehicleOnly` records are not depreciated and a disposal date stops depreciation.
 * Gaps: photos / attached documents, QR labels and vehicle expiry reminders (`osExpList`) are not ported yet.
 */
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { DEP_PRESETS, depAccounts } from '@wise/core';
import { depreciationFor, depreciationRuns, journals, type FixedAsset } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/yearend/action-form';
import { deleteAsset, runDepAction, saveAsset, undoDepAction } from './actions';

type SP = { q?: string; id?: string; new?: string };

function AssetForm({ a }: { a: FixedAsset | null }) {
  const plate = (a?.data as { plate?: string } | undefined)?.plate ?? '';
  return (
    <ActionForm action={saveAsset} submit="Зачувај">
      {a && <input type="hidden" name="id" value={a.id} />}
      <h2>{a ? 'Измена: ' + a.name : 'Ново основно средство'}</h2>
      <div className="form">
        <label className="f">Инвентарен број<input name="invNo" defaultValue={a?.invNo ?? ''} placeholder="автоматски" /></label>
        <label className="f">Назив<input name="name" defaultValue={a?.name ?? ''} required autoFocus /></label>
        <label className="f">Конто (група)
          <input name="konto" list="osPresets" defaultValue={a?.konto ?? '0120'} required />
          <datalist id="osPresets">{DEP_PRESETS.map(([k, n, r]) => <option key={k} value={k}>{n} – {r}%</option>)}</datalist>
        </label>
        <label className="f">Стапка на амортизација %<input name="rate" type="number" step="any" defaultValue={a ? Number(a.rate) : 10} /></label>
        <label className="f">Датум на набавка<input name="date" type="date" defaultValue={a?.date ?? ''} required /></label>
        <label className="f">Набавна вредност<input name="cost" type="number" step="0.01" defaultValue={a ? Number(a.cost) : ''} required /></label>
        <label className="f">Датум на отпис / продажба<input name="disposed" type="date" defaultValue={a?.disposed ?? ''} /></label>
        <label className="f">Сериски број<input name="serial" defaultValue={a?.serial ?? ''} /></label>
        <label className="f">Баркод<input name="barcode" defaultValue={a?.barcode ?? ''} /></label>
        <label className="f">Добавувач<input name="supplier" defaultValue={a?.supplier ?? ''} /></label>
        <label className="f">Фактура / документ<input name="invDoc" defaultValue={a?.invDoc ?? ''} /></label>
        <label className="f">Локација<input name="location" defaultValue={a?.location ?? ''} /></label>
        <label className="f">Регистарска табла (возила)<input name="plate" defaultValue={plate} /></label>
        <label className="f">Белешка<input name="note" defaultValue={a?.note ?? ''} /></label>
        <label className="chk"><input type="checkbox" name="vehicleOnly" defaultChecked={a?.vehicleOnly ?? false} /> Само евиденција (возило од флота, не е сопствено – не се амортизира)</label>
      </div>
      <p className="note">Амортизацијата почнува од следниот месец по набавката, пропорционално, до набавната вредност. Книжење: {(() => { const d = depAccounts(a?.konto ?? '0120'); return `${d.expense} / ${d.accumulated}`; })()} (според групата на контото).</p>
      <div className="row"><Link className="btn" href="/os">Откажи</Link></div>
    </ActionForm>
  );
}

export default async function OsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('os');
  if (!firm) return <NoFirm t="Основни средства" />;
  const [d, [run], [dep]] = await Promise.all([
    depreciationFor(db(), firm.id, year),
    db().select().from(depreciationRuns).where(and(eq(depreciationRuns.firmId, firm.id), eq(depreciationRuns.year, year))).limit(1),
    db().select({ number: journals.number }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'depreciation'), eq(journals.sourceId, `dep-${year}`))).limit(1),
  ]);
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const editing = sp.id ? d.assets.find((a) => a.id === sp.id) ?? null : null;
  const by = new Map(d.rows.map((r) => [r.id, r]));
  const q = (sp.q ?? '').trim().toLowerCase();
  const A = q ? d.assets.filter((a) => [a.invNo, a.barcode, a.serial, a.name, (a.data as { plate?: string }).plate].some((x) => String(x ?? '').toLowerCase().includes(q))) : d.assets;
  const postedTotal = run ? Number(run.total) : 0;
  return (
    <>
      <Hd t="Основни средства" sub={`регистар и амортизација ${year}`}>
        {write && <Link className="btn" href="/os?new=1">+ Ново средство</Link>}
        <Link className="btn" href="/pecati/os" target="_blank">🖨 Регистар</Link>
        {write && d.total > 0 && <RowAction className="btn pri" action={runDepAction} label={dep ? 'Пресметај амортизација повторно' : `Пресметај амортизација ${year}`}
          confirm={`Да се прокнижи амортизацијата за ${year}: ${fmt(d.total)} ден. на 31.12.${year}?`} />}
        {del && dep && <RowAction className="btn danger" action={undoDepAction} label="🗑 Налог за амортизација" confirm={`Да се избрише налогот за амортизација ${dep.number}?`} />}
      </Hd>
      {(sp.new === '1' || editing) && write && <AssetForm key={editing?.id ?? 'new'} a={editing} />}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <form className="row" style={{ gap: 8 }}><input name="q" defaultValue={sp.q ?? ''} placeholder="Инв. број, баркод, назив…" /><button className="btn">Барај</button></form>
          <div>
            Амортизација {year}: <b>{fmt(d.total)}</b> ден.
            {dep ? <> · прокнижена (налог <Link href={`/nalozi?n=${encodeURIComponent(dep.number)}`}>{dep.number}</Link>){Math.abs(postedTotal - d.total) >= 0.01 && <span className="pill warn"> регистарот е менуван – пресметајте повторно</span>}</> : d.total > 0 ? <span className="pill warn"> не е прокнижена</span> : null}
          </div>
        </div>
      </div>
      {A.length ? (
        <div className="tw"><table>
          <thead><tr><th>Инв. бр.</th><th>Назив</th><th>Конто</th><th>Набавено</th><th className="n">Стапка</th><th className="n">Набавна вредност</th><th className="n">Амортизација {year}</th><th className="n">Отпис вкупно</th><th className="n">Сегашна вредност</th><th /></tr></thead>
          <tbody>{A.map((a) => {
            const r = by.get(a.id);
            return (
              <tr key={a.id}>
                <td>{a.invNo}</td>
                <td>{a.name}{a.vehicleOnly && <span className="pill"> само евиденција</span>}{a.disposed && <span className="pill warn"> отпишано {dmy(a.disposed)}</span>}</td>
                <td>{a.konto}</td><td>{dmy(a.date)}</td><td className="n">{Number(a.rate)}%</td><td className="n">{fmt(a.cost)}</td>
                <td className="n">{fmt(r?.year ?? 0)}</td><td className="n">{fmt(r?.acc ?? 0)}</td><td className="n">{fmt(Number(a.cost) - (r?.acc ?? 0))}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {write && <Link className="btn sm ghost" href={`/os?id=${a.id}`}>✎</Link>}
                  {del && <RowAction action={deleteAsset.bind(null, a.id)} label="🗑" confirm={`Да се избрише „${a.name}“?`} />}
                </td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(A.reduce((s, a) => s + Number(a.cost), 0))}</td><td className="n">{fmt(A.reduce((s, a) => s + (by.get(a.id)?.year ?? 0), 0))}</td><td className="n">{fmt(A.reduce((s, a) => s + (by.get(a.id)?.acc ?? 0), 0))}</td><td /><td /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">{q ? 'Нема средства за пребарувањето.' : 'Нема внесени основни средства.'}</div>}
    </>
  );
}
