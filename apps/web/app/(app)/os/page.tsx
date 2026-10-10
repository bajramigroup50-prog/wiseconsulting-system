/**
 * Legacy `VIEWS.os` 5850 — Основни средства › Регистар и амортизација: register with search (inventory no. /
 * barcode / serial / plate / name / location; a scanned `OS|code|name` label opens the asset), editor (preset →
 * konto + rate, vehicle block), 👁 view (`osViewHTML`: photos, documents, QR, card PDF, label PDF), labels for all,
 * expiry badges (`osBadge`), Excel export / import, depreciation of the year and the `runDep` posting (`dep-<Y>`).
 * FIX(P8 #9): depreciation is booked per asset group (not everything on 0190), presets use the chart's own groups,
 * `vehicleOnly` records are not depreciated and a disposal date stops depreciation.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { DEP_PRESETS } from '@wise/core';
import { OS_DOCT, OS_VEH, OS_XLSX_HEAD, osCmp, osExpiry, osQrText, osScanCode, type OsDoc } from '@wise/core/yearend/assets-io';
import { depreciationFor, depreciationRuns, effectiveChart, journals, partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { Qr } from '@/components/qr';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { XlsxButton, XlsxImport } from '@/components/vp-tools';
import { ActionForm } from '@/components/yearend/action-form';
import { addAssetFiles, deleteAsset, importAssets, removeAssetFile, runDepAction, undoDepAction } from './actions';
import { AssetForm } from './asset-form';

type SP = { q?: string; id?: string; new?: string; view?: string };
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });

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
  const all = d.assets.slice().sort(osCmp);
  // Legacy 5859: Enter on a scanned label opens the asset.
  const scan = osScanCode(sp.q ?? '');
  if (scan) {
    const hit = all.find((a) => a.barcode === scan || a.invNo === scan || a.id === scan);
    if (hit) redirect(`/os?view=${hit.id}`);
  }
  const editing = sp.id ? all.find((a) => a.id === sp.id) ?? null : null;
  const viewing = sp.view ? all.find((a) => a.id === sp.view) ?? null : null;
  const by = new Map(d.rows.map((r) => [r.id, r]));
  const q = (sp.q ?? '').trim().toLowerCase();
  const DT = (a: (typeof all)[number]) => a.data as Record<string, unknown> & { docs?: OsDoc[]; photos?: string[]; plate?: string };
  const A = q ? all.filter((a) => [a.invNo, a.barcode, a.serial, a.name, a.location, DT(a).plate].some((x) => String(x ?? '').toLowerCase().includes(q))) : all;
  const postedTotal = run ? Number(run.total) : 0;
  const td = today();
  const nextInv = String(Math.max(0, ...all.map((a) => parseInt(a.invNo ?? '') || 0)) + 1).padStart(4, '0');
  const [chart, sups] = (sp.new === '1' || editing) && write ? await Promise.all([
    effectiveChart(db(), firm.id),
    db().select({ name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)),
  ]) : [[], []];
  const kontos = chart.filter((k) => /^01/.test(k.code) && !/^0190/.test(k.code)).map((k) => ({ code: k.code, name: k.name }));
  const xl: (string | number)[][] = [[...OS_XLSX_HEAD, `Амортизација ${year}`, 'Акумулирана', 'Сегашна вредност'],
    ...A.map((a) => { const r = by.get(a.id); return [a.invNo ?? '', a.name, a.serial ?? '', a.barcode ?? '', a.konto, a.date, Number(a.cost), Number(a.rate), a.supplier ?? '', a.invDoc ?? '', a.location ?? '', String(DT(a).plate ?? ''), r?.year ?? 0, r?.acc ?? 0, Number(a.cost) - (r?.acc ?? 0)]; })];
  return (
    <>
      <Hd t="Основни средства" sub={`регистар и амортизација ${year}`}>
        {write && <Link className="btn" href="/os?new=1">+ Ново средство</Link>}
        <Link className="btn" href="/pecati/os" target="_blank">🖨 PDF регистар</Link>
        {all.length > 0 && <Link className="btn" href="/os/etiketi" target="_blank">🏷 Етикети за сите (PDF)</Link>}
        <XlsxButton name={`Osnovni_sredstva_${year}.xlsx`} label="⬇ Excel" sheets={[{ name: 'Основни средства', rows: xl }]} />
        {write && <XlsxImport action={importAssets} template={[[...OS_XLSX_HEAD]]} templateName="Osnovni_sredstva_obrazec.xlsx" confirm={(n) => `Да се увезат ${n} основни средства?`} />}
        {write && d.total > 0 && <RowAction className="btn pri" action={runDepAction} label={dep ? 'Пресметај амортизација повторно' : `Пресметај амортизација ${year}`}
          confirm={`Да се прокнижи амортизацијата за ${year}: ${fmt(d.total)} ден. на 31.12.${year}?`} />}
        {del && dep && <RowAction className="btn danger" action={undoDepAction} label="🗑 Налог за амортизација" confirm={`Да се избрише налогот за амортизација ${dep.number}?`} />}
      </Hd>
      {(sp.new === '1' || editing) && write && (
        <AssetForm key={editing?.id ?? 'new'} a={editing ? { ...editing, cost: String(editing.cost), rate: String(editing.rate), data: editing.data as Record<string, unknown> } : null}
          presets={DEP_PRESETS} kontos={kontos} suppliers={[...new Set(sups.map((s) => s.name))].slice(0, 2000)} nextInv={nextInv} />
      )}
      {viewing && (() => {
        const a = viewing, D = DT(a), r = by.get(a.id);
        const exp = osExpiry(D, D.docs ?? [], td);
        const row = (l: string, v: React.ReactNode) => (v ? <tr><td style={{ width: 230 }}>{l}</td><td><b>{v}</b></td></tr> : null);
        return (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <div className="hd"><h2>{a.invNo} · {a.name}</h2><div className="row">
              {write && <Link className="btn sm" href={`/os?id=${a.id}`}>✎ Измени</Link>}
              <Link className="btn sm" href={`/os/etiketi?id=${a.id}`} target="_blank">🏷 Етикета PDF</Link>
              <Link className="btn sm pri" href={`/os/karton?id=${a.id}`} target="_blank">PDF картон</Link>
              <Link className="btn sm" href="/os">✕</Link>
            </div></div>
            {exp.length > 0 && <div className={`callout ${exp.some((x) => x.bad) ? 'bad' : 'warn'}`}>{exp.map((x) => `${x.what}: ${x.bad ? 'истечено' : 'истекува'} ${dmy(x.date)}`).join(' · ')}</div>}
            {!!D.photos?.length && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{D.photos.map((f) => (
              <span key={f} style={{ position: 'relative' }}><a href={`/api/files/${f}`} target="_blank" rel="noopener"><img src={`/api/files/${f}`} alt="" style={{ width: 210, height: 150, objectFit: 'cover', borderRadius: 6 }} /></a>
                {write && <RowAction className="btn sm ghost" action={removeAssetFile.bind(null, a.id, f)} label="✕" confirm="Да се отстрани сликата?" />}</span>
            ))}</div>}
            <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <table className="dense" style={{ flex: 1, minWidth: 320 }}><tbody>
                {row('Инвентарен број', a.invNo)}{row('Сериски број / шасија', a.serial)}{row('Баркод', a.barcode)}{row('Регистарска таблица', D.plate)}
                {row('Регистрација важи до', D.regExp ? dmy(String(D.regExp)) : '')}{row('Осигурување до', D.insExp ? dmy(String(D.insExp)) : '')}{row('Технички преглед до', D.techExp ? dmy(String(D.techExp)) : '')}
                {row('Конто', a.konto)}{row('Во употреба од', dmy(a.date))}{row('Набавна вредност', fmt(a.cost))}{row('Стапка на амортизација', Number(a.rate) + '%')}
                {row(`Амортизација ${year}`, fmt(r?.year ?? 0))}{row('Акумулирана амортизација', fmt(r?.acc ?? 0))}{row('Сегашна вредност', fmt(Number(a.cost) - (r?.acc ?? 0)))}
                {row('Добавувач', a.supplier)}{row('Фактура за набавка', a.invDoc)}{row('Локација / задолжено лице', a.location)}
                {OS_VEH.filter(([k]) => !['plate', 'regExp', 'insExp', 'techExp'].includes(k) && D[k] != null && D[k] !== '').map(([k, l]) => row(l, String(D[k])))}
              </tbody></table>
              <div style={{ textAlign: 'center' }}><Qr text={osQrText(a)} size="150px" /><div className="mini">скенирајте го QR кодот во полето за пребарување</div></div>
            </div>
            <h2 style={{ fontSize: 15 }}>Документи</h2>
            {(D.docs ?? []).length ? (
              <table className="dense"><thead><tr><th>Вид</th><th>Опис / број</th><th>Важи до</th><th>Датотеки</th><th /></tr></thead>
                <tbody>{(D.docs ?? []).map((x) => <tr key={x.fileId}><td>{x.type}</td><td>{x.title ?? ''}</td><td>{x.validTo ? dmy(x.validTo) : ''}</td><td><a className="btn sm ghost" href={`/api/files/${x.fileId}`} target="_blank" rel="noopener">📎</a></td>
                  <td>{write && <RowAction className="btn sm ghost danger" action={removeAssetFile.bind(null, a.id, x.fileId)} label="🗑" confirm="Да се отстрани документот?" />}</td></tr>)}</tbody></table>
            ) : <p className="note">Нема прикачени документи.</p>}
            {write && (
              <div className="cols">
                <ActionForm action={addAssetFiles} submit="Прикачи документ" className="card">
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="doc" />
                  <div className="form">
                    <label className="f">Вид<select name="type">{OS_DOCT.map((t) => <option key={t}>{t}</option>)}</select></label>
                    <label className="f">Опис / број<input name="title" /></label>
                    <label className="f">Важи до<input name="validTo" type="date" /></label>
                    <UploadField firmId={firm.id} label="📎 PDF / слика" accept="application/pdf,image/*" />
                  </div>
                </ActionForm>
                <ActionForm action={addAssetFiles} submit="Прикачи слики" className="card">
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value="photo" />
                  <UploadField firmId={firm.id} label="📷 Фотографирај / 🖼 Прикачи слики" accept="image/*" capture />
                </ActionForm>
              </div>
            )}
          </div>
        );
      })()}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <form className="row" style={{ gap: 8 }}><input name="q" defaultValue={sp.q ?? ''} placeholder="Инв. број, баркод, сериски, таблица, назив, локација… (или скенирај QR)" style={{ minWidth: 320 }} /><button className="btn">Барај</button></form>
          <div>
            Амортизација {year}: <b>{fmt(d.total)}</b> ден.
            {dep ? <> · прокнижена (налог <Link href={`/nalozi?n=${encodeURIComponent(dep.number)}`}>{dep.number}</Link>){Math.abs(postedTotal - d.total) >= 0.01 && <span className="pill warn"> регистарот е менуван – пресметајте повторно</span>}</> : d.total > 0 ? <span className="pill warn"> не е прокнижена</span> : null}
          </div>
        </div>
      </div>
      {A.length ? (
        <div className="tw"><table>
          <thead><tr><th>Инв. бр.</th><th>Средство</th><th>Сериски / таблица</th><th>Конто</th><th>Датум</th><th className="n">Набавна</th><th className="n">Стапка</th><th className="n">Аморт. {year}</th><th className="n">Акумулирана</th><th className="n">Сегашна</th><th /></tr></thead>
          <tbody>{A.map((a) => {
            const r = by.get(a.id), D = DT(a);
            const exp = osExpiry(D, D.docs ?? [], td);
            const bad = exp.filter((x) => x.bad).length;
            return (
              <tr key={a.id}>
                <td>{a.invNo}</td>
                <td>{(D.veh || D.plate) ? '🚗 ' : ''}{a.name}{a.vehicleOnly && <span className="pill"> само евиденција</span>}{a.disposed && <span className="pill warn"> отпишано {dmy(a.disposed)}</span>}
                  {exp.length > 0 && <> <span className={`pill ${bad ? 'bad' : 'warn'}`} title={exp.map((x) => `${x.what}: ${dmy(x.date)}`).join('\n')}>{bad ? `истечено ${bad}` : `истекува ${exp.length}`}</span></>}
                  {!!D.docs?.length && <span className="mini"> 📎{D.docs.length}</span>}</td>
                <td>{[a.serial, D.plate].filter(Boolean).join(' · ')}</td>
                <td>{a.konto}</td><td>{dmy(a.date)}</td><td className="n">{fmt(a.cost)}</td><td className="n">{Number(a.rate)}%</td>
                <td className="n">{fmt(r?.year ?? 0)}</td><td className="n">{fmt(r?.acc ?? 0)}</td><td className="n">{fmt(Number(a.cost) - (r?.acc ?? 0))}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn sm ghost" href={`/os?view=${a.id}`}>👁 Преглед</Link>
                  {write && <Link className="btn sm ghost" href={`/os?id=${a.id}`}>Измени</Link>}
                  <Link className="btn sm ghost" href={`/os/etiketi?id=${a.id}`} target="_blank" title="Етикета (PDF)">🏷</Link>
                  {del && <RowAction action={deleteAsset.bind(null, a.id)} label="🗑" confirm={`Да се избрише „${a.name}“?`} />}
                </td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(A.reduce((s, a) => s + Number(a.cost), 0))}</td><td /><td className="n">{fmt(A.reduce((s, a) => s + (by.get(a.id)?.year ?? 0), 0))}</td><td className="n">{fmt(A.reduce((s, a) => s + (by.get(a.id)?.acc ?? 0), 0))}</td><td className="n">{fmt(A.reduce((s, a) => s + Number(a.cost) - (by.get(a.id)?.acc ?? 0), 0))}</td><td /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">{q ? 'Нема средства за пребарувањето.' : 'Нема внесени основни средства.'}</div>}
    </>
  );
}
