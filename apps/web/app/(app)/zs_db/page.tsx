/**
 * Legacy `ZS_VIEW_DB` 10866 (+ ACT `dbSave`/`dbPdf`/`dbPrev` 10875–10877) — phase 2 "Даночен биланс": ДБ, УЈП 6-2020.
 * FIX(P8 #13): legacy wrote `dbAdj` to the firm directly from `onchange` and swallowed errors; inputs are saved by a
 * guarded, audited action. FIX(P8 #6): one `dbSave`/`dbPdf` (the duplicates at 7717/7718 are dropped deliberately).
 */
import Link from 'next/link';
import { DB_F } from '@wise/core';
import { fmt } from '@/lib/fmt';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/yearend/action-form';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';
import { saveDb } from '../zsProc/actions';

const fa = (v: number | undefined) => Math.round(+(v ?? 0) || 0).toLocaleString('de-DE');

export default async function ZsDbPage() {
  const c = await yePage('zs_db');
  if (!c) return <NoFirm t="Даночен биланс" />;
  const { L, year } = c;
  const D = L.Y.co.db;
  const V = D.V;
  return (
    <>
      <ZsHead id="zs_db" t="Даночен биланс (ДБ)" year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn pri" href="/pecati/db" target="_blank">🖨 Образец ДБ (печати / PDF)</Link>
      </ZsHead>
      <NotClosedNote closed={L.Y.closed} year={year} />
      <div className="callout">Образец <b>ДБ</b> на УЈП (верзија 6-2020), износи <b>без дени</b>. Сивите редови се пресметуваат сами; белите ги внесувате. АОП 01 е од Билансот на успех, АОП 57 од конто 2330, АОП 65 од приходите – може да се изменат. Данокот од АОП 56 се книжи при затворањето на годината.</div>
      <ActionForm action={saveDb} submit="Зачувај" className="">
        <div className="tw"><table className="dense">
          <thead><tr><th style={{ width: 40 }} /><th>Опис</th><th style={{ width: 50 }}>АОП</th><th className="n" style={{ width: 170 }}>Износ</th></tr></thead>
          <tbody>
            {DB_F.map((r) => {
              if (r[0] === 'h') return <tr className="sub" key={'h' + r[1]}><td>{r[1]}</td><td colSpan={3}>{r[2]}</td></tr>;
              const t = r[3];
              if (t === 'auto') {
                return (
                  <tr className="tot" key={r[0]}><td /><td>{r[2]}</td><td><b>{r[0]}</b></td>
                    <td className="n">{r[0] === '59' ? `${(V['59'] ?? 0) >= 0 ? 'за доплата ' : 'повеќе платено '}${fa(Math.abs(V['59'] ?? 0))}` : fa(V[r[0]])}</td></tr>
                );
              }
              const ph = t === 'akont' ? D.akAuto : t === 'inc' ? D.incAuto : undefined;
              return (
                <tr key={r[0]}><td /><td className="mini" style={{ whiteSpace: 'normal' }}>{r[2]}</td><td><b>{r[0]}</b></td>
                  <td className="n"><input name={'db' + r[0]} type="number" step="1" defaultValue={D.A[r[0]] ?? ''} placeholder={ph != null ? String(ph) : undefined} style={{ width: 150, textAlign: 'right' }} /></td></tr>
              );
            })}
          </tbody>
        </table></div>
      </ActionForm>
      <div className="card"><p className="note" style={{ margin: 0 }}>Даночна основа (АОП 49) <b>{fmt(D.base)}</b> · данок (АОП 56) <b>{fmt(D.tax)}</b> · аконтации (АОП 57) {fmt(D.ak)} · {D.diff >= 0 ? 'за доплата' : 'повеќе платено'} <b>{fmt(Math.abs(D.diff))}</b>. Рок: електронски преку е-Даноци до 15 март (кога годишната сметка се поднесува електронски), инаку до 28 февруари.</p></div>
    </>
  );
}
