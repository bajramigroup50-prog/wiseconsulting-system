/**
 * Balance sheet / income statement screen (legacy `zsView` 7662 for zs_bs / zs_bu, `zsTable` 7642, manual amounts
 * `zmBox`/`zmEditTable`/`zmSave` 10945–10952 and the zs_bu/zs_bs wrapper 10971–10972).
 */
import Link from 'next/link';
import { fmt } from '@/lib/fmt';
import { canDo } from '@/lib/books';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { DownloadCsv } from '@/components/download-csv';
import { RowAction } from '@/components/row-action';
import { ActionForm } from './action-form';
import { NotClosedNote, ZsHead } from './ph-bar';
import { clearZsMan, saveZsMan } from '@/app/(app)/zsProc/actions';
import { ZmImport } from './zm-import';

const isFormula = (f: string) => /^[PN]?:?[\d+\-\s]+$/.test(String(f || '').trim()) && !!String(f || '').trim();

export async function StatementPage({ rep, edit }: { rep: 'bs' | 'bu'; edit: boolean }) {
  const view = rep === 'bs' ? 'zs_bs' : 'zs_bu';
  const t = rep === 'bs' ? 'Биланс на состојба' : 'Биланс на успех';
  const c = await yePage(view);
  if (!c) return <NoFirm t={t} />;
  const { L, year } = c;
  const canWrite = canDo(c.u, 'write', c.firm.id);
  const C = L.Y.co.zs;
  const P = L.prev;
  const R = L.rules.filter((x) => x.r === rep);
  const M = L.statement?.zsMan ?? {};
  const manual = R.filter((x) => M[rep + x.aop] != null).length;
  const csv = [['АОП', 'Позиција', `Тековна ${year}`, `Претходна ${year - 1}`], ...R.map((x) => [x.aop, x.n, Math.round(C.V[rep + x.aop] || 0), Math.round(P.V[rep + x.aop] || 0)])];
  const rows = R.map((x) => {
    const k = rep + x.aop;
    const b = !x.k || !!x.f;
    return (
      <tr key={k} className={b && !edit ? 'tot' : ''}>
        <td className="num" style={{ textAlign: 'left' }}>{x.aop}</td>
        <td>{x.n}</td>
        <td className="n">{fmt(Math.round(C.V[k] || 0)).replace(/,00$/, '')}{M[k] != null && !edit && <span className="pill warn" title="рачен износ" style={{ marginLeft: 4 }}>р</span>}</td>
        <td className="n">{fmt(Math.round(P.V[k] || 0)).replace(/,00$/, '')}</td>
        {edit && <td className="n">{isFormula(x.f) ? <span className="mini">формула</span> : <input name={k} type="number" step="1" defaultValue={M[k] ?? ''} style={{ width: 130, textAlign: 'right' }} />}</td>}
      </tr>
    );
  });
  const table = (
    <div className="tw"><table>
      <thead><tr><th style={{ width: 70 }}>АОП</th><th>Позиција</th><th className="n">Тековна {year}</th><th className="n">Претходна {year - 1}</th>{edit && <th className="n" style={{ width: 150 }}>Рачен износ</th>}</tr></thead>
      <tbody>{rows}</tbody>
    </table></div>
  );
  return (
    <>
      <ZsHead id={view} t={t} year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn" href={`/pecati/${rep}-prav`} target="_blank">🖨 Пропишан образец</Link>
        <Link className="btn pri" href={`/pecati/${rep}-crm`} target="_blank">🖨 Облик ЦРМ</Link>
        <DownloadCsv name={`${rep === 'bs' ? 'Bilans_na_sostojba' : 'Bilans_na_uspeh'}_${year}.csv`} rows={csv} />
        {edit ? <Link className="btn" href={`/${view}`}>Затвори рачен внес</Link> : <Link className="btn" href={`/${view}?edit=1`}>✎ Рачни износи</Link>}
      </ZsHead>
      <NotClosedNote closed={L.Y.closed} year={year} />
      {!edit && canWrite && <ZmImport year={year} />}
      {manual > 0 && !edit && <div className="callout warn">{manual} АОП позиции се со рачни износи (од друга програма или увезен XML) – тие имаат предност пред пресметаните од книжењата.</div>}
      {C.rounded && <div className="callout">Заокружување на АОП без дени: разлика од {C.rounded.d} ден. е додадена на АОП {C.rounded.aop} за да Актива = Пасива.</div>}
      {edit ? (
        <ActionForm action={saveZsMan.bind(null, rep)} submit="Зачувај рачни износи" className="">
          <p className="note">Внесете износ само каде треба да се замени пресметаниот (на пр. претходна година од друга програма). Празно = пресметано од книжењата. Збирните позиции (формули) се пресметуваат сами.</p>
          {table}
        </ActionForm>
      ) : table}
      {rep === 'bs' && !edit && (Math.abs((C.V.bs063 || 0) - (C.V.bs111 || 0)) < 1
        ? <p><span className="pill good">Актива = Пасива</span></p>
        : <p><span className="pill bad">Разлика {fmt(Math.round((C.V.bs063 || 0) - (C.V.bs111 || 0)))}</span></p>)}
      {!edit && manual > 0 && <div className="row"><RowAction className="btn sm ghost" label="Отстрани ги рачните износи" confirm="Да се отстранат сите рачни износи од овој биланс?"
        action={clearZsMan.bind(null, rep)} /></div>}
    </>
  );
}
