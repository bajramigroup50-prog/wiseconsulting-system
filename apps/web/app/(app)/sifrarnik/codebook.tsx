/**
 * One codebook editor — legacy `cbList` 6966 (`VIEWS['cb_' + k]` 6973): list, „+ Додај“ / „Измени“ form, 🗑 with
 * the usage check, plus the per-codebook extras (city seed, payroll codes table, currency / vehicle / price-list notes).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, PCAT, psifCodes } from '@wise/core';
import { CB, cbIsGlobal, cbPerm, cbVal, type CbKey, type CbRow } from '@wise/core/codebooks';
import { listCodebook } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { dmy, fq } from '@/lib/fmt';
import { sysViewAllowed } from '@/lib/nav-system';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteCodeAction, saveCodeAction, seedCitiesAction, seedPaySifAction } from './actions';
import { ImportButton, type ImpField } from '@/components/doc-tools';
import { importCodebookAction } from '../_stock/parity-actions';

export interface CbSearch { nov?: string; edit?: string }

export async function CodebookPage({ k, searchParams }: { k: CbKey; searchParams: Promise<CbSearch> }) {
  const sp = await searchParams;
  const u = await requireUser();
  if (!sysViewAllowed(u.role, `cb_${k}`)) notFound();
  const D = CB[k];
  const global = cbIsGlobal(k);
  const firm = global ? null : await currentFirm(u);
  if (!global && !firm) return <NoFirm t={D.t} />;
  const rows = await listCodebook(db(), k, firm?.id ?? null);
  const canRow = (r: { global: boolean }) => can(u.principal, cbPerm(k, r.global), r.global ? null : firm?.id);
  const canNew = can(u.principal, cbPerm(k, global), firm?.id ?? null);
  const canDel = (r: CbRow) => canRow(r) && can(u.principal, 'del', r.global ? null : firm?.id);
  const editRow = sp.edit ? rows.find((r) => r.id === sp.edit && canRow(r)) : undefined;
  const draft = editRow ?? (sp.nov !== undefined && canNew ? { id: '', code: null, name: '', global, data: {} } : null);
  const own = rows.filter((r) => !r.global);
  const href = `/cb_${k}`;

  const cell = (r: CbRow, f: string, type?: string) => {
    const v = cbVal(r, f);
    if (type === 'num') return <span className="num">{v !== '' && v != null ? fq(Number(v)) : ''}</span>;
    if (type === 'date') return v ? dmy(String(v)) : '';
    return String(v ?? '');
  };

  return (
    <>
      <Hd t={D.t} sub={global ? 'шифрарник · заеднички за сите фирми' : 'шифрарник'}>
        {k === 'cenovnik' && <a className="btn" href="/print/cenovnik" target="_blank" rel="noopener">PDF ценовник</a>}
        <Link className="btn" href="/sifrarnik">← Шифрарник</Link>
        {canNew && <ImportButton action={importCodebookAction.bind(null, k)} fields={impFields(k)} name={`Sifrarnik_${k}`} confirmText={(n, f) => `Да се увезат ${n} редови од „${f}“ во „${D.t}“? Иста шифра = измена.`} />}
        {canNew && <Link className="btn pri" href={`${href}?nov`}>+ Додај</Link>}
      </Hd>

      {k === 'paysif' && <PaySifInfo rows={rows} seed={canNew && !own.length} />}
      {k === 'city' && !rows.length && canNew && (
        <div className="row"><RowAction action={seedCitiesAction} label="Внеси ги градовите во Македонија" className="btn pri" /></div>
      )}
      {k === 'currency' && <p className="note">Курсот од овој шифрарник се користи за девизните изводи кога курсот не е внесен на самиот извод. Заедничките валути (од <Link href="/kursna">курсната листа</Link>) важат за сите фирми; валута внесена тука важи само за оваа фирма.</p>}
      {k === 'vehicle' && <p className="note">Возилата се нудат при внес на фактура / испратница (превоз и товарен лист).</p>}
      {k === 'cenovnik' && <p className="note">„PDF ценовник“ ги печати сите артикли со продажна цена, ДДВ и цена со ДДВ, со рабатот од избраниот ценовник.</p>}

      {draft && (
        <ActionForm action={saveCodeAction.bind(null, k)} reset={false}>
          <input type="hidden" name="id" value={draft.id} />
          <div className="form">
            {D.f.map(([f, label, type]) => {
              const v = cbVal(draft, f);
              return (
                <label className="f" key={f}>{label}
                  <input name={f} type={type === 'date' ? 'date' : 'text'} inputMode={type === 'num' ? 'decimal' : undefined}
                    defaultValue={v == null ? '' : String(v)} autoFocus={f === 'code'} />
                </label>
              );
            })}
          </div>
          <div className="row">
            {draft.id && canDel(draft) && <RowAction action={deleteCodeAction.bind(null, k, draft.id)} label="Избриши" className="btn danger" confirm="Да се избрише записот од шифрарникот?" />}
            <Link className="btn" href={href}>Откажи</Link>
            <button className="btn pri">Зачувај</button>
          </div>
        </ActionForm>
      )}

      {rows.length ? (
        <div className="tw"><table>
          <thead><tr>{D.f.map(([f, l]) => <th key={f}>{l}</th>)}<th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              {D.f.map(([f, , type]) => <td key={f}>{cell(r, f, type)}</td>)}
              <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                {!global && r.global && <span className="pill" title="Заеднички запис за сите фирми">заеднички</span>}
                {canRow(r) && <Link className="btn sm" href={`${href}?edit=${r.id}`}>Измени</Link>}
                {canDel(r) && <RowAction action={deleteCodeAction.bind(null, k, r.id)} label="🗑" title="Избриши" className="btn sm ghost danger"
                  confirm={`Да се избрише „${[r.code, r.name].filter(Boolean).join(' ')}“ од „${D.t}“?`} />}
                {k === 'cenovnik' && <a className="btn sm" href={`/print/cenovnik?id=${r.id}`} target="_blank" rel="noopener">PDF</a>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : (!draft && <div className="card empty">Шифрарникот е празен. Додадете со „+ Додај“.</div>)}
    </>
  );
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Import columns of a codebook: header = the field label (first word) or the field key. */
function impFields(k: CbKey): ImpField[] {
  return CB[k].f.map(([f, l, type]) => ({ key: f, label: l, re: `^(${esc(l.toLowerCase().split(/[ (]/)[0]!)}|${f.toLowerCase()})`, num: type === 'num', req: f === 'name' }));
}

/** Legacy `paySifInfo` 6258: the effective payroll codes (standard `PSIF0` overridden by the firm's rows). */
function PaySifInfo({ rows, seed }: { rows: CbRow[]; seed: boolean }) {
  const L = psifCodes(rows.map((r) => ({ code: r.code ?? '', name: r.name, ...(r.data as Record<string, string>) })));
  const catName = (c: string) => PCAT.find((x) => x[0] === c)?.[1] ?? c;
  return (
    <>
      <div className="card">
        <p className="note" style={{ marginTop: 0 }}>Ова се шифрите што се нудат во „Преглед“ на вработениот → „Нов“ (поле <b>Шифра</b>). Стандардните проценти се според ЗРО, Општиот колективен договор за приватниот сектор (чл. 24) и Законот за здравствено осигурување. Ако вашиот колективен договор дава повеќе (на пр. 40% за прекувремена), додадете ред со <b>иста шифра</b> и нов процент – тој важи наместо стандардниот. Нова шифра = нова ставка.</p>
        {seed && <div className="row" style={{ marginBottom: 8 }}><RowAction action={seedPaySifAction} label="Преземи ги стандардните шифри за измена" className="btn" confirm="Да се внесат стандардните шифри во шифрарникот за да можете да ги менувате?" /></div>}
        <div className="tw"><table className="dense">
          <thead><tr><th>Шифра</th><th>Опис</th><th>Тип</th><th className="n">%</th><th>На товар на</th><th>МПИН</th><th>Законски основ</th></tr></thead>
          <tbody>{L.map((x) => (
            <tr key={x.code}><td><b>{x.code}</b></td><td>{x.name}</td><td>{catName(x.cat)}</td>
              <td className="n">{x.cat === 'kor' || x.cat === 'sin' ? 'износ' : `${x.pct}%`}</td>
              <td>{x.payer === 'ФЗО' ? <span className="pill warn">ФЗО</span> : x.payer}</td><td>{x.mpin}</td><td className="mini">{x.basis}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      {rows.length > 0 && <h3 style={{ margin: '14px 0 6px' }}>Ваши измени / дополнителни шифри</h3>}
    </>
  );
}
