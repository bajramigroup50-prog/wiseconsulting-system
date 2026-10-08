/**
 * Legacy `VIEWS.zs_de` 11044 (+ ACT `deSave`/`deReset` 11067/11068) — ЦРМ образец 38 "Државна евиденција" (AOP 601–724).
 * Suggestions come from account names (`deAuto`); typed values win (`deVals`).
 */
import { DE38 } from '@wise/core';
import { forms3538 } from '@wise/db';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/yearend/action-form';
import { ZsHead } from '@/components/yearend/ph-bar';
import { resetDe, saveDe } from '../zsProc/actions';

const fa = (v: number | undefined) => Math.round(+(v ?? 0) || 0).toLocaleString('de-DE');

export default async function ZsDePage() {
  const c = await yePage('zs_de');
  if (!c) return <NoFirm t="Образец 38" />;
  const { L, firm, year } = c;
  const { auto } = forms3538(L, await accountNames(firm.id));
  const M = L.statement?.deMan ?? {};
  return (
    <>
      <ZsHead id="zs_de" t="Државна евиденција (образец 38)" year={year} ent={L.ent} done={phaseDone(L)}>
        <RowAction className="btn" action={resetDe} label="↺ Сè автоматски" confirm="Да се избришат внесените износи и да остане предлогот?" />
      </ZsHead>
      <div className="callout">Образецот 38 на ЦРМ (АОП 601–724). Програмот предлага износи од контата (по називот на контото) – <b>проверете ги и дополнете</b>. Внесените вредности се зачувуваат и имаат предност пред предлогот. Контролите „≤ АОП од БС/БУ“ се во „Контрола“.</div>
      <ActionForm action={saveDe} submit="Зачувај" className="">
        <div className="tw"><table className="dense">
          <thead><tr><th style={{ width: 50 }}>АОП</th><th>Опис</th><th className="n" style={{ width: 120 }}>Предлог</th><th className="n" style={{ width: 160 }}>{year}</th></tr></thead>
          <tbody>{DE38.map(([n, t]) => (
            <tr key={n}><td><b>{n}</b></td><td className="mini" style={{ whiteSpace: 'normal' }}>{t}</td><td className="n mini">{auto[n] ? fa(auto[n]) : ''}</td>
              <td className="n"><input name={'de' + n} type="number" step="1" defaultValue={M[String(n)] ?? ''} placeholder={auto[n] ? String(auto[n]) : undefined} style={{ width: 140, textAlign: 'right' }} /></td></tr>
          ))}</tbody>
        </table></div>
      </ActionForm>
    </>
  );
}
